/**
 * @file watcher.test.ts
 * @brief Unit tests for the tailer: best-wins dedupe, incremental reads, seam routing.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * `npm run parity` proves the dedupe is RIGHT against ccusage, but it needs the
 * network and a real corpus and it can only ever say "the totals match" — it
 * cannot localize a regression to `merge()`. These tests are the other half:
 * they pin each dedupe rule individually so a broken rule names itself.
 *
 * The rules under test (watcher.merge / watcher.accept):
 *   1. non-sidechain beats sidechain      — subagent usage is mirrored into the
 *                                           parent transcript; count it once
 *   2. else larger token total wins       — streaming chunks repeat a key with
 *                                           CUMULATIVE usage, so the last is
 *                                           the whole turn, not an increment
 *   3. else the fast-flagged copy wins    — fast-mode turns price separately
 *   4. tools/stop upgrade, never downgrade
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageWatcher } from '../watcher';
import { claudeAdapter } from '../adapters';
import { makeEntry } from './helpers';
import type { SourceAdapter } from '../adapters/types';
import type { ParsedLine, UsageEntry } from '../../../shared/types';
import { dayKeyFor } from '../../../shared/daykey';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-watcher-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A watcher with no roots — enough to exercise the pure dedupe methods. */
const bare = () => new UsageWatcher({ dirs: [], watch: false });

/** One Claude Code assistant line. */
function claudeLine(over: Record<string, unknown> = {}): string {
  const { usage, message, ...rest } = over as {
    usage?: Record<string, number>;
    message?: Record<string, unknown>;
  };
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-18T08:30:00.000Z',
    sessionId: 's1',
    requestId: 'r1',
    cwd: '/proj',
    ...rest,
    message: {
      id: 'm1',
      model: 'claude-opus-5',
      usage: { input_tokens: 10, output_tokens: 5, ...usage },
      ...message,
    },
  });
}

describe('merge — best-wins rules', () => {
  it('rule 1: a non-sidechain copy replaces the stored sidechain one', () => {
    const w = bare();
    // the sidechain copy is LARGER, to prove rule 1 outranks rule 2
    const stored = makeEntry({ sidechain: true, in: 9999, out: 9999 });
    const cand = makeEntry({ sidechain: false, in: 1, out: 1 });

    expect(w.merge(stored, cand)).toBe(true);
    expect(stored.sidechain).toBe(false);
    expect(stored.in).toBe(1);
  });

  it('rule 1: a sidechain copy never replaces the stored non-sidechain one', () => {
    const w = bare();
    const stored = makeEntry({ sidechain: false, in: 1, out: 1 });
    const cand = makeEntry({ sidechain: true, in: 9999, out: 9999 });

    expect(w.merge(stored, cand)).toBe(false);
    expect(stored.in).toBe(1);
  });

  it('rule 2: the larger cumulative chunk wins (streaming is not additive)', () => {
    const w = bare();
    const stored = makeEntry({ in: 100, out: 10, read: 0, w5m: 0, w1h: 0 });
    const cand = makeEntry({ in: 100, out: 40, read: 0, w5m: 0, w1h: 0 });

    expect(w.merge(stored, cand)).toBe(true);
    // replaced, NOT summed — 40, never 50
    expect(stored.out).toBe(40);
  });

  it('rule 2: counts every token field, not just input+output', () => {
    const w = bare();
    const stored = makeEntry({ in: 0, out: 0, read: 500, w5m: 0, w1h: 0 });
    const cand = makeEntry({ in: 0, out: 0, read: 0, w5m: 300, w1h: 300 });

    expect(w.merge(stored, cand)).toBe(true); // 600 > 500
    expect(stored.read).toBe(0);
    expect(stored.w1h).toBe(300);
  });

  it('rule 2: a smaller chunk is rejected outright', () => {
    const w = bare();
    const stored = makeEntry({ in: 100, out: 40 });
    const cand = makeEntry({ in: 100, out: 10 });

    expect(w.merge(stored, cand)).toBe(false);
    expect(stored.out).toBe(40);
  });

  it('rule 3: on an exact token tie, the fast-flagged copy wins', () => {
    const w = bare();
    const stored = makeEntry({ fast: false, model: 'claude-opus-5' });
    const cand = makeEntry({ fast: true, model: 'claude-opus-5-fast' });

    expect(w.merge(stored, cand)).toBe(true);
    expect(stored.fast).toBe(true);
    // the model carries the -fast suffix and must travel with the flag, or the
    // entry would price at the base rate while claiming to be a fast turn
    expect(stored.model).toBe('claude-opus-5-fast');
  });

  it('rule 3: an identical non-fast duplicate changes nothing', () => {
    const w = bare();
    const stored = makeEntry({ fast: false });
    const cand = makeEntry({ fast: false });

    expect(w.merge(stored, cand)).toBe(false);
  });

  it('rule 4: tools and stop upgrade from the better copy', () => {
    const w = bare();
    const stored = makeEntry({ in: 1, tools: undefined, stop: null });
    const cand = makeEntry({ in: 999, tools: ['Bash'], stop: 'tool_use' });

    expect(w.merge(stored, cand)).toBe(true);
    expect(stored.tools).toEqual(['Bash']);
    expect(stored.stop).toBe('tool_use');
  });

  it('rule 4: a known tools/stop is never downgraded to nothing', () => {
    const w = bare();
    const stored = makeEntry({ in: 1, tools: ['Read'], stop: 'end_turn' });
    const cand = makeEntry({ in: 999, tools: undefined, stop: null });

    expect(w.merge(stored, cand)).toBe(true); // the candidate IS the better copy
    expect(stored.tools).toEqual(['Read']); // …but it carries no better answer here
    expect(stored.stop).toBe('end_turn');
  });

  it('mutates in place so an already-sorted index needs no re-sort', () => {
    const w = bare();
    const stored = makeEntry({ in: 1 });
    const before = stored;
    w.merge(stored, makeEntry({ in: 999 }));
    expect(stored).toBe(before);
  });
});

describe('accept — dedupe verdicts', () => {
  it('indexes a first sighting as new', () => {
    const w = bare();
    expect(w.accept(makeEntry({ key: 'a:1', msgId: 'm-a' }))).toBe('new');
  });

  it('merges a repeat of the same key when the repeat is better', () => {
    const w = bare();
    const first = makeEntry({ key: 'a:1', msgId: 'm-a', in: 10 });
    w.accept(first);

    expect(w.accept(makeEntry({ key: 'a:1', msgId: 'm-a', in: 900 }))).toBe('merged');
    expect(first.in).toBe(900);
  });

  it('rejects a repeat that carries nothing better — no double count', () => {
    const w = bare();
    const first = makeEntry({ key: 'a:1', msgId: 'm-a', in: 900 });
    w.accept(first);

    expect(w.accept(makeEntry({ key: 'a:1', msgId: 'm-a', in: 10 }))).toBe(false);
    expect(first.in).toBe(900);
  });

  it('collapses a messageId replayed across the sidechain boundary', () => {
    const w = bare();
    // subagent transcript first, then the parent's mirror under a NEW requestId
    const sub = makeEntry({ key: 'm1:req-sub', msgId: 'm1', sidechain: true, in: 50 });
    expect(w.accept(sub)).toBe('new');

    const parent = makeEntry({ key: 'm1:req-parent', msgId: 'm1', sidechain: false, in: 50 });
    expect(w.accept(parent)).toBe('merged');
    expect(sub.sidechain).toBe(false); // upgraded in place, still ONE entry
  });

  it('routes later chunks of a collapsed pair straight down the exact-key path', () => {
    const w = bare();
    const sub = makeEntry({ key: 'm1:req-sub', msgId: 'm1', sidechain: true, in: 50 });
    w.accept(sub);
    w.accept(makeEntry({ key: 'm1:req-parent', msgId: 'm1', sidechain: false, in: 50 }));

    // the shortcut registered by the cross-boundary merge means this hits the
    // exact map, so a growing cumulative chunk still lands on the same entry
    expect(w.accept(makeEntry({ key: 'm1:req-parent', msgId: 'm1', in: 900 }))).toBe('merged');
    expect(sub.in).toBe(900);
  });

  it('keeps two DIFFERENT messageIds apart even when neither is a sidechain', () => {
    const w = bare();
    expect(w.accept(makeEntry({ key: 'a:1', msgId: 'm-a' }))).toBe('new');
    expect(w.accept(makeEntry({ key: 'b:1', msgId: 'm-b' }))).toBe('new');
  });

  it('does NOT collapse a shared messageId when neither copy is a sidechain', () => {
    // two genuinely distinct requests that happen to share a message id are not
    // the mirror case — only the sidechain boundary triggers the msgId path
    const w = bare();
    expect(w.accept(makeEntry({ key: 'm1:r1', msgId: 'm1', sidechain: false }))).toBe('new');
    expect(w.accept(makeEntry({ key: 'm1:r2', msgId: 'm1', sidechain: false }))).toBe('new');
  });

  it('indexes entries with no messageId by their file#line fallback key', () => {
    const w = bare();
    expect(w.accept(makeEntry({ key: 'f:/a.jsonl#1', msgId: null }))).toBe('new');
    expect(w.accept(makeEntry({ key: 'f:/a.jsonl#2', msgId: null }))).toBe('new');
  });
});

describe('readNew — incremental tailing', () => {
  const write = (name: string, body: string) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, body);
    return p;
  };

  it('reads only what was appended since the last offset', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write('s.jsonl', `${claudeLine({ requestId: 'r1' })}\n`);

    expect((await w.readNew(file)).entries).toHaveLength(1);
    expect((await w.readNew(file)).entries).toHaveLength(0); // nothing new

    fs.appendFileSync(file, `${claudeLine({ requestId: 'r2', message: { id: 'm2' } })}\n`);
    expect((await w.readNew(file)).entries).toHaveLength(1);
  });

  it('holds a trailing partial line until its newline arrives', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const full = claudeLine();
    const cut = Math.floor(full.length / 2);
    const file = write('s.jsonl', full.slice(0, cut)); // no newline yet

    expect((await w.readNew(file)).entries).toHaveLength(0);

    fs.appendFileSync(file, `${full.slice(cut)}\n`);
    const out = await w.readNew(file);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].in).toBe(10); // reassembled, not corrupted
  });

  it('reports a merge without emitting a duplicate entry', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write('s.jsonl', `${claudeLine({ usage: { output_tokens: 5 } })}\n`);
    await w.readNew(file);

    // same message+request, later cumulative chunk
    fs.appendFileSync(file, `${claudeLine({ usage: { output_tokens: 80 } })}\n`);
    const out = await w.readNew(file);
    expect(out.entries).toHaveLength(0);
    expect(out.merged).toBe(1);
  });

  it('treats a shrunk file as a truncation and asks for a rescan', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write('s.jsonl', `${claudeLine()}\n${claudeLine({ requestId: 'r2' })}\n`);
    await w.readNew(file);

    const reasons: string[] = [];
    w.on('reset', ({ reason }) => reasons.push(reason));
    fs.writeFileSync(file, ''); // rotated / rewritten
    await w.readNew(file);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('truncated');
    await w.stop();
  });

  it('keeps what it indexed when a file disappears mid-session', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write('s.jsonl', `${claudeLine()}\n`);
    await w.readNew(file);
    fs.rmSync(file);

    await expect(w.readNew(file)).resolves.toEqual({ entries: [], merged: 0 });
  });

  it('survives a corrupt line without losing the ones around it', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write(
      's.jsonl',
      `${claudeLine({ requestId: 'r1' })}\n{"usage":truncated…\n${claudeLine({
        requestId: 'r2',
        message: { id: 'm2' },
      })}\n`,
    );
    expect((await w.readNew(file)).entries).toHaveLength(2);
  });

  it('collects reset markers instead of indexing them', async () => {
    const w = new UsageWatcher({ dirs: [tmp], watch: false });
    const file = write(
      's.jsonl',
      `${JSON.stringify({
        isApiErrorMessage: true,
        timestamp: '2026-05-18T08:00:00.000Z',
        message: { content: 'Claude AI usage limit reached|1779000000' },
      })}\n`,
    );
    expect((await w.readNew(file)).entries).toHaveLength(0);
    expect(w.resetTs).toBe(1779000000 * 1000);
  });
});

describe('listFiles — per-root adapter routing', () => {
  /** Format whose usage log is NOT a .jsonl — the case the old code missed. */
  const ndjsonAdapter = (): SourceAdapter => ({
    id: 'nd',
    label: 'ND CLI',
    detectRoots: () => [],
    owns: (file) => file.endsWith('.ndjson'),
    parseLine: (raw, file, lineNo, zone): ParsedLine => {
      let j: { model?: string; timestamp?: string; tokens?: { input?: number } };
      try {
        j = JSON.parse(raw);
      } catch {
        return null;
      }
      const ts = Date.parse(j.timestamp ?? '');
      if (!j.model || !Number.isFinite(ts)) return null;
      return {
        kind: 'entry',
        key: `nd:${file}#${lineNo}`,
        msgId: null,
        ts,
        dateKey: dayKeyFor(ts, zone),
        model: j.model,
        fast: false,
        project: '/nd',
        sessionId: 'nd',
        sidechain: false,
        in: j.tokens?.input ?? 0,
        out: 0,
        read: 0,
        w5m: 0,
        w1h: 0,
        costUSD: null,
      };
    },
  });

  const ndLine = () =>
    JSON.stringify({ model: 'nd-1', timestamp: '2026-05-18T09:00:00.000Z', tokens: { input: 7 } });

  it("asks each root its OWN adapter, never a neighbour's", async () => {
    const ndRoot = path.join(tmp, 'nd');
    const claudeRoot = path.join(tmp, 'claude');
    fs.mkdirSync(ndRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });

    // each root holds BOTH extensions; only the adapter's own must be picked up
    fs.writeFileSync(path.join(ndRoot, 'a.ndjson'), `${ndLine()}\n`);
    fs.writeFileSync(path.join(ndRoot, 'b.jsonl'), `${claudeLine()}\n`);
    fs.writeFileSync(path.join(claudeRoot, 'c.jsonl'), `${claudeLine()}\n`);
    fs.writeFileSync(path.join(claudeRoot, 'd.ndjson'), `${ndLine()}\n`);

    const files = await new UsageWatcher({
      dirs: [
        { dir: ndRoot, adapter: ndjsonAdapter() },
        { dir: claudeRoot, adapter: claudeAdapter },
      ],
      watch: false,
    }).listFiles();

    expect(files.map((f) => path.basename(f)).sort()).toEqual(['a.ndjson', 'c.jsonl']);
  });

  it('walks nested trees to the documented depth', async () => {
    const deep = path.join(tmp, 'projects', 'p', 'sess', 'subagents', 'workflows', 'wf_1');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'agent-1.jsonl'), `${claudeLine()}\n`);

    const files = await new UsageWatcher({
      dirs: [path.join(tmp, 'projects')],
      watch: false,
    }).listFiles();
    expect(files).toHaveLength(1);
  });

  it('honours sinceMs by file mtime', async () => {
    const root = path.join(tmp, 'projects');
    fs.mkdirSync(root, { recursive: true });
    const old = path.join(root, 'old.jsonl');
    const fresh = path.join(root, 'fresh.jsonl');
    fs.writeFileSync(old, `${claudeLine()}\n`);
    fs.writeFileSync(fresh, `${claudeLine()}\n`);
    const longAgo = Date.now() - 30 * 24 * 3600 * 1000;
    fs.utimesSync(old, longAgo / 1000, longAgo / 1000);

    const files = await new UsageWatcher({
      dirs: [root],
      watch: false,
      sinceMs: Date.now() - 24 * 3600 * 1000,
    }).listFiles();
    expect(files.map((f) => path.basename(f))).toEqual(['fresh.jsonl']);
  });

  /**
   * Regression: the live filter used to hardcode `.jsonl` instead of asking the
   * adapter, so a foreign format indexed once at startup and then went deaf.
   * Startup-only coverage cannot catch that — this has to tail for real.
   */
  it('live-tails a foreign format through its adapter, not a hardcoded suffix', async () => {
    const root = path.join(tmp, 'nd-live');
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, 'live.ndjson');
    fs.writeFileSync(file, `${ndLine()}\n`);

    const w = new UsageWatcher({
      dirs: [{ dir: root, adapter: ndjsonAdapter() }],
      watch: true,
    });
    const seen: UsageEntry[] = [];
    w.on('entries', ({ entries }) => seen.push(...entries));

    try {
      expect(await w.start()).toHaveLength(1); // initial index

      // give chokidar a moment to arm before appending
      await new Promise((r) => setTimeout(r, 200));
      fs.appendFileSync(file, `${ndLine()}\n`);

      const deadline = Date.now() + 5000;
      while (seen.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(seen).toHaveLength(1);
      expect(seen[0].model).toBe('nd-1');
    } finally {
      await w.stop();
    }
  }, 15_000);
});

describe('source attribution', () => {
  it('maps a file to its owning root and memoizes the answer', () => {
    const w = new UsageWatcher({ dirs: ['/roots/a', '/roots/b'], watch: false });
    expect(w.sourceOf(path.join('/roots/b', 'p', 's.jsonl'))).toBe('/roots/b');
    expect(w.sourceOf(path.join('/roots/a', 's.jsonl'))).toBe('/roots/a');
  });

  it('falls back to the first root for a file outside every root', () => {
    const w = new UsageWatcher({ dirs: ['/roots/a'], watch: false });
    expect(w.sourceOf('/elsewhere/s.jsonl')).toBe('/roots/a');
  });

  it('resolves the adapter through the root, defaulting to Claude Code', () => {
    const w = new UsageWatcher({ dirs: ['/roots/a'], watch: false });
    expect(w.adapterOf(path.join('/roots/a', 's.jsonl'))).toBe(claudeAdapter);
  });
});
