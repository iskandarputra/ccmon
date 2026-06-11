/**
 * @file aggregate.test.ts
 * @brief Unit tests for the snapshot reducer — rollups, idle TTL, attribution, what-if.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../aggregate';
import { createPricingEngine } from '../pricing';
import { localDateKey } from '../parser';
import { HOUR, MIN, makeEntry } from './helpers';
import type { CompactMarker, UsageEntry } from '../../../shared/types';

// noon local time — keeps every test day inside the same local dateKey
const NOW = Date.parse('2026-06-10T12:00:00');

const engine = await createPricingEngine({
  offline: true,
  overrides: { '^fake-model$': { in: 10, out: 20, read: 1, w5m: 12.5 } },
});

function snap(entries: UsageEntry[], extra: Record<string, unknown> = {}) {
  return buildSnapshot(
    [...entries].sort((a, b) => a.ts - b.ts),
    { now: NOW, settings: { costMode: 'auto', startOfWeek: 'monday' }, ...extra },
  );
}

describe('buildSnapshot — core rollups', () => {
  const yesterday = makeEntry({ ts: NOW - 24 * HOUR, in: 10, out: 5, costUSD: 2 });
  const today1 = makeEntry({ ts: NOW - 2 * HOUR, in: 100, out: 50, costUSD: 3, sessionId: 'a' });
  const today2 = makeEntry({ ts: NOW - 1 * HOUR, in: 200, out: 100, costUSD: 5, sessionId: 'b' });

  it('sums totals and splits days over a zero-filled 35-day window', () => {
    const s = snap([yesterday, today1, today2]);
    expect(s.totals.cost).toBe(10);
    expect(s.totals.tokens).toBe(465);
    expect(s.days).toHaveLength(35);
    expect(s.days[34].date).toBe(localDateKey(NOW));
    expect(s.days[34].cost).toBe(8);
    expect(s.days[33].cost).toBe(2);
    expect(s.days[10].cost).toBe(0); // zero-filled
    expect(s.today.sessions).toBe(2);
    expect(s.today.vsYesterdayPct).toBeCloseTo(300); // 2 → 8
  });

  it('buckets weeks starting monday', () => {
    const s = snap([today1]);
    const d = new Date(`${localDateKey(NOW)}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    expect(s.weekly.at(-1)!.week).toBe(localDateKey(d.getTime()));
  });

  it('fills the hourly and hourlyCost grids (Monday-first)', () => {
    const s = snap([today1]);
    const dt = new Date(today1.ts);
    const wd = (dt.getDay() + 6) % 7;
    expect(s.hourly[wd][dt.getHours()]).toBe(150);
    expect(s.hourlyCost[wd][dt.getHours()]).toBe(3);
  });
});

describe('buildSnapshot — cache-TTL idle re-writes', () => {
  const t = NOW - 3 * HOUR;
  const entries = [
    makeEntry({ ts: t, w5m: 999, sessionId: 'x' }), //                first entry never counts
    makeEntry({ ts: t + 6 * MIN, w5m: 1000, sessionId: 'x' }), //     6min gap > 5m TTL
    makeEntry({ ts: t + 6.5 * MIN, w5m: 500, sessionId: 'x' }), //    30s gap — fine
    makeEntry({ ts: t + 70 * MIN, w1h: 200, sessionId: 'x' }), //     63.5min gap > 1h TTL
  ];

  it('counts gap-expired writes per tier, skipping session firsts', () => {
    const s = snap(entries);
    expect(s.cache.idle.events).toBe(2);
    expect(s.cache.idle.tokens).toBe(1200);
    expect(s.cache.idle.extraUSD).toBe(0); // no pricing engine → tokens only
  });

  it('prices the marginal cost as write-rate minus read-rate', () => {
    const priced = entries.map((e) => ({ ...e, model: 'fake-model' }));
    const s = snap(priced, { pricing: engine });
    // w5m: 1000 × (12.5−1)/MTok + w1h: 200 × (2×10−1)/MTok
    expect(s.cache.idle.extraUSD).toBeCloseTo(0.0115 + 0.0038, 6);
  });
});

describe('buildSnapshot — attribution analytics', () => {
  it('aggregates sidechain spend globally and per project', () => {
    const s = snap([
      makeEntry({ ts: NOW - HOUR, costUSD: 4, sidechain: true, project: '/p/a' }),
      makeEntry({ ts: NOW - HOUR + MIN, costUSD: 6, project: '/p/a' }),
    ]);
    expect(s.sidechain).toEqual({ cost: 4, entries: 1 });
    expect(s.projects[0].sidechainCost).toBe(4);
  });

  it('counts stop reasons', () => {
    const s = snap([
      makeEntry({ ts: NOW - HOUR, stop: 'tool_use' }),
      makeEntry({ ts: NOW - HOUR + MIN, stop: 'tool_use' }),
      makeEntry({ ts: NOW - HOUR + 2 * MIN, stop: 'max_tokens' }),
    ]);
    expect(s.stopReasons).toEqual({ tool_use: 2, max_tokens: 1 });
  });

  it('attributes tool turns with overlapping cost semantics', () => {
    const s = snap([
      makeEntry({ ts: NOW - HOUR, costUSD: 5, tools: ['Bash', 'Bash', 'Edit'] }),
      makeEntry({ ts: NOW - HOUR + MIN, costUSD: 2, tools: ['Bash'] }),
    ]);
    expect(s.toolUse.turns).toBe(2);
    expect(s.toolUse.invocations).toBe(4);
    const bash = s.toolUse.rows.find((r) => r.name === 'Bash')!;
    expect(bash).toMatchObject({ invocations: 3, entries: 2, cost: 7 });
    const daily = s.toolUse.daily.find((r) => r.name === 'Bash')!;
    expect(daily.days[34]).toBe(3); // both turns landed today
  });

  it('totals compactions and assigns them to sessions', () => {
    const compactions: CompactMarker[] = [
      { kind: 'compact', ts: NOW - HOUR, sessionId: 's1' },
      { kind: 'compact', ts: NOW - HOUR + MIN, sessionId: 's1' },
      { kind: 'compact', ts: NOW - HOUR, sessionId: 's2' },
    ];
    const s = snap(
      [makeEntry({ ts: NOW - HOUR, sessionId: 's1' }), makeEntry({ ts: NOW - HOUR, sessionId: 's2' })],
      { compactions },
    );
    expect(s.compactions).toBe(3);
    expect(s.sessions.find((x) => x.id === 's1')!.compactions).toBe(2);
    expect(s.sessions.find((x) => x.id === 's2')!.compactions).toBe(1);
  });
});

describe('buildSnapshot — counterfactuals and context', () => {
  it('re-prices all traffic onto each candidate, totals and daily aligned', () => {
    const e1 = makeEntry({ ts: NOW - 25 * HOUR, model: 'fake-model', in: 1e6, out: 0, read: 0 });
    const e2 = makeEntry({ ts: NOW - HOUR, model: 'fake-model', in: 0, out: 1e6, read: 0 });
    const s = snap([e1, e2], { pricing: engine, settings: { costMode: 'calculate' } });
    expect(s.whatIf).toHaveLength(1);
    const w = s.whatIf[0];
    expect(w.model).toBe('fake-model');
    expect(w.totalCost).toBeCloseTo(30, 6); // $10 + $20
    expect(w.delta).toBeCloseTo(0, 6); //     same model → same bill
    expect(w.daily![34]).toBeCloseTo(20, 6);
    expect(w.daily![33]).toBeCloseTo(10, 6);
  });

  it('reports the live session context from the last entry footprint', () => {
    const s = snap(
      [makeEntry({ ts: NOW - 10 * MIN, model: 'fake-model', in: 500, read: 1500, w5m: 250 })],
      { pricing: engine },
    );
    const ctx = s.sessions[0].context!;
    expect(ctx.tokens).toBe(2250);
    expect(ctx.limit).toBe(200_000); // override rows carry no limit → default
  });
});
