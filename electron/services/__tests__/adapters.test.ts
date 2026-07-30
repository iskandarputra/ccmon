/**
 * @file adapters.test.ts
 * @brief Unit tests for the source-adapter seam, exercised with a second format.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The point of these tests is NOT to check Claude Code parsing (parser.test.ts
 * does that). It is to prove the seam actually accommodates a different data
 * format — a one-implementation abstraction is an unproven one.
 *
 * The fake format is modelled on the shape Gemini CLI really writes
 * (`{type, model, timestamp, tokens: {input, output, cached, ...}}`) so the
 * interface is validated against a real-world layout rather than a convenient
 * one.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageWatcher } from '../watcher';
import { ADAPTERS, adapterById, claudeAdapter, detectSourceRoots } from '../adapters';
import type { SourceAdapter } from '../adapters/types';
import type { ParsedLine } from '../../../shared/types';
import { dayKeyFor } from '../../../shared/daykey';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-adapters-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A second, deliberately different format: Gemini-CLI-shaped usage lines. */
function makeFakeAdapter(root: string): SourceAdapter {
  return {
    id: 'fake',
    label: 'Fake CLI',
    detectRoots: () => [root],
    // NOT "every .jsonl" — this tool keeps prompt history beside its usage log,
    // which is exactly why `owns` exists on the interface.
    owns: (file) => file.endsWith('.usage.jsonl'),
    parseLine: (raw, file, lineNo, zone): ParsedLine => {
      let j: {
        type?: string;
        model?: string;
        timestamp?: string;
        tokens?: { input?: number; output?: number; cached?: number };
      };
      try {
        j = JSON.parse(raw);
      } catch {
        return null;
      }
      if (j.type !== 'gemini' || !j.model || !j.tokens) return null;
      const ts = Date.parse(j.timestamp ?? '');
      if (!Number.isFinite(ts)) return null;
      return {
        kind: 'entry',
        key: `fake:${file}#${lineNo}`,
        msgId: null,
        ts,
        dateKey: dayKeyFor(ts, zone),
        model: j.model,
        fast: false,
        project: '/fake',
        sessionId: path.basename(file, '.usage.jsonl'),
        sidechain: false,
        in: j.tokens.input ?? 0,
        out: j.tokens.output ?? 0,
        read: j.tokens.cached ?? 0,
        w5m: 0,
        w1h: 0,
        costUSD: null,
      };
    },
  };
}

const usageLine = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'gemini',
    model: 'gemini-3-flash-preview',
    timestamp: '2026-05-18T08:23:21.960Z',
    tokens: { input: 11497, output: 194, cached: 3792, thoughts: 860, tool: 0, total: 12551 },
    ...over,
  });

describe('adapter registry', () => {
  it('ships Claude Code and can look it up by id', () => {
    expect(ADAPTERS.map((a) => a.id)).toContain('claude');
    expect(adapterById('claude')).toBe(claudeAdapter);
    expect(adapterById('nope')).toBeNull();
  });

  it('tags each discovered root with its adapter', () => {
    const roots = detectSourceRoots();
    for (const r of roots) {
      expect(typeof r.dir).toBe('string');
      expect(ADAPTERS).toContain(r.adapter);
    }
  });

  it('never lets two adapters claim the same dir', () => {
    const dirs = detectSourceRoots().map((r) => r.dir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});

describe('watcher — adapter routing', () => {
  it('accepts a bare string[] as Claude Code roots (back-compat)', () => {
    const w = new UsageWatcher({ dirs: ['/a', '/b'], watch: false });
    expect(w.dirs).toEqual(['/a', '/b']);
    expect(w.roots.map((r) => r.adapter.id)).toEqual(['claude', 'claude']);
  });

  it('indexes a foreign format through its adapter and stamps the agent id', async () => {
    const root = path.join(tmp, 'fake-root');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'sess-1.usage.jsonl'),
      `${usageLine()}\n${usageLine({ tokens: { input: 100, output: 20, cached: 5 } })}\n`,
    );

    const adapter = makeFakeAdapter(root);
    const entries = await new UsageWatcher({
      dirs: [{ dir: root, adapter }],
      watch: false,
    }).start();

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.agent === 'fake')).toBe(true);
    expect(entries.map((e) => e.in).sort((a, b) => a - b)).toEqual([100, 11497]);
    // `cached` mapped onto ccmon's cache-read field
    expect(entries.some((e) => e.read === 3792)).toBe(true);
  });

  it('honours the adapter\'s `owns` — a sibling log is not usage', async () => {
    const root = path.join(tmp, 'mixed');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.usage.jsonl'), `${usageLine()}\n`);
    // same tree, same extension family, but not a usage log
    fs.writeFileSync(
      path.join(root, 'history.jsonl'),
      `${JSON.stringify({ display: 'a prompt', timestamp: 1779677786524 })}\n`,
    );

    const entries = await new UsageWatcher({
      dirs: [{ dir: root, adapter: makeFakeAdapter(root) }],
      watch: false,
    }).start();
    expect(entries).toHaveLength(1);
  });

  it('keeps two formats separate in one index, each with its own agent', async () => {
    const fakeRoot = path.join(tmp, 'fake');
    const claudeRoot = path.join(tmp, 'claude', 'projects', 'proj');
    fs.mkdirSync(fakeRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });

    fs.writeFileSync(path.join(fakeRoot, 's.usage.jsonl'), `${usageLine()}\n`);
    fs.writeFileSync(
      path.join(claudeRoot, 'sess.jsonl'),
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-18T08:30:00.000Z',
        sessionId: 'c1',
        requestId: 'r1',
        cwd: '/proj',
        message: {
          id: 'm1',
          model: 'claude-opus-5',
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      })}\n`,
    );

    const entries = await new UsageWatcher({
      dirs: [
        { dir: fakeRoot, adapter: makeFakeAdapter(fakeRoot) },
        { dir: path.join(tmp, 'claude', 'projects'), adapter: claudeAdapter },
      ],
      watch: false,
    }).start();

    const byAgent = new Map(entries.map((e) => [e.agent, e]));
    expect([...byAgent.keys()].sort()).toEqual(['claude', 'fake']);
    expect(byAgent.get('claude')!.model).toBe('claude-opus-5');
    expect(byAgent.get('fake')!.model).toBe('gemini-3-flash-preview');
    // and each entry is attributed to its own root
    expect(byAgent.get('fake')!.source).toBe(fakeRoot);
  });

  it('ignores a root whose adapter finds nothing, without failing', async () => {
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    const entries = await new UsageWatcher({
      dirs: [{ dir: empty, adapter: makeFakeAdapter(empty) }],
      watch: false,
    }).start();
    expect(entries).toEqual([]);
  });
});

describe('claude adapter', () => {
  it('claims every .jsonl, because transcripts nest at several depths', () => {
    expect(claudeAdapter.owns('/x/projects/p/sess.jsonl')).toBe(true);
    expect(claudeAdapter.owns('/x/projects/p/s/subagents/agent-1.jsonl')).toBe(true);
    expect(claudeAdapter.owns('/x/projects/p/notes.md')).toBe(false);
  });

  it('parses through the same code path as the bare parser', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T08:30:00.000Z',
      message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 5, output_tokens: 2 } },
    });
    const parsed = claudeAdapter.parseLine(raw, '/x/projects/p/s.jsonl', 1, null);
    expect(parsed).toMatchObject({ kind: 'entry', model: 'claude-opus-5', in: 5, out: 2 });
  });
});
