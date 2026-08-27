/**
 * @file codex.test.ts
 * @brief Unit tests for the Codex CLI source adapter.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The line shapes here are taken from ccusage's Codex fixtures and its format
 * spec (`rust/adapters/codex/src/README.md`), which is the reference
 * implementation for this format. Where the two could disagree — the cached
 * token mapping especially — the assertion encodes ccusage's reading, because
 * a second source of usage numbers is only worth having if it agrees with the
 * first one.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexAdapter, type CodexState, tierToFast } from '../adapters/codex';
import { ADAPTERS, adapterById } from '../adapters';
import { UsageWatcher } from '../watcher';
import type { UsageEntry } from '../../../shared/types';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-codex-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const state = () => codexAdapter.createState!() as CodexState;

/** Parse a line through the adapter, threading one state object. */
const parse = (raw: string, st: CodexState, lineNo = 1) =>
  codexAdapter.parseLine(raw, '/c/sessions/rollout-x.jsonl', lineNo, null, st);

const turnContext = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: '2026-05-13T09:00:00.000Z',
    type: 'turn_context',
    payload: { model: 'gpt-5.2-codex', ...over },
  });

const tokenCount = (info: Record<string, unknown>, ts = '2026-05-13T09:01:00.000Z') =>
  JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info } });

const settings = (service_tier: unknown, present = true) =>
  JSON.stringify({
    timestamp: '2026-05-13T09:00:30.000Z',
    type: 'event_msg',
    payload: {
      type: 'thread_settings_applied',
      thread_settings: present ? { service_tier } : {},
    },
  });

describe('registry', () => {
  it('ships Codex alongside Claude Code', () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual(['claude', 'codex']);
    expect(adapterById('codex')).toBe(codexAdapter);
  });

  it('is the adapter that made the seam stateful', () => {
    expect(typeof codexAdapter.createState).toBe('function');
    expect(adapterById('claude')!.createState).toBeUndefined();
  });
});

describe('token mapping', () => {
  /**
   * The mistake this guards: Codex's `input_tokens` INCLUDES the cached
   * prompt, so billing it raw double-charges every cached token. On a long
   * session the cache is most of the input, so the error is not small.
   */
  it('subtracts cached tokens out of input, exactly as ccusage does', () => {
    const e = parse(
      tokenCount({
        model: 'gpt-5.2-codex',
        last_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 250,
          output_tokens: 125,
          reasoning_output_tokens: 75,
          total_tokens: 1200,
        },
      }),
      state(),
    );
    expect(e).toMatchObject({ kind: 'entry', in: 750, read: 250, out: 125 });
  });

  it('counts reasoning tokens once — they are already inside output', () => {
    const e = parse(
      tokenCount({
        last_token_usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          output_tokens: 125,
          reasoning_output_tokens: 75,
          total_tokens: 135,
        },
      }),
      state(),
    );
    // 125, never 200
    expect(e).toMatchObject({ out: 125 });
  });

  it('bills no cache writes — Codex has no such concept', () => {
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } }),
      state(),
    );
    expect(e).toMatchObject({ w5m: 0, w1h: 0 });
  });

  it('never returns negative input when cached exceeds the reported input', () => {
    const e = parse(
      tokenCount({
        last_token_usage: { input_tokens: 100, cached_input_tokens: 500, output_tokens: 1 },
      }),
      state(),
    );
    expect(e).toMatchObject({ in: 0, read: 500 });
  });
});

describe('cumulative totals', () => {
  it('prefers the recorded turn delta over the running total', () => {
    const st = state();
    const e = parse(
      tokenCount({
        last_token_usage: { input_tokens: 2500, cached_input_tokens: 500, output_tokens: 300 },
        total_token_usage: { input_tokens: 3500, cached_input_tokens: 750, output_tokens: 425 },
      }),
      st,
    );
    // the DELTA (2500-500), not the running total (3500-750)
    expect(e).toMatchObject({ in: 2000, read: 500, out: 300 });
  });

  it('recovers the delta by subtraction when no last_token_usage exists', () => {
    const st = state();
    const first = parse(
      tokenCount({ total_token_usage: { input_tokens: 1000, output_tokens: 100 } }),
      st,
      1,
    );
    expect(first).toMatchObject({ in: 1000, out: 100 });

    const second = parse(
      tokenCount(
        { total_token_usage: { input_tokens: 2500, output_tokens: 260 } },
        '2026-05-13T09:02:00.000Z',
      ),
      st,
      2,
    );
    // 2500-1000 and 260-100, NOT the cumulative figures
    expect(second).toMatchObject({ in: 1500, out: 160 });
  });

  it('clamps a counter reset to zero instead of going negative', () => {
    const st = state();
    parse(tokenCount({ total_token_usage: { input_tokens: 5000, output_tokens: 500 } }), st, 1);
    const after = parse(
      tokenCount(
        { total_token_usage: { input_tokens: 100, output_tokens: 10 } },
        '2026-05-13T09:03:00.000Z',
      ),
      st,
      2,
    );
    // every field clamped to 0 → nothing billable at all
    expect(after).toBeNull();
  });

  it('ignores a tick that carries no usage', () => {
    expect(parse(tokenCount({ model: 'gpt-5.2-codex' }), state())).toBeNull();
    expect(
      parse(
        tokenCount({ last_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
        state(),
      ),
    ).toBeNull();
  });
});

describe('state carried from earlier lines', () => {
  it('takes the model from a preceding turn_context', () => {
    const st = state();
    expect(parse(turnContext(), st, 1)).toBeNull(); // context lines are never billed
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      st,
      2,
    );
    expect(e).toMatchObject({ model: 'gpt-5.2-codex' });
  });

  it('lets the event name its own model over the remembered one', () => {
    const st = state();
    parse(turnContext({ model: 'gpt-5.2-codex' }), st, 1);
    const e = parse(
      tokenCount({
        model: 'gpt-5.3-codex',
        last_token_usage: { input_tokens: 10, output_tokens: 1 },
      }),
      st,
      2,
    );
    expect(e).toMatchObject({ model: 'gpt-5.3-codex' });
  });

  it('falls back to gpt-5 when a rollout never records a model', () => {
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      state(),
    );
    expect(e).toMatchObject({ model: 'gpt-5' });
  });

  it('attributes the project from turn_context cwd', () => {
    const st = state();
    parse(turnContext({ cwd: '/home/me/work/api' }), st, 1);
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      st,
      2,
    );
    expect(e).toMatchObject({ project: '/home/me/work/api' });
  });
});

describe('service tier → fast flag', () => {
  it('maps both current and legacy spellings', () => {
    expect(tierToFast('priority')).toBe(true);
    expect(tierToFast('fast')).toBe(true);
    expect(tierToFast('default')).toBe(false);
    expect(tierToFast('standard')).toBe(false);
    expect(tierToFast('something-new')).toBeNull();
  });

  it('suffixes the model so the fast turn prices separately', () => {
    const st = state();
    parse(settings('priority'), st, 1);
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      st,
      2,
    );
    expect(e).toMatchObject({ fast: true, model: 'gpt-5-fast' });
  });

  it('inherits the latest tier across turns', () => {
    const st = state();
    parse(settings('priority'), st, 1);
    parse(tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }), st, 2);
    parse(settings('default'), st, 3);
    const e = parse(
      tokenCount(
        { last_token_usage: { input_tokens: 10, output_tokens: 1 } },
        '2026-05-13T09:04:00.000Z',
      ),
      st,
      4,
    );
    expect(e).toMatchObject({ fast: false, model: 'gpt-5' });
  });

  it('leaves the tier alone when the settings event omits the key', () => {
    const st = state();
    parse(settings('priority'), st, 1);
    parse(settings(undefined, false), st, 2); // auto-review threads emit these
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      st,
      3,
    );
    expect(e).toMatchObject({ fast: true });
  });

  it('CLEARS the tier on an unrecognized value rather than keeping a stale one', () => {
    const st = state();
    parse(settings('priority'), st, 1);
    parse(settings('tier-from-the-future'), st, 2);
    const e = parse(
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
      st,
      3,
    );
    expect(e).toMatchObject({ fast: false, model: 'gpt-5' });
  });
});

describe('malformed and irrelevant input', () => {
  it('returns null rather than throwing', () => {
    const st = state();
    expect(parse('{"token_count": broken', st)).toBeNull();
    expect(parse('', st)).toBeNull();
    expect(
      parse(JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }), st),
    ).toBeNull();
  });

  it('skips lines that cannot carry usage without parsing them', () => {
    expect(parse(JSON.stringify({ type: 'message', text: 'hello' }), state())).toBeNull();
  });

  it('rejects a usage event with an unparseable timestamp', () => {
    const raw = JSON.stringify({
      timestamp: 'not-a-date',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10 } } },
    });
    expect(parse(raw, state())).toBeNull();
  });
});

describe('root detection', () => {
  it('finds sessions and archived_sessions under CODEX_HOME', () => {
    const home = path.join(tmp, 'codex-home');
    fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(home, 'archived_sessions'), { recursive: true });
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      expect(
        codexAdapter
          .detectRoots()
          .map((d) => path.basename(d))
          .sort(),
      ).toEqual(['archived_sessions', 'sessions']);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
  });

  it('returns nothing when Codex was never run — absence is not an error', () => {
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmp, 'does-not-exist');
    try {
      expect(codexAdapter.detectRoots()).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
  });
});

describe('end to end through the watcher', () => {
  const rollout = (dir: string, name: string, lines: string[]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
  };

  /** The two-line fixture ccusage ships, so the numbers are cross-checkable. */
  const ccusageFixture = [
    turnContext(),
    tokenCount({
      model: 'gpt-5.2-codex',
      last_token_usage: {
        input_tokens: 1000,
        cached_input_tokens: 250,
        output_tokens: 125,
        reasoning_output_tokens: 75,
        total_tokens: 1200,
      },
      total_token_usage: {
        input_tokens: 1000,
        cached_input_tokens: 250,
        output_tokens: 125,
        reasoning_output_tokens: 75,
        total_tokens: 1200,
      },
    }),
    tokenCount(
      {
        model: 'gpt-5.3-codex',
        last_token_usage: {
          input_tokens: 2500,
          cached_input_tokens: 500,
          output_tokens: 300,
          reasoning_output_tokens: 200,
          total_tokens: 3000,
        },
        total_token_usage: {
          input_tokens: 3500,
          cached_input_tokens: 750,
          output_tokens: 425,
          reasoning_output_tokens: 275,
          total_tokens: 4200,
        },
      },
      '2026-05-14T10:00:00.000Z',
    ),
  ];

  it('indexes a rollout and stamps the codex agent id', async () => {
    const root = path.join(tmp, 'sessions');
    rollout(path.join(root, '2026', '05', '13'), 'rollout-a.jsonl', ccusageFixture);

    const entries = await new UsageWatcher({
      dirs: [{ dir: root, adapter: codexAdapter }],
      watch: false,
    }).start();

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.agent === 'codex')).toBe(true);
    expect(entries.map((e) => e.model)).toEqual(['gpt-5.2-codex', 'gpt-5.3-codex']);
    expect(entries.map((e) => e.in)).toEqual([750, 2000]);
    expect(entries.map((e) => e.read)).toEqual([250, 500]);
  });

  /**
   * The reason the dedupe key is content-addressed. Archiving a rollout leaves
   * the same events under two roots; a subagent rollout replays its parent's
   * history the same way. Neither may be billed twice, and a streaming tailer
   * cannot pre-scan a file to find out.
   */
  it('counts an archived duplicate of a live rollout exactly once', async () => {
    const live = path.join(tmp, 'sessions');
    const archived = path.join(tmp, 'archived_sessions');
    rollout(path.join(live, '2026', '05', '13'), 'rollout-a.jsonl', ccusageFixture);
    rollout(path.join(archived, '2026', '05', '13'), 'rollout-a.jsonl', ccusageFixture);

    const entries = await new UsageWatcher({
      dirs: [
        { dir: live, adapter: codexAdapter },
        { dir: archived, adapter: codexAdapter },
      ],
      watch: false,
    }).start();

    expect(entries).toHaveLength(2); // not 4
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(2750);
  });

  it('does not merge two genuinely different turns', async () => {
    const root = path.join(tmp, 'sessions');
    rollout(path.join(root, 'd'), 'a.jsonl', ccusageFixture);
    const total = (e: UsageEntry) => e.in + e.out + e.read;

    const entries = await new UsageWatcher({
      dirs: [{ dir: root, adapter: codexAdapter }],
      watch: false,
    }).start();
    expect(new Set(entries.map(total)).size).toBe(2);
  });

  /**
   * Per-file state has to survive between tails, or a usage line appended
   * after the model was announced would price as the fallback model.
   */
  it('remembers the model across an incremental append', async () => {
    const root = path.join(tmp, 'sessions');
    const dir = path.join(root, 'd');
    rollout(dir, 'a.jsonl', [turnContext({ model: 'gpt-5.9-codex' })]);
    const file = path.join(dir, 'a.jsonl');

    const w = new UsageWatcher({ dirs: [{ dir: root, adapter: codexAdapter }], watch: false });
    expect(await w.start()).toHaveLength(0); // context only, nothing billable yet

    fs.appendFileSync(
      file,
      `${tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } })}\n`,
    );
    const { entries } = await w.readNew(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('gpt-5.9-codex'); // NOT the gpt-5 fallback
  });

  it("keeps each file's state separate", async () => {
    const root = path.join(tmp, 'sessions');
    rollout(path.join(root, 'd'), 'a.jsonl', [
      turnContext({ model: 'model-a' }),
      tokenCount({ last_token_usage: { input_tokens: 10, output_tokens: 1 } }),
    ]);
    rollout(path.join(root, 'd'), 'b.jsonl', [
      tokenCount(
        { last_token_usage: { input_tokens: 20, output_tokens: 2 } },
        '2026-05-13T09:05:00.000Z',
      ),
    ]);

    const entries = await new UsageWatcher({
      dirs: [{ dir: root, adapter: codexAdapter }],
      watch: false,
    }).start();

    // b.jsonl must NOT inherit a.jsonl's model
    const byIn = new Map(entries.map((e) => [e.in, e.model]));
    expect(byIn.get(10)).toBe('model-a');
    expect(byIn.get(20)).toBe('gpt-5');
  });
});

describe('auto-review fallback model — resolved by session date', () => {
  /**
   * Codex records `codex-auto-review` as the model for an auto-review turn
   * rather than the model that actually ran. Billing that literal string
   * prices the turn at $0 (no catalog has it), so it resolves to whichever
   * model auto-review used at the time — a dated table, like `shared/plans.ts`.
   */
  const autoReview = (ts: string) => {
    const st = codexAdapter.createState!() as CodexState;
    const line = JSON.stringify({
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model: 'codex-auto-review',
          last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
        },
      },
    });
    const out = parse(line, st);
    return out && out.kind === 'entry' ? out.model : null;
  };

  it('picks the model auto-review used on that date', () => {
    expect(autoReview('2026-05-13T09:00:00.000Z')).toBe('gpt-5.5'); // >= 2026-04-23
    expect(autoReview('2026-03-10T09:00:00.000Z')).toBe('gpt-5.4'); // >= 2026-03-05
    expect(autoReview('2026-02-10T09:00:00.000Z')).toBe('gpt-5.3-codex');
    expect(autoReview('2025-12-20T09:00:00.000Z')).toBe('gpt-5.2-codex');
    expect(autoReview('2025-11-20T09:00:00.000Z')).toBe('gpt-5.1-codex');
    expect(autoReview('2025-09-20T09:00:00.000Z')).toBe('gpt-5-codex');
  });

  it('falls back to gpt-5 before the first dated entry', () => {
    expect(autoReview('2025-01-01T09:00:00.000Z')).toBe('gpt-5');
  });

  it('leaves a real model id alone', () => {
    const st = codexAdapter.createState!() as CodexState;
    const out = parse(
      tokenCount({
        model: 'gpt-5.6-terra',
        last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
      }),
      st,
    );
    expect(out && out.kind === 'entry' ? out.model : null).toBe('gpt-5.6-terra');
  });
});

describe('a bare-string root must still reach the right adapter', () => {
  /**
   * The bug this pins cost the app its entire Codex support, silently.
   *
   * `UsageWatcher` accepts `dirs` as either tagged `SourceRoot`s or bare
   * strings, and a bare string used to default to the CLAUDE adapter. main.ts
   * built its watcher from `state.allSourceDirs` — strings, because
   * `refreshSourceDirs` computed the adapter tags and then dropped them with
   * `.map(r => r.dir)`. So the GUI parsed every Codex rollout with the Claude
   * parser, got nothing out, and showed "no usage data yet" for an account
   * with real spend in it.
   *
   * Nothing caught it: the CLI, `npm run smoke` and every other test pass
   * TAGGED roots, so they all saw Codex fine while the app saw none of it.
   * The fallback now resolves the adapter from the tool registry by the dir's
   * own shape, so the seam is right however the caller spells it.
   */
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-bare-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const rollout = [
    turnContext(),
    tokenCount({
      model: 'gpt-5.2-codex',
      last_token_usage: { input_tokens: 1000, cached_input_tokens: 250, output_tokens: 125 },
    }),
  ];

  it('indexes a Codex root passed as a plain string', async () => {
    const sessions = path.join(tmp, 'sessions');
    fs.mkdirSync(path.join(sessions, '2026', '05', '13'), { recursive: true });
    fs.writeFileSync(
      path.join(sessions, '2026', '05', '13', 'rollout-2026-05-13T09-00-00-abc.jsonl'),
      `${rollout.join('\n')}\n`,
    );

    // exactly how main.ts builds its watcher — dirs, not tagged roots
    const entries = await new UsageWatcher({ dirs: [sessions], watch: false }).start();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ model: 'gpt-5.2-codex', in: 750, read: 250 });
  });

  it('still treats a Claude projects dir as Claude', async () => {
    const projects = path.join(tmp, 'projects');
    fs.mkdirSync(path.join(projects, 'proj'), { recursive: true });
    fs.writeFileSync(
      path.join(projects, 'proj', 's.jsonl'),
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-13T09:00:00.000Z',
        message: {
          id: 'm1',
          model: 'claude-opus-5',
          usage: { input_tokens: 5, output_tokens: 2 },
        },
        requestId: 'r1',
      })}\n`,
    );

    const entries = await new UsageWatcher({ dirs: [projects], watch: false }).start();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ model: 'claude-opus-5' });
  });
});

describe('forked sessions — the replayed prefix is not billed twice', () => {
  /**
   * A forked or subagent rollout REPLAYS its parent's history before its own
   * first turn, and Codex REWRITES those events to the fork instant. That
   * rewrite is what defeats the content-addressed dedupe key: same token
   * counts, different timestamp, so the key does not collide and the parent's
   * whole history bills a second time.
   *
   * The fix mirrors ccusage: match the child's leading usage against the
   * parent's, by TOKEN VALUES rather than timestamps, and skip what matches.
   */
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-codex-fork-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const meta = (id: string, over: Record<string, unknown> = {}, ts = '2026-05-13T09:00:00.000Z') =>
    JSON.stringify({
      timestamp: ts,
      type: 'session_meta',
      payload: { id, session_id: id, cwd: '/w/api', ...over },
    });

  const usage = (input: number, out: number, ts: string) =>
    JSON.stringify({
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model: 'gpt-5.2-codex',
          last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: out },
        },
      },
    });

  const write = (dir: string, name: string, lines: string[]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
  };

  const PARENT = 'aaaaaaaa-0000-0000-0000-000000000001';
  const CHILD = 'bbbbbbbb-0000-0000-0000-000000000002';
  const sessions = () => path.join(tmp, 'sessions', '2026', '05', '13');

  const run = async () =>
    new UsageWatcher({
      dirs: [{ dir: path.join(tmp, 'sessions'), adapter: codexAdapter }],
      watch: false,
    }).start();

  it("skips the replayed prefix and keeps the child's own turns", async () => {
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT),
      usage(100, 10, '2026-05-13T09:01:00.000Z'),
      usage(200, 20, '2026-05-13T09:02:00.000Z'),
    ]);
    // the child replays both parent turns, rewritten to the fork instant
    write(sessions(), `rollout-2026-05-13T10-00-00-${CHILD}.jsonl`, [
      meta(CHILD, { forked_from_id: PARENT }, '2026-05-13T10:00:00.000Z'),
      usage(100, 10, '2026-05-13T10:00:00.010Z'),
      usage(200, 20, '2026-05-13T10:00:00.025Z'),
      usage(300, 30, '2026-05-13T10:00:06.000Z'), // the child's own turn
    ]);

    const entries = await run();
    // parent's 2 + the child's 1 — NOT 5
    expect(entries).toHaveLength(3);
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(100 + 200 + 300);
  });

  it('recognises a spawned subagent as well as an explicit fork', async () => {
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT),
      usage(100, 10, '2026-05-13T09:01:00.000Z'),
    ]);
    write(sessions(), `rollout-2026-05-13T10-00-00-${CHILD}.jsonl`, [
      meta(
        CHILD,
        { source: { subagent: { thread_spawn: { parent_thread_id: PARENT } } } },
        '2026-05-13T10:00:00.000Z',
      ),
      usage(100, 10, '2026-05-13T10:00:00.010Z'),
      usage(500, 50, '2026-05-13T10:00:09.000Z'),
    ]);

    const entries = await run();
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(100 + 500);
  });

  it('falls back to the rewritten burst when the parent rollout is gone', async () => {
    // No parent file at all. The burst signature stands in for it: Codex
    // writes the replayed history in one go (10-40ms) and the child's own
    // first turn follows a real pause (measured 5.8-15.3s upstream).
    write(sessions(), `rollout-2026-05-13T10-00-00-${CHILD}.jsonl`, [
      meta(CHILD, { forked_from_id: PARENT }, '2026-05-13T10:00:00.000Z'),
      usage(100, 10, '2026-05-13T10:00:00.010Z'),
      usage(200, 20, '2026-05-13T10:00:00.025Z'),
      usage(300, 30, '2026-05-13T10:00:06.000Z'), // after the pause — the child's
    ]);

    const entries = await run();
    expect(entries).toHaveLength(1);
    expect(entries[0].in).toBe(300);
  });

  it('bills every turn of a session that declares no parent', async () => {
    // The burst heuristic must NEVER touch a normal session: two quick turns
    // in a row are perfectly ordinary when nothing was forked.
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT),
      usage(100, 10, '2026-05-13T09:00:00.010Z'),
      usage(200, 20, '2026-05-13T09:00:00.020Z'),
    ]);

    const entries = await run();
    expect(entries).toHaveLength(2);
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(300);
  });

  it('ignores a session that names itself as its own parent', async () => {
    // Would otherwise match its whole stream against itself and drop every
    // event it recorded.
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT, { forked_from_id: PARENT }),
      usage(100, 10, '2026-05-13T09:01:00.000Z'),
      usage(200, 20, '2026-05-13T09:02:00.000Z'),
    ]);

    const entries = await run();
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(300);
  });

  it('stops skipping as soon as the child diverges from the parent', async () => {
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT),
      usage(100, 10, '2026-05-13T09:01:00.000Z'),
      usage(200, 20, '2026-05-13T09:02:00.000Z'),
    ]);
    // only the FIRST parent turn was replayed; the second differs
    write(sessions(), `rollout-2026-05-13T10-00-00-${CHILD}.jsonl`, [
      meta(CHILD, { forked_from_id: PARENT }, '2026-05-13T10:00:00.000Z'),
      usage(100, 10, '2026-05-13T10:00:00.010Z'),
      usage(999, 99, '2026-05-13T10:00:00.020Z'),
    ]);

    const entries = await run();
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(100 + 200 + 999);
  });

  it('does not replay parent usage recorded AFTER the fork', async () => {
    // The parent kept working after the branch; those turns were never
    // replayed into the child and must not mask the child's own events.
    write(sessions(), `rollout-2026-05-13T09-00-00-${PARENT}.jsonl`, [
      meta(PARENT),
      usage(100, 10, '2026-05-13T09:01:00.000Z'),
      usage(700, 70, '2026-05-13T11:00:00.000Z'), // after the 10:00 fork
    ]);
    write(sessions(), `rollout-2026-05-13T10-00-00-${CHILD}.jsonl`, [
      meta(CHILD, { forked_from_id: PARENT }, '2026-05-13T10:00:00.000Z'),
      usage(100, 10, '2026-05-13T10:00:00.010Z'), // replayed
      usage(700, 70, '2026-05-13T10:00:20.000Z'), // the child's own, same shape
    ]);

    const entries = await run();
    expect(entries.reduce((n, e) => n + e.in, 0)).toBe(100 + 700 + 700);
  });
});
