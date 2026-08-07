/**
 * @file statusline.test.ts
 * @brief Unit tests for statusline formatting and hook-payload tolerance.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { formatStatusline, humanDuration, parseHookPayload } from '../statusline';
import type { ActiveBlock, SessionRow, Snapshot } from '../../shared/types';

const NOW = Date.parse('2026-07-30T12:00:00Z');

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'sess-1',
    project: '/p',
    firstTs: NOW - 3_600_000,
    lastTs: NOW,
    durationMs: 3_600_000,
    cost: 12.5,
    in: 1,
    out: 2,
    read: 3,
    write: 4,
    tokens: 3,
    entries: 10,
    models: ['claude-opus-5'],
    compactions: 0,
    context: null,
    ...over,
  };
}

function block(over: Partial<ActiveBlock> = {}): ActiveBlock {
  return {
    start: NOW - 3_600_000,
    end: NOW + 14_400_000,
    entries: 10,
    cost: 40,
    in: 1,
    out: 2,
    read: 3,
    write: 4,
    totalTokens: 10,
    models: ['claude-opus-5'],
    firstTs: NOW - 3_600_000,
    lastTs: NOW,
    remainingMs: 9_900_000, // 2h 45m
    burn: { tokensPerMin: 100, tokensPerMinIndicator: 50, costPerHour: 7.5, level: 'normal' },
    projection: null,
    limit: null,
    ...over,
  };
}

/** Minimal snapshot carrying only what the statusline reads. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: NOW,
    today: { cost: 100 },
    sessions: [session()],
    block: block(),
    usageLimitResetTs: null,
    ...over,
  } as unknown as Snapshot;
}

describe('humanDuration', () => {
  it('formats hours and minutes, dropping a zero hour', () => {
    expect(humanDuration(9_900_000)).toBe('2h 45m');
    expect(humanDuration(2_700_000)).toBe('45m');
    expect(humanDuration(0)).toBe('0m');
  });

  it('never goes negative for an expired deadline', () => {
    expect(humanDuration(-60_000)).toBe('0m');
  });
});

describe('parseHookPayload', () => {
  it('parses a real payload', () => {
    const p = parseHookPayload('{"session_id":"abc","model":{"display_name":"Opus 5"}}');
    expect(p.session_id).toBe('abc');
    expect(p.model?.display_name).toBe('Opus 5');
  });

  it('degrades to {} for empty, whitespace, malformed or non-object stdin', () => {
    for (const raw of ['', '   ', '{nope', 'null', '"a string"', '42', '[1,2]']) {
      const p = parseHookPayload(raw);
      // an array parses as an object; what matters is no field lookup throws
      expect(() => p.session_id).not.toThrow();
      if (raw !== '[1,2]') expect(p.session_id).toBeUndefined();
    }
  });
});

describe('formatStatusline', () => {
  it('includes model, session, today, block and burn when everything is present', () => {
    const line = formatStatusline(snap(), {
      session_id: 'sess-1',
      model: { display_name: 'Opus 5' },
    });
    expect(line).toBe(
      'Opus 5 | $12.50 session / $100.00 today / $40.00 block (2h 45m left) | $7.50/hr normal',
    );
  });

  it('omits the session segment when the hook gives no session id', () => {
    const line = formatStatusline(snap(), {});
    expect(line).not.toContain('session');
    expect(line).toContain('$100.00 today');
  });

  it('omits the session segment when the id matches nothing in the window', () => {
    const line = formatStatusline(snap(), { session_id: 'not-scanned' });
    expect(line).not.toContain('session');
  });

  it('says so plainly when no block is active', () => {
    const line = formatStatusline(snap({ block: null }), {});
    expect(line).toContain('no active block');
    expect(line).not.toContain('/hr');
  });

  it("prefers the hook context window over ccmon's inferred gauge", () => {
    const s = snap({
      sessions: [session({ context: { tokens: 1000, limit: 200_000, pct: 0.5 } })],
    });
    const line = formatStatusline(s, {
      session_id: 'sess-1',
      context_window: { used_tokens: 48_000, max_tokens: 200_000 },
    });
    expect(line).toContain('ctx 48k (24%)');
    expect(line).not.toContain('(1%)');
  });

  it('falls back to the inferred gauge when the hook omits context', () => {
    const s = snap({
      sessions: [session({ context: { tokens: 120_000, limit: 200_000, pct: 60 } })],
    });
    expect(formatStatusline(s, { session_id: 'sess-1' })).toContain('ctx 120k (60%)');
  });

  it('ignores a zero or missing max_tokens rather than dividing by zero', () => {
    const line = formatStatusline(snap(), {
      session_id: 'sess-1',
      context_window: { used_tokens: 5, max_tokens: 0 },
    });
    expect(line).not.toContain('ctx');
    expect(line).not.toContain('Infinity');
    expect(line).not.toContain('NaN');
  });

  it('surfaces a future quota reset and ignores a stale one', () => {
    const future = formatStatusline(
      snap({ block: block({ usageLimitResetTs: NOW + 3_600_000 }) }),
      {},
    );
    expect(future).toContain('limit resets in 1h 0m');

    const past = formatStatusline(snap({ block: block({ usageLimitResetTs: NOW - 1000 }) }), {});
    expect(past).not.toContain('limit resets');
  });

  it('reads the snapshot-level reset marker when no block carries one', () => {
    const s = snap({ block: null, usageLimitResetTs: NOW + 1_800_000 });
    expect(formatStatusline(s, {})).toContain('limit resets in 30m');
  });
});

describe('formatStatusline — privacy mode', () => {
  it('masks money and leaves everything else readable', () => {
    const line = formatStatusline(
      snap(),
      { session_id: 'sess-1', model: { display_name: 'Opus 5' } },
      true,
    );
    expect(line).not.toMatch(/\d+\.\d\d/);
    expect(line).toContain('$••• session');
    expect(line).toContain('$••• today');
    expect(line).toContain('Opus 5'); // model survives
    expect(line).toContain('2h 45m left'); // time survives
  });

  it('does not mask unless asked', () => {
    expect(formatStatusline(snap(), { session_id: 'sess-1' })).toContain('$12.50');
  });
});
