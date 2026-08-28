/**
 * @file watcher.ts
 * @brief Incremental transcript tailer with ccusage-parity best-wins dedupe and persistent index caching.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import { dayKeyFor } from '../../shared/daykey';
import { claudeAdapter } from './adapters/claude';
import { adapterById } from './adapters';
import { toolFor } from '../../shared/tools';
import {
  loadTranscriptCache,
  saveTranscriptCache,
  type CachedFileMeta,
  type ToolResultSummary,
} from './transcript-cache';
import type { SourceAdapter, SourceRoot } from './adapters/types';
import type { CompactMarker, LimitsMarker, ToolResultByDay, UsageEntry } from '../../shared/types';
import type { ScanProgress } from '../../shared/ipc';

const fsp = fs.promises;

const CHUNK = 1 << 20; // 1 MiB read window
const NEWLINE = 0x0a;
const CR = 0x0d;
const EMPTY = Buffer.alloc(0);
const SCAN_CONCURRENCY = 24; // parallel files during the initial index
const MAX_TREE_DEPTH = 8; //  projects/<proj>/<session>/subagents/workflows/wf_x/…
/** Transcripts untouched for this long are indexed once but not watched. */
export const WATCH_HORIZON_MS = 7 * 24 * 3600 * 1000;

interface WatcherEvents {
  /** initial index progress */
  progress: ScanProgress;
  /** initial index complete (sorted asc) */
  ready: { entries: UsageEntry[]; files: number; ms: number };
  /** live appended entries (deduped) */
  entries: { entries: UsageEntry[]; merged: number };
  /** full rescan started (truncate/manual) */
  reset: { reason: string };
  error: Error;
}

export interface UsageWatcherOptions {
  /**
   * Data roots to index. A bare string[] is shorthand for "all Claude Code
   * roots" and keeps every existing caller working; pass {@link SourceRoot}s to
   * mix formats.
   */
  dirs: string[] | SourceRoot[];
  watch?: boolean;
  /**
   * Skip transcript files not modified since this epoch-ms. Off by default —
   * the app always wants the full history, and a windowed index would silently
   * understate lifetime totals.
   */
  sinceMs?: number | null;
  /**
   * IANA zone for day bucketing, or null/'' for the system zone. Only affects
   * `entry.dateKey`; changing it does NOT require a rescan, because main
   * re-derives the keys on the existing entries in one pass.
   */
  timezone?: string | null;
  /**
   * Optional persistent disk cache path (e.g. userData/transcript-index.json).
   * Enables instant <50ms startup by reloading cached entries on launch.
   */
  cachePath?: string | null;
}

/**
 * Typed EventEmitter surface — same runtime class, precise payloads.
 */
/* eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging */
export interface UsageWatcher {
  on<K extends keyof WatcherEvents>(event: K, listener: (payload: WatcherEvents[K]) => void): this;
  once<K extends keyof WatcherEvents>(
    event: K,
    listener: (payload: WatcherEvents[K]) => void,
  ): this;
  emit<K extends keyof WatcherEvents>(event: K, payload: WatcherEvents[K]): boolean;
}

/**
 * Incremental tailer over Claude Code's `projects/**\/*.jsonl` transcripts.
 *
 * Per-file byte offsets + a partial-line remainder make every read O(appended
 * bytes). Dedupe is ccusage-parity best-wins: lines repeating a
 * (messageId:requestId) key — streaming chunks carry cumulative usage — or
 * replaying a messageId across a sidechain boundary (subagent usage mirrored
 * into parent transcripts under a new requestId) MERGE into the stored entry,
 * keeping whichever copy is non-sidechain, then largest by token total, then
 * fast-flagged. Merges mutate the stored object in place, so aggregate
 * recomputes see the upgraded counts without re-sorting.
 */
/* eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the interface above */
export class UsageWatcher extends EventEmitter {
  /** roots paired with the adapter that understands each one */
  readonly roots: SourceRoot[];
  /** the root paths alone — what main, the CLI and parity already speak */
  readonly dirs: string[];
  private readonly watchEnabled: boolean;
  private readonly offsets = new Map<string, number>(); //    file → bytes consumed
  private readonly remainders = new Map<string, Buffer>();
  private readonly lineNos = new Map<string, number>(); //    file → lines consumed (fallback keys)
  private readonly fileSource = new Map<string, string | null>(); // file → owning root dir
  private readonly fileStates = new Map<string, unknown>();
  private readonly byKey = new Map<string, UsageEntry>(); //  dedupe key → stored entry
  private readonly byMsg = new Map<string, UsageEntry[]>(); // messageId → stored entries
  private readonly fileMeta = new Map<string, CachedFileMeta>(); // file -> mtime and size
  /** latest "usage limit reached" reset time (ms) */
  resetTs: number | null = null;
  /** context-compaction markers (isCompactSummary lines), source-stamped */
  readonly compactions: CompactMarker[] = [];
  /**
   * tool_result volume folded into source root → local day → {count, chars} on
   * arrival (never billed). Replaces a per-marker array that grew to tens of
   * thousands of objects; the snapshot only needs counts/chars per day window.
   */
  private readonly toolResultBuckets = new Map<string, ToolResultByDay>();
  /** running marker total — a cheap change signal for scopedData's memo key */
  toolResultCount = 0;
  /**
   * Newest rate-limit reading per source root, for formats that record their
   * own (Codex). Latest-wins rather than accumulated.
   */
  private readonly limitsBySource = new Map<string, LimitsMarker>();
  private readonly busy = new Map<string, Promise<void>>(); // file → tail promise chain
  private watchers: FSWatcher[] = [];
  private rescanning = false;
  private saveCacheTimer: NodeJS.Timeout | null = null;
  /** mtime floor for discovery; null = index everything */
  private readonly sinceMs: number | null;
  /** day-bucketing zone handed to the parser; null = system */
  private timezone: string | null;
  private readonly cachePath: string | null;

  constructor({
    dirs,
    watch = true,
    sinceMs = null,
    timezone = null,
    cachePath = null,
  }: UsageWatcherOptions) {
    super();
    this.roots = dirs.map((d) =>
      typeof d === 'string' ? { dir: d, adapter: adapterById(toolFor(d).id) ?? claudeAdapter } : d,
    );
    this.dirs = this.roots.map((r) => r.dir);
    this.watchEnabled = watch;
    this.sinceMs = sinceMs;
    this.timezone = timezone;
    this.cachePath = cachePath;
  }

  setTimezone(zone: string | null): void {
    this.timezone = zone;
  }

  merge(stored: UsageEntry, cand: UsageEntry): boolean {
    const tot = (e: UsageEntry) => e.in + e.out + e.read + e.w5m + e.w1h;
    const better =
      stored.sidechain !== cand.sidechain
        ? stored.sidechain
        : tot(cand) !== tot(stored)
          ? tot(cand) > tot(stored)
          : cand.fast && !stored.fast;
    if (!better) return false;
    stored.model = cand.model;
    stored.fast = cand.fast;
    stored.sidechain = cand.sidechain;
    stored.in = cand.in;
    stored.out = cand.out;
    stored.read = cand.read;
    stored.w5m = cand.w5m;
    stored.w1h = cand.w1h;
    stored.costUSD = cand.costUSD;
    stored.tools = cand.tools ?? stored.tools;
    stored.stop = cand.stop ?? stored.stop;
    return true;
  }

  adapterOf(file: string): SourceAdapter {
    const src = this.sourceOf(file);
    return this.roots.find((r) => r.dir === src)?.adapter ?? claudeAdapter;
  }

  sourceOf(file: string): string | null {
    let src = this.fileSource.get(file);
    if (src === undefined) {
      src = this.dirs.find((d) => file.startsWith(d + path.sep)) || this.dirs[0] || null;
      this.fileSource.set(file, src);
    }
    return src;
  }

  limitsFor(scope: Set<string> | null): Map<string, LimitsMarker> {
    const out = new Map<string, LimitsMarker>();
    for (const [src, m] of this.limitsBySource) {
      if (scope && !scope.has(src)) continue;
      out.set(src, m);
    }
    return out;
  }

  toolResultsFor(scope: Set<string> | null): ToolResultByDay {
    const out: ToolResultByDay = new Map();
    for (const [src, byDay] of this.toolResultBuckets) {
      if (scope && !scope.has(src)) continue;
      for (const [day, b] of byDay) {
        const cur = out.get(day);
        if (cur) {
          cur.count += b.count;
          cur.chars += b.chars;
        } else {
          out.set(day, { count: b.count, chars: b.chars });
        }
      }
    }
    return out;
  }

  accept(entry: UsageEntry): 'new' | 'merged' | false {
    const exact = this.byKey.get(entry.key);
    if (exact) return this.merge(exact, entry) && 'merged';
    if (entry.msgId) {
      for (const stored of this.byMsg.get(entry.msgId) || []) {
        if (entry.sidechain || stored.sidechain) {
          this.byKey.set(entry.key, stored);
          return this.merge(stored, entry) && 'merged';
        }
      }
    }
    this.byKey.set(entry.key, entry);
    if (entry.msgId) {
      const list = this.byMsg.get(entry.msgId);
      if (list) list.push(entry);
      else this.byMsg.set(entry.msgId, [entry]);
    }
    return 'new';
  }

  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (
      dir: string,
      depth: number,
      owns: (file: string) => boolean,
    ): Promise<void> => {
      if (depth > MAX_TREE_DEPTH) return;
      let ents;
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const subdirs: string[] = [];
      const candidates: string[] = [];
      for (const d of ents) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) subdirs.push(p);
        else if (d.isFile() && owns(p)) candidates.push(p);
      }

      if (this.sinceMs == null) {
        for (const p of candidates) files.push(p);
      } else {
        const mtimes = await Promise.all(
          candidates.map((p) =>
            fsp.stat(p).then(
              (st) => st.mtimeMs,
              () => null,
            ),
          ),
        );
        for (let i = 0; i < candidates.length; i++) {
          const m = mtimes[i];
          if (m != null && m >= this.sinceMs) files.push(candidates[i]);
        }
      }

      await Promise.all(subdirs.map((p) => walk(p, depth + 1, owns)));
    };
    await Promise.all(this.roots.map((root) => walk(root.dir, 0, (f) => root.adapter.owns(f))));
    return files;
  }

  /** Read every complete line appended since the recorded offset. */
  async readNew(file: string): Promise<{ entries: UsageEntry[]; merged: number }> {
    const none = { entries: [], merged: 0 };
    const prevOff = this.offsets.get(file) || 0;

    const adapter = this.adapterOf(file);
    let state = this.fileStates.get(file);
    if (state === undefined && adapter.createState) {
      state = adapter.createState(file);
      this.fileStates.set(file, state);
    }

    // Fast-path for initial indexing and unread files: single native C++ readFile
    if (prevOff === 0) {
      let buf: Buffer;
      try {
        buf = await fsp.readFile(file);
      } catch {
        return none;
      }
      if (!buf.length) {
        this.offsets.set(file, 0);
        return none;
      }

      const out: UsageEntry[] = [];
      let merged = 0;
      let lineNo = 0;
      let start = 0;
      let nl: number;

      while ((nl = buf.indexOf(NEWLINE, start)) !== -1) {
        let end = nl;
        if (end > start && buf[end - 1] === CR) end--; // CRLF
        lineNo += 1;
        const raw = buf.subarray(start, end);
        start = nl + 1;
        if (!raw.length) continue;

        if (adapter.mayCarryData && !adapter.mayCarryData(raw)) continue;
        const text = raw.toString('utf8');

        if (adapter.parseLimits) {
          const lim = adapter.parseLimits(text);
          if (lim) {
            const src = this.sourceOf(file) ?? '';
            const prev = this.limitsBySource.get(src);
            if (!prev || lim.observedAt >= prev.observedAt) {
              this.limitsBySource.set(src, { ...lim, source: src });
            }
          }
        }

        const parsed = adapter.parseLine(text, file, lineNo, this.timezone, state);
        if (!parsed) continue;
        if (parsed.kind === 'reset') {
          if (!this.resetTs || parsed.resetTs > this.resetTs) this.resetTs = parsed.resetTs;
          continue;
        }
        if (parsed.kind === 'compact') {
          parsed.source = this.sourceOf(file);
          this.compactions.push(parsed);
          continue;
        }
        if (parsed.kind === 'toolresult') {
          const src = this.sourceOf(file) ?? '';
          const day = dayKeyFor(parsed.ts, this.timezone);
          let byDay = this.toolResultBuckets.get(src);
          if (!byDay) this.toolResultBuckets.set(src, (byDay = new Map() as ToolResultByDay));
          const b = byDay.get(day);
          if (b) {
            b.count += 1;
            b.chars += parsed.chars;
          } else {
            byDay.set(day, { count: 1, chars: parsed.chars });
          }
          this.toolResultCount += 1;
          continue;
        }
        parsed.source = this.sourceOf(file);
        parsed.agent = adapter.id;
        const verdict = this.accept(parsed);
        if (verdict === 'new') out.push(parsed);
        else if (verdict === 'merged') merged += 1;
      }

      const remainder = start < buf.length ? Buffer.from(buf.subarray(start)) : EMPTY;
      this.remainders.set(file, remainder);
      this.lineNos.set(file, lineNo);
      this.offsets.set(file, buf.length);
      try {
        const st = await fsp.stat(file);
        this.fileMeta.set(file, { mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        this.fileMeta.set(file, { mtimeMs: Date.now(), size: buf.length });
      }
      return { entries: out, merged };
    }

    // Incremental tailing path for files that have already been partially read
    let st: fs.Stats;
    try {
      st = await fsp.stat(file);
    } catch {
      return none;
    }
    if (st.size < prevOff) {
      this.requestRescan(`truncated: ${path.basename(file)}`);
      return none;
    }
    if (st.size === prevOff) return none;

    const out: UsageEntry[] = [];
    let merged = 0;
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - prevOff));
      let pos = prevOff;
      let acc = this.remainders.get(file) ?? EMPTY;
      let lineNo = this.lineNos.get(file) || 0;
      while (pos < st.size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - pos), pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
        acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;

        let start = 0;
        let nl: number;
        while ((nl = acc.indexOf(NEWLINE, start)) !== -1) {
          let end = nl;
          if (end > start && acc[end - 1] === CR) end--; // CRLF
          lineNo += 1;
          const raw = acc.subarray(start, end);
          start = nl + 1;
          if (!raw.length) continue;
          if (adapter.mayCarryData && !adapter.mayCarryData(raw)) continue;
          const text = raw.toString('utf8');
          if (adapter.parseLimits) {
            const lim = adapter.parseLimits(text);
            if (lim) {
              const src = this.sourceOf(file) ?? '';
              const prev = this.limitsBySource.get(src);
              if (!prev || lim.observedAt >= prev.observedAt) {
                this.limitsBySource.set(src, { ...lim, source: src });
              }
            }
          }
          const parsed = adapter.parseLine(text, file, lineNo, this.timezone, state);
          if (!parsed) continue;
          if (parsed.kind === 'reset') {
            if (!this.resetTs || parsed.resetTs > this.resetTs) this.resetTs = parsed.resetTs;
            continue;
          }
          if (parsed.kind === 'compact') {
            parsed.source = this.sourceOf(file);
            this.compactions.push(parsed);
            continue;
          }
          if (parsed.kind === 'toolresult') {
            const src = this.sourceOf(file) ?? '';
            const day = dayKeyFor(parsed.ts, this.timezone);
            let byDay = this.toolResultBuckets.get(src);
            if (!byDay) this.toolResultBuckets.set(src, (byDay = new Map() as ToolResultByDay));
            const b = byDay.get(day);
            if (b) {
              b.count += 1;
              b.chars += parsed.chars;
            } else {
              byDay.set(day, { count: 1, chars: parsed.chars });
            }
            this.toolResultCount += 1;
            continue;
          }
          parsed.source = this.sourceOf(file);
          parsed.agent = adapter.id;
          const verdict = this.accept(parsed);
          if (verdict === 'new') out.push(parsed);
          else if (verdict === 'merged') merged += 1;
        }
        acc = start < acc.length ? Buffer.from(acc.subarray(start)) : EMPTY;
      }
      this.remainders.set(file, acc);
      this.lineNos.set(file, lineNo);
      this.offsets.set(file, pos);
      this.fileMeta.set(file, { mtimeMs: st.mtimeMs, size: st.size });
    } finally {
      await fh.close();
    }
    return { entries: out, merged };
  }

  private schedulePersistCache(): void {
    if (!this.cachePath) return;
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    this.saveCacheTimer = setTimeout(() => {
      void this.persistCache();
    }, 2000);
  }

  private async persistCache(): Promise<void> {
    if (!this.cachePath) return;
    const files: Record<string, CachedFileMeta> = {};
    for (const [f, m] of this.fileMeta) {
      files[f] = m;
    }
    const toolResults: ToolResultSummary[] = [];
    for (const [src, byDay] of this.toolResultBuckets) {
      for (const [day, b] of byDay) {
        toolResults.push({ source: src, day, count: b.count, chars: b.chars });
      }
    }
    await saveTranscriptCache(this.cachePath, {
      files,
      entries: Array.from(this.byKey.values()),
      compactions: this.compactions,
      toolResults,
      limits: Array.from(this.limitsBySource.values()),
      resetTs: this.resetTs,
    });
  }

  /** Serialize tails per file; coalesce bursts of change events. */
  tail(file: string): Promise<void> {
    const prev = this.busy.get(file) || Promise.resolve();
    const next = prev
      .then(async () => {
        const { entries, merged } = await this.readNew(file);
        if (entries.length || merged) {
          this.emit('entries', { entries, merged });
          this.schedulePersistCache();
        }
      })
      .catch((err) => {
        const e = err as Error;
        this.emit('error', new Error(`tailing ${file}: ${e.message}`, { cause: e }));
      });
    this.busy.set(file, next);
    return next;
  }

  private async syncIncremental(): Promise<void> {
    try {
      const files = await this.listFiles();
      const newOrChanged: string[] = [];
      const mtimes = await Promise.all(
        files.map((p) =>
          fsp.stat(p).then(
            (st) => ({ p, mtimeMs: st.mtimeMs, size: st.size }),
            () => null,
          ),
        ),
      );

      for (const item of mtimes) {
        if (!item) continue;
        const prev = this.fileMeta.get(item.p);
        if (!prev || prev.mtimeMs !== item.mtimeMs || prev.size !== item.size) {
          newOrChanged.push(item.p);
        }
      }

      if (!newOrChanged.length) return;

      const addedEntries: UsageEntry[] = [];
      let totalMerged = 0;
      for (const f of newOrChanged) {
        const { entries, merged } = await this.readNew(f);
        for (const e of entries) addedEntries.push(e);
        totalMerged += merged;
      }

      if (addedEntries.length || totalMerged > 0) {
        this.emit('entries', { entries: addedEntries, merged: totalMerged });
        void this.persistCache();
      }
    } catch (err) {
      console.error('[ccmon] background sync error:', err);
    }
  }

  async start(): Promise<UsageEntry[]> {
    const t0 = Date.now();
    if (this.cachePath) {
      const cached = await loadTranscriptCache(this.cachePath);
      if (cached && cached.entries.length) {
        for (const e of cached.entries) {
          this.accept(e);
        }
        if (cached.compactions) {
          for (const c of cached.compactions) this.compactions.push(c);
        }
        if (cached.limits) {
          for (const l of cached.limits) if (l.source) this.limitsBySource.set(l.source, l);
        }
        if (cached.resetTs) {
          this.resetTs = cached.resetTs;
        }
        if (cached.toolResults) {
          for (const tr of cached.toolResults) {
            let byDay = this.toolResultBuckets.get(tr.source);
            if (!byDay)
              this.toolResultBuckets.set(tr.source, (byDay = new Map() as ToolResultByDay));
            byDay.set(tr.day, { count: tr.count, chars: tr.chars });
            this.toolResultCount += tr.count;
          }
        }
        for (const [f, meta] of Object.entries(cached.files)) {
          this.offsets.set(f, meta.size);
          this.fileMeta.set(f, meta);
        }

        const initialEntries = Array.from(this.byKey.values());
        initialEntries.sort((a, b) => a.ts - b.ts);
        this.emit('ready', {
          entries: initialEntries,
          files: Object.keys(cached.files).length,
          ms: Date.now() - t0,
        });
        if (this.watchEnabled) this.watch();

        // Non-blocking background check for any files written while ccmon was closed
        void this.syncIncremental();
        return initialEntries;
      }
    }

    const files = await this.listFiles();
    const all: UsageEntry[] = [];
    let scanned = 0;
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        const { entries } = await this.readNew(f);
        for (const e of entries) all.push(e);
        scanned += 1;
        if (scanned % 50 === 0 || scanned === files.length) {
          this.emit('progress', { scanned, total: files.length, entries: all.length });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length || 1) }, worker),
    );
    all.sort((a, b) => a.ts - b.ts);
    this.emit('ready', { entries: all, files: files.length, ms: Date.now() - t0 });
    if (this.watchEnabled) this.watch();
    void this.persistCache();
    return all;
  }

  watch(): void {
    const cutoff = Date.now() - WATCH_HORIZON_MS;
    for (const { dir, adapter } of this.roots) {
      const w = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: MAX_TREE_DEPTH,
        alwaysStat: true,
        ignorePermissionErrors: true,
        ignored: (p: string, stats?: fs.Stats) => {
          if (stats && stats.isFile()) {
            return !adapter.owns(p) || stats.mtimeMs < cutoff;
          }
          return false;
        },
      });
      w.on('add', (p) => void this.tail(p));
      w.on('change', (p) => void this.tail(p));
      w.on('error', (err) => this.emit('error', err));
      this.watchers.push(w);
    }
  }

  /** Drop all state and re-index (file truncation, manual refresh). */
  requestRescan(reason: string): void {
    if (this.rescanning) return;
    this.rescanning = true;
    this.emit('reset', { reason });
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    if (this.cachePath) fsp.unlink(this.cachePath).catch(() => {});
    Promise.all(this.watchers.map((w) => w.close()))
      .catch(() => {})
      .then(() => {
        this.watchers = [];
        this.offsets.clear();
        this.remainders.clear();
        this.lineNos.clear();
        this.fileSource.clear();
        this.fileStates.clear();
        this.fileMeta.clear();
        this.byKey.clear();
        this.byMsg.clear();
        this.resetTs = null;
        this.compactions.length = 0;
        this.toolResultBuckets.clear();
        this.toolResultCount = 0;
        this.limitsBySource.clear();
        this.busy.clear();
        return this.start();
      })
      .catch((err) => this.emit('error', err as Error))
      .finally(() => {
        this.rescanning = false;
      });
  }

  async stop(): Promise<void> {
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }
}
