/**
 * @file watcher.ts
 * @brief Incremental transcript tailer with ccusage-parity best-wins dedupe.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import { dayKeyFor } from '../../shared/daykey';
import { claudeAdapter } from './adapters/claude';
import type { SourceAdapter, SourceRoot } from './adapters/types';
import type { CompactMarker, ToolResultByDay, UsageEntry } from '../../shared/types';
import type { ScanProgress } from '../../shared/ipc';

const fsp = fs.promises;

const CHUNK = 1 << 20; // 1 MiB read window
const NEWLINE = 0x0a;
const CR = 0x0d;
const EMPTY = Buffer.alloc(0);
const SCAN_CONCURRENCY = 8; // parallel files during the initial index
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
   *
   * Exists for latency-bound one-shot readers (the CLI's statusline, which must
   * answer inside a shell prompt): today's spend and the active 5-hour block
   * can only live in recently-touched files, so most of the corpus is provably
   * irrelevant to them. A long-running session's total IS truncated by this, so
   * only set it when that trade is acceptable and disclosed.
   */
  sinceMs?: number | null;
  /**
   * IANA zone for day bucketing, or null/'' for the system zone. Only affects
   * `entry.dateKey`; changing it does NOT require a rescan, because main
   * re-derives the keys on the existing entries in one pass.
   */
  timezone?: string | null;
}

/**
 * Typed EventEmitter surface — same runtime class, precise payloads.
 *
 * The interface/class merge below is the standard way to give `EventEmitter`
 * per-event payload types without wrapping it. ESLint's
 * `no-unsafe-declaration-merging` exists to catch a merge that PROMISES
 * members the class does not implement; here every merged member is an
 * `EventEmitter` method already present at runtime, narrowed rather than
 * invented, so the hazard the rule guards cannot occur.
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
  /**
   * file → trailing partial line, as BYTES.
   *
   * Splitting on the 0x0A byte is safe without a StringDecoder: every byte of
   * a UTF-8 multibyte sequence has its high bit set, so a newline byte can
   * never appear inside a character. That is what lets the whole read path
   * stay on Buffers and decode only the lines that survive the prefilter.
   */
  private readonly remainders = new Map<string, Buffer>();
  private readonly lineNos = new Map<string, number>(); //    file → lines consumed (fallback keys)
  private readonly fileSource = new Map<string, string | null>(); // file → owning root dir
  /**
   * file → the adapter's per-file parse state (see `SourceAdapter.createState`).
   * Held here, not in the adapter, because adapters are shared singletons and
   * the state must live exactly as long as this watcher's view of the file.
   */
  private readonly fileStates = new Map<string, unknown>();
  private readonly byKey = new Map<string, UsageEntry>(); //  dedupe key → stored entry
  private readonly byMsg = new Map<string, UsageEntry[]>(); // messageId → stored entries
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
  private readonly busy = new Map<string, Promise<void>>(); // file → tail promise chain
  private watchers: FSWatcher[] = [];
  private rescanning = false;
  /** mtime floor for discovery; null = index everything (see the option doc) */
  private readonly sinceMs: number | null;
  /** day-bucketing zone handed to the parser; null = system */
  private timezone: string | null;

  constructor({ dirs, watch = true, sinceMs = null, timezone = null }: UsageWatcherOptions) {
    super();
    this.roots = dirs.map((d) => (typeof d === 'string' ? { dir: d, adapter: claudeAdapter } : d));
    this.dirs = this.roots.map((r) => r.dir);
    this.watchEnabled = watch;
    this.sinceMs = sinceMs;
    this.timezone = timezone;
  }

  /**
   * Switch the bucketing zone for lines parsed from now on. Entries already
   * indexed keep their old keys — main re-derives those separately, so the two
   * halves of a zone change stay in step.
   */
  setTimezone(zone: string | null): void {
    this.timezone = zone;
  }

  /**
   * Upgrade `stored` from a duplicate `cand` when the candidate is the better
   * copy (ccusage `should_replace_deduped_entry`): non-sidechain beats
   * sidechain, else larger token total (later streaming chunks are cumulative),
   * else the fast-flagged copy. Returns true when fields were mutated.
   */
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
    // the better copy is the later cumulative chunk — its content/stop are
    // more complete, but never downgrade a known value to undefined/null
    stored.tools = cand.tools ?? stored.tools;
    stored.stop = cand.stop ?? stored.stop;
    return true;
  }

  /**
   * Which adapter owns a transcript, resolved through its root. Falls back to
   * Claude Code so a file that somehow escapes the root mapping still parses
   * the way it always did.
   */
  adapterOf(file: string): SourceAdapter {
    const src = this.sourceOf(file);
    return this.roots.find((r) => r.dir === src)?.adapter ?? claudeAdapter;
  }

  /** Which configured root dir a transcript belongs to (memoized per file). */
  sourceOf(file: string): string | null {
    let src = this.fileSource.get(file);
    if (src === undefined) {
      src = this.dirs.find((d) => file.startsWith(d + path.sep)) || this.dirs[0] || null;
      this.fileSource.set(file, src);
    }
    return src;
  }

  /**
   * Merge the tool_result day buckets for the in-scope source roots (null = all)
   * into a single day → {count, chars} map. Buckets are copied so callers (the
   * range filter in aggregate) never mutate the retained accumulators.
   */
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

  /** Dedupe gate: 'new' (index it), 'merged' (stored entry mutated), or false. */
  accept(entry: UsageEntry): 'new' | 'merged' | false {
    const exact = this.byKey.get(entry.key);
    if (exact) return this.merge(exact, entry) && 'merged';
    if (entry.msgId) {
      for (const stored of this.byMsg.get(entry.msgId) || []) {
        if (entry.sidechain || stored.sidechain) {
          this.byKey.set(entry.key, stored); // future chunks hit the exact path
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

  // Recursive discovery. Layout is not flat — besides
  // projects/<project>/<session>.jsonl there are subagent transcripts at
  // <session-id>/subagents/agent-*.jsonl and
  // <session-id>/subagents/workflows/wf_*/agent-*.jsonl, all of which carry
  // real billable usage.
  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    // `owns` is a parameter, not a captured mutable — a shared binding would
    // silently cross-assign adapters now that siblings are walked concurrently.
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
      // Sibling subdirectories are walked CONCURRENTLY. The old serial `await`
      // per entry made discovery one long chain of round-trips on a tree that
      // is thousands of directories wide, and every one of them was waiting on
      // the libuv threadpool alone rather than keeping it fed. Fan-out is
      // bounded by the width of one directory, and the threadpool serialises
      // the actual syscalls, so this cannot run the process out of handles.
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
        // one stat per candidate is orders of magnitude cheaper than reading
        // it, so the filter pays for itself the moment anything is skipped
        const mtimes = await Promise.all(
          candidates.map((p) =>
            fsp.stat(p).then(
              (st) => st.mtimeMs,
              () => null, // vanished between readdir and stat
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
    let st: fs.Stats;
    try {
      st = await fsp.stat(file);
    } catch {
      return none; // deleted — keep what we already indexed
    }
    if (st.size < prevOff) {
      this.requestRescan(`truncated: ${path.basename(file)}`);
      return none;
    }
    if (st.size === prevOff) return none;

    const out: UsageEntry[] = [];
    let merged = 0;
    const adapter = this.adapterOf(file);
    // Created on first read and kept across tails: a stateful adapter needs the
    // model/tier it learned from lines that arrived in an EARLIER chunk.
    let state = this.fileStates.get(file);
    if (state === undefined && adapter.createState) {
      state = adapter.createState(file);
      this.fileStates.set(file, state);
    }
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
        // `chunk` aliases the reusable read buffer. That is fine for the rest
        // of this iteration — every complete line is consumed before the next
        // read — but the leftover MUST be copied out below, or the next read
        // overwrites the partial line still waiting for its newline.
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
          // THE hot gate: reject on raw bytes so a line that cannot carry data
          // is never decoded, never allocated as a string, never parsed.
          if (adapter.mayCarryData && !adapter.mayCarryData(raw)) continue;
          const parsed = adapter.parseLine(
            raw.toString('utf8'),
            file,
            lineNo,
            this.timezone,
            state,
          );
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
          parsed.agent = adapter.id; // which coding CLI produced this usage
          const verdict = this.accept(parsed);
          if (verdict === 'new') out.push(parsed);
          else if (verdict === 'merged') merged += 1;
        }
        // Copy, never retain a view: `acc` may alias the read buffer.
        acc = start < acc.length ? Buffer.from(acc.subarray(start)) : EMPTY;
      }
      this.remainders.set(file, acc);
      this.lineNos.set(file, lineNo);
      this.offsets.set(file, pos);
    } finally {
      await fh.close();
    }
    return { entries: out, merged };
  }

  /** Serialize tails per file; coalesce bursts of change events. */
  tail(file: string): Promise<void> {
    const prev = this.busy.get(file) || Promise.resolve();
    const next = prev
      .then(async () => {
        const { entries, merged } = await this.readNew(file);
        // merged-only updates mutated already-indexed entries — still announce
        // so the snapshot recomputes with the upgraded counts
        if (entries.length || merged) this.emit('entries', { entries, merged });
      })
      .catch((err) => {
        // include the file so log lines point at the offending transcript
        const e = err as Error;
        this.emit('error', new Error(`tailing ${file}: ${e.message}`, { cause: e }));
      });
    this.busy.set(file, next);
    return next;
  }

  async start(): Promise<UsageEntry[]> {
    const t0 = Date.now();
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
        if (scanned % 20 === 0 || scanned === files.length) {
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
    return all;
  }

  watch(): void {
    const cutoff = Date.now() - WATCH_HORIZON_MS;
    // Iterate roots, not bare dirs: the live filter must ask the SAME adapter
    // that indexed the root whether a file carries usage. Hardcoding a suffix
    // here would let a foreign format index once at startup and then never see
    // another append — silently, with no error to point at.
    for (const { dir, adapter } of this.roots) {
      const w = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: MAX_TREE_DEPTH,
        alwaysStat: true,
        ignorePermissionErrors: true,
        // Old transcripts never change again — skipping them keeps the
        // inotify watch count proportional to recent sessions, not history.
        // (chokidar's anymatch typings omit the (path, stats) form, hence the cast)
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
    Promise.all(this.watchers.map((w) => w.close()))
      .catch(() => {})
      .then(() => {
        this.watchers = [];
        this.offsets.clear();
        this.remainders.clear();
        this.lineNos.clear();
        this.fileSource.clear();
        this.fileStates.clear();
        this.byKey.clear();
        this.byMsg.clear();
        this.resetTs = null;
        this.compactions.length = 0;
        this.toolResultBuckets.clear();
        this.toolResultCount = 0;
        this.busy.clear();
        return this.start();
      })
      .catch((err) => this.emit('error', err as Error))
      .finally(() => {
        this.rescanning = false;
      });
  }

  async stop(): Promise<void> {
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }
}
