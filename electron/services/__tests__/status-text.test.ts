/**
 * @file status-text.test.ts
 * @brief Unit tests for tray/statusline text — compaction, nearest cap, tray rows.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { compactTokens, humanDuration, money, nearestCap, trayText, usd } from '../status-text';
import type { ActiveBlock, LimitsMap, Snapshot } from '../../../shared/types';

const NOW = Date.parse('2026-07-30T12:00:00Z');
const label = (dir: string): string => dir.replace('/home/u/.claude', '') || 'default';

function block(over: Partial<ActiveBlock> = {}): ActiveBlock {
  return {
    start: NOW - 3_600_000,
    end: NOW + 14_400_000,
    entries: 5,
    cost: 40,
    in: 1,
    out: 2,
    read: 3,
    write: 4,
    totalTokens: 10,
    models: ['claude-opus-5'],
    firstTs: NOW - 3_600_000,
    lastTs: NOW,
    remainingMs: 9_900_000,
    burn: { tokensPerMin: 100, tokensPerMinIndicator: 50, costPerHour: 7.5, level: 'normal' },
    projection: null,
    limit: null,
    ...over,
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: NOW,
    today: { cost: 104.1 },
    block: block(),
    usageLimitResetTs: null,
    ...over,
  } as unknown as Snapshot;
}

/** A successful limits result carrying only the windows under test. */
const okLimits = (windows: Record<string, unknown>): LimitsMap =>
  ({
    '/home/u/.claude/projects': { ok: true, fetchedAt: NOW, ...windows },
  }) as unknown as LimitsMap;

describe('usd / compactTokens / humanDuration', () => {
  it('formats money to cents, including null', () => {
    expect(usd(104.1)).toBe('$104.10');
    expect(usd(null)).toBe('$0.00');
    expect(usd(undefined)).toBe('$0.00');
  });

  it('compacts tokens by magnitude', () => {
    expect(compactTokens(789)).toBe('789');
    expect(compactTokens(56_000)).toBe('56k');
    expect(compactTokens(3_400_000)).toBe('3.4M');
    expect(compactTokens(1_200_000_000)).toBe('1.2B');
  });

  it('formats durations and clamps the past to 0m', () => {
    expect(humanDuration(9_900_000)).toBe('2h 45m');
    expect(humanDuration(1_800_000)).toBe('30m');
    expect(humanDuration(-5000)).toBe('0m');
  });
});

describe('nearestCap', () => {
  it('returns null when there are no limits at all', () => {
    expect(nearestCap({}, label)).toBeNull();
  });

  it('picks the highest window across kinds', () => {
    const cap = nearestCap(
      okLimits({
        session: { pct: 40, resetsAt: NOW + 3_600_000 },
        week: { pct: 91, resetsAt: NOW + 86_400_000 },
        weekOpus: { pct: 12, resetsAt: null },
      }),
      label,
    );
    expect(cap).toMatchObject({ window: 'week', pct: 91 });
  });

  it('picks the highest window across accounts, and labels it', () => {
    const limits = {
      '/home/u/.claude/projects': { ok: true, fetchedAt: NOW, session: { pct: 20 } },
      '/home/u/.claude-work/projects': { ok: true, fetchedAt: NOW, session: { pct: 88 } },
    } as unknown as LimitsMap;
    const cap = nearestCap(limits, (d) => (d.includes('work') ? 'work' : 'default'));
    expect(cap).toMatchObject({ account: 'work', pct: 88 });
  });

  it('skips failed results and null/absent percentages', () => {
    const limits = {
      '/a': { ok: false, error: 'HTTP 429' },
      '/b': { ok: true, fetchedAt: NOW, session: { pct: null }, week: null },
    } as unknown as LimitsMap;
    expect(nearestCap(limits, label)).toBeNull();
  });

  it('still reports a stale window — hiding a 95% cap because a poll failed would be worse', () => {
    const cap = nearestCap(
      okLimits({ session: { pct: 95, resetsAt: NOW + 60_000 }, stale: true }),
      label,
    );
    expect(cap?.pct).toBe(95);
  });
});

describe('trayText', () => {
  it('says scanning rather than a confident $0.00 before the first snapshot', () => {
    const t = trayText(null, {}, label, NOW);
    expect(t.tooltip).toContain('scanning');
    expect(t.lines).toEqual(['scanning…']);
    expect(t.title).toBe('');
    expect(t.tooltip).not.toContain('$0.00');
  });

  it('lists today, block and burn', () => {
    const t = trayText(snap(), {}, label, NOW);
    expect(t.lines[0]).toBe('today  $104.10');
    expect(t.lines[1]).toBe('block  $40.00 · 2h 45m left');
    expect(t.lines[2]).toBe('burn   $7.50/hr · normal');
  });

  it('reports no active block without inventing a burn row', () => {
    const t = trayText(snap({ block: null }), {}, label, NOW);
    expect(t.lines).toContain('block  none active');
    expect(t.lines.some((l) => l.startsWith('burn'))).toBe(false);
  });

  it('adds a cap row with the account and reset countdown', () => {
    const t = trayText(
      snap(),
      okLimits({ session: { pct: 73.4, resetsAt: NOW + 5_400_000 } }),
      label,
      NOW,
    );
    expect(t.lines.some((l) => l === 'cap    73% session (/projects) · resets 1h 30m')).toBe(true);
  });

  it('surfaces an exhausted quota and ignores a stale reset marker', () => {
    const hit = trayText(
      snap({ block: block({ usageLimitResetTs: NOW + 900_000 }) }),
      {},
      label,
      NOW,
    );
    expect(hit.lines).toContain('limit  resets in 15m');

    const past = trayText(
      snap({ block: block({ usageLimitResetTs: NOW - 900_000 }) }),
      {},
      label,
      NOW,
    );
    expect(past.lines.some((l) => l.startsWith('limit'))).toBe(false);
  });

  it('keeps the tooltip to one line covering spend, block and cap', () => {
    const t = trayText(snap(), okLimits({ week: { pct: 50 } }), label, NOW);
    expect(t.tooltip).toBe('ccmon · $104.10 today · block $40.00 (2h 45m left) · 50% week');
    expect(t.tooltip).not.toContain('\n');
  });

  it('adds the cap percent to the macOS title only once it is worth interrupting over', () => {
    expect(trayText(snap(), okLimits({ week: { pct: 50 } }), label, NOW).title).toBe('$104.10');
    expect(trayText(snap(), okLimits({ week: { pct: 93 } }), label, NOW).title).toBe('$104.10 93%');
  });
});

describe('privacy mode', () => {
  it('masks money but keeps the shape', () => {
    expect(money(104.1, false)).toBe('$104.10');
    expect(money(104.1, true)).toBe('$•••');
    expect(money(null, true)).toBe('$•••');
  });

  it('defaults to NOT masking, so a caller cannot leak by omission... and does mask when asked', () => {
    expect(money(1)).toBe('$1.00');
    const open = trayText(snap(), okLimits({ session: { pct: 50 } }), label, NOW, false);
    const shut = trayText(snap(), okLimits({ session: { pct: 50 } }), label, NOW, true);
    expect(open.tooltip).toContain('$104.10');
    expect(shut.tooltip).not.toContain('104');
    expect(shut.tooltip).toContain('$•••');
  });

  it('masks every money row in the tray menu — today, block and burn', () => {
    const t = trayText(snap(), {}, label, NOW, true);
    const joined = t.lines.join('\n');
    expect(joined).not.toMatch(/\d+\.\d\d/); // no dollars-and-cents anywhere
    expect(t.lines[0]).toBe('today  $•••');
    expect(t.lines[1]).toContain('$•••');
    expect(t.lines[2]).toContain('$•••');
  });

  it('still shows non-money facts, which is the point of masking money only', () => {
    const t = trayText(snap(), okLimits({ session: { pct: 73 } }), label, NOW, true);
    const joined = t.lines.join('\n');
    expect(joined).toContain('2h 45m left'); // time survives
    expect(joined).toContain('73% session'); // cap percent survives
    expect(joined).toContain('normal'); // burn level survives
  });

  it('masks the macOS title too, cap percent included', () => {
    expect(trayText(snap(), okLimits({ week: { pct: 93 } }), label, NOW, true).title).toBe(
      '$••• 93%',
    );
  });
});
