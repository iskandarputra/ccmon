/**
 * @file advisor.test.ts
 * @brief Unit tests for the AI advisor request shape and its privacy contract.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Two things here are not merely behavioural:
 *
 *   1. PRIVACY. `buildUsageContext` is the only thing that ever leaves the
 *      machine on this path, and it must carry aggregates only — never a
 *      prompt, a transcript line, or a session's contents. A regression here
 *      is a data leak, not a bug, so it is asserted directly.
 *   2. The CLAUDE CODE IDENTITY system prompt. Anthropic's ToS scopes the
 *      stored OAuth token to Claude Code, and the API rejects OAuth inference
 *      without it. Drop it and the advisor 401s for every user at once.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAdvisor, buildUsageContext } from '../advisor';
import type { Snapshot } from '../../../shared/types';

afterEach(() => vi.unstubAllGlobals());

/** Minimal snapshot with just the fields buildUsageContext reads. */
const snapshot = (over: Record<string, unknown> = {}): Snapshot =>
  ({
    generatedAt: Date.parse('2026-06-01T00:00:00Z'),
    totals: { cost: 1234.5, tokens: 9_000_000, entries: 500, sessions: 12 },
    today: { cost: 10 },
    week: { cost: 70 },
    records: { avgDailyCost: 25, maxDay: { date: '2026-05-20', cost: 99 } },
    cache: { hitRate: 0.98, savedUSD: 500, idle: { extraUSD: 12 } },
    compactions: 3,
    models: [{ model: 'claude-opus-5', cost: 1000, in: 100, out: 200 }],
    projects: [{ path: '/home/u/work/secret-project', cost: 900, weekCost: 40 }],
    toolUse: { invocations: 10, turns: 8, rows: [{ name: 'Bash', invocations: 6 }] },
    whatIf: [{ model: 'claude-haiku-4-5', totalCost: 100, delta: -1134.5 }],
    ...over,
  }) as unknown as Snapshot;

const ok = (text: string) =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ content: [{ type: 'text', text }] })),
  }) as Response;

const fail = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

describe('buildUsageContext — privacy contract', () => {
  const ctx = () => buildUsageContext(snapshot(), {}, {});

  it('includes the aggregates the advisor is meant to reason about', () => {
    const c = ctx();
    expect(c).toContain('claude-opus-5');
    expect(c).toContain('Cache hit rate 98%');
    expect(c).toContain('Compactions: 3');
  });

  /**
   * The summary is built from a Snapshot, which holds no message content at
   * all — this asserts the shape stays that way if someone later adds a field.
   */
  it('carries no transcript, prompt or message content', () => {
    const c = ctx().toLowerCase();
    for (const leak of ['"role"', 'tool_result', 'transcript', 'sessionid', 'message.content']) {
      expect(c).not.toContain(leak);
    }
  });

  it('reduces a project path to its last segment, not the full filesystem path', () => {
    const c = ctx();
    expect(c).toContain('secret-project');
    expect(c).not.toContain('/home/u/work/secret-project');
  });

  it('survives a snapshot with every optional list empty', () => {
    const bare = snapshot({
      models: [],
      projects: [],
      toolUse: { invocations: 0, turns: 0, rows: [] },
      whatIf: [],
      records: { avgDailyCost: 0, maxDay: null },
    });
    expect(() => buildUsageContext(bare, {}, {})).not.toThrow();
  });
});

describe('askAdvisor — request shape', () => {
  const call = (over: Record<string, unknown> = {}) =>
    askAdvisor({
      token: 'tok-123',
      model: 'claude-sonnet-4-6',
      question: 'why is my spend high?',
      history: [],
      context: '# Usage summary',
      ...over,
    });

  const capture = (res: Response) => {
    const spy = vi.fn(() => Promise.resolve(res));
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  const bodyOf = (spy: ReturnType<typeof capture>) =>
    JSON.parse((spy.mock.calls[0] as unknown as [string, { body: string }])[1].body) as Record<
      string,
      never
    >;

  const headersOf = (spy: ReturnType<typeof capture>) =>
    (spy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;

  it('returns the assistant answer on success', async () => {
    capture(ok('Your cache hit rate is fine.'));
    const r = await call();
    expect(r).toMatchObject({ ok: true, answer: 'Your cache hit rate is fine.' });
  });

  it('treats an empty completion as a failure rather than a blank answer', async () => {
    capture(ok(''));
    const r = await call();
    expect(r.ok).toBe(false);
  });

  /** Without this exact system prompt the API rejects OAuth-token inference. */
  it('sends the Claude Code identity as the system prompt', async () => {
    const spy = capture(ok('hi'));
    await call();
    expect(bodyOf(spy).system).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  it('sends the OAuth bearer token and the beta header', async () => {
    const spy = capture(ok('hi'));
    await call();
    const headers = headersOf(spy);
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  it('puts the context first and the question last, with history between', async () => {
    const spy = capture(ok('hi'));
    await call({
      history: [
        { role: 'user', content: 'earlier q' },
        { role: 'assistant', content: 'earlier a' },
      ],
      question: 'the new question',
    });
    const messages = bodyOf(spy).messages as unknown as { role: string; content: string }[];
    expect(messages[0].content).toContain('# Usage summary');
    expect(messages.map((m) => m.content)).toContain('earlier q');
    expect(messages[messages.length - 1].content).toBe('the new question');
  });

  it('honours the requested model', async () => {
    const spy = capture(ok('hi'));
    await call({ model: 'claude-opus-5' });
    expect(bodyOf(spy).model).toBe('claude-opus-5');
  });
});

describe('askAdvisor — failures never throw', () => {
  const call = () =>
    askAdvisor({ token: 't', model: 'm', question: 'q', history: [], context: 'c' });

  it('surfaces the API error message verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(fail(401, { error: { message: 'invalid bearer token' } }))),
    );
    const r = await call();
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('invalid bearer token');
  });

  it('falls back to the raw body when the error is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(fail(502, '<html>bad gateway</html>'))),
    );
    const r = await call();
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('bad gateway');
  });

  it('resolves rather than rejecting when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ENOTFOUND'))),
    );
    await expect(call()).resolves.toMatchObject({ ok: false });
  });
});
