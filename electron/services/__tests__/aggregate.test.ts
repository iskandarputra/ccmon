/**
 * @file aggregate.test.ts
 * @brief Unit tests for the snapshot reducer — rollups, idle TTL, attribution, what-if.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { accountSpend, buildSnapshot, dayBreakdown } from '../aggregate';
import { createPricingEngine } from '../pricing';
import { localDateKey } from '../parser';
import { resolveRange } from '../../../shared/range';
import { dayKeyFor } from '../../../shared/daykey';
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

describe('buildSnapshot — time range scoping', () => {
  const old = makeEntry({ ts: NOW - 10 * 24 * HOUR, in: 10, out: 5, costUSD: 7, sessionId: 'old' });
  const yesterday = makeEntry({ ts: NOW - 24 * HOUR, in: 10, out: 5, costUSD: 2, sessionId: 'y' });
  const today1 = makeEntry({ ts: NOW - 2 * HOUR, in: 100, out: 50, costUSD: 3, sessionId: 'a' });
  const today2 = makeEntry({ ts: NOW - 1 * HOUR, in: 200, out: 100, costUSD: 5, sessionId: 'b' });
  const all = [old, yesterday, today1, today2];

  it('defaults to all-time with the 35-day window when no range is given', () => {
    const s = snap(all);
    expect(s.range.preset).toBe('all');
    expect(s.totals.cost).toBe(17); // 7 + 2 + 3 + 5
    expect(s.days).toHaveLength(35);
  });

  it('today scopes totals and the daily series to the current day', () => {
    const s = snap(all, { range: resolveRange({ preset: 'today' }, NOW) });
    expect(s.range.label).toBe('today');
    expect(s.totals.cost).toBe(8); // today1 + today2 only
    expect(s.totals.sessions).toBe(2);
    expect(s.days).toHaveLength(1);
    expect(s.days[0].date).toBe(localDateKey(NOW));
    expect(s.days[0].cost).toBe(8);
  });

  it('a custom span includes only entries within the bounds', () => {
    const start = localDateKey(NOW - 24 * HOUR); // yesterday
    const end = localDateKey(NOW);
    const s = snap(all, {
      range: resolveRange({ preset: 'custom', customStart: start, customEnd: end }, NOW),
    });
    expect(s.totals.cost).toBe(10); // yesterday + today, old (10d ago) excluded
    expect(s.days).toHaveLength(2);
    expect(s.entryCount).toBe(3);
  });
});

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
      [
        makeEntry({ ts: NOW - HOUR, sessionId: 's1' }),
        makeEntry({ ts: NOW - HOUR, sessionId: 's2' }),
      ],
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

describe('compaction re-read cost', () => {
  // rate row: in=10/MTok, read=1/MTok → re-read cost = (in*10 + read*1)/1e6
  it('attributes the first post-compaction turn input+read cost, once per gap', () => {
    const sid = 'cs';
    const entries = [
      makeEntry({ ts: NOW - 5 * HOUR, model: 'fake-model', in: 0, read: 0, sessionId: sid }),
      // first turn after the compaction — the re-read we cost
      makeEntry({
        ts: NOW - 3 * HOUR,
        model: 'fake-model',
        in: 1_000_000,
        out: 500_000,
        read: 2_000_000,
        sessionId: sid,
      }),
      makeEntry({ ts: NOW - 1 * HOUR, model: 'fake-model', in: 10, read: 0, sessionId: sid }),
    ];
    const comps: CompactMarker[] = [
      { kind: 'compact', ts: NOW - 4 * HOUR, sessionId: sid, source: null },
    ];
    const s = snap(entries, { pricing: engine, compactions: comps });
    expect(s.compactionReread.turns).toBe(1);
    // in 1M @ $10/MTok + read 2M @ $1/MTok = 10 + 2 = 12 (output excluded)
    expect(s.compactionReread.costUSD).toBeCloseTo(12, 5);
  });

  it('collapses several compactions before the same turn into one re-read', () => {
    const sid = 'cs2';
    const entries = [
      makeEntry({
        ts: NOW - 2 * HOUR,
        model: 'fake-model',
        in: 1_000_000,
        out: 0,
        read: 0,
        sessionId: sid,
      }),
    ];
    const comps: CompactMarker[] = [
      { kind: 'compact', ts: NOW - 3 * HOUR, sessionId: sid, source: null },
      { kind: 'compact', ts: NOW - 2.5 * HOUR, sessionId: sid, source: null },
    ];
    const s = snap(entries, { pricing: engine, compactions: comps });
    expect(s.compactionReread.turns).toBe(1); // one re-reading turn, not two
    expect(s.compactionReread.costUSD).toBeCloseTo(10, 5); // in 1M @ $10
  });
});

describe('accountSpend — per-source rollup', () => {
  const ROOT_A = '/home/u/.claude';
  const ROOT_B = '/home/u/.claude-work';

  it('buckets lifetime cost/tokens/sessions by source root', () => {
    const map = accountSpend(
      [
        makeEntry({
          ts: NOW - 40 * 24 * HOUR,
          in: 10,
          out: 5,
          costUSD: 2,
          source: ROOT_A,
          sessionId: 'a1',
        }),
        makeEntry({
          ts: NOW - 2 * HOUR,
          in: 100,
          out: 50,
          costUSD: 3,
          source: ROOT_A,
          sessionId: 'a2',
        }),
        makeEntry({
          ts: NOW - 1 * HOUR,
          in: 200,
          out: 100,
          costUSD: 5,
          source: ROOT_B,
          sessionId: 'b1',
        }),
      ],
      { now: NOW },
    );
    expect(map[ROOT_A].cost).toBe(5);
    expect(map[ROOT_A].tokens).toBe(165);
    expect(map[ROOT_A].sessions).toBe(2);
    expect(map[ROOT_A].entries).toBe(2);
    expect(map[ROOT_B].cost).toBe(5);
    expect(map[ROOT_B].sessions).toBe(1);
  });

  it('windows today/week/month by recency, independent of lifetime', () => {
    const map = accountSpend(
      [
        makeEntry({ ts: NOW - 40 * 24 * HOUR, costUSD: 100, source: ROOT_A }), // lifetime only
        makeEntry({ ts: NOW - 10 * 24 * HOUR, costUSD: 10, source: ROOT_A }), //  month
        makeEntry({ ts: NOW - 2 * 24 * HOUR, costUSD: 7, source: ROOT_A }), //    week + month
        makeEntry({ ts: NOW - 1 * HOUR, costUSD: 3, source: ROOT_A }), //         today + week + month
      ],
      { now: NOW },
    );
    expect(map[ROOT_A].cost).toBe(120);
    expect(map[ROOT_A].month).toBe(20); // 10 + 7 + 3
    expect(map[ROOT_A].week).toBe(10); //  7 + 3
    expect(map[ROOT_A].today).toBe(3);
  });

  it('drops entries with no stamped source (unattributable)', () => {
    const map = accountSpend([makeEntry({ costUSD: 9, source: null })], { now: NOW });
    expect(Object.keys(map)).toHaveLength(0);
  });
});

describe('dayBreakdown — why was this day expensive', () => {
  const TODAY = localDateKey(NOW);
  const Y = localDateKey(NOW - 24 * HOUR);

  it('ranks the day contributors and compares to the median active day', () => {
    const entries = [
      // a cheap prior day → sets the median baseline low
      makeEntry({ ts: NOW - 24 * HOUR, costUSD: 2, project: '/p/alpha', dateKey: Y }),
      // the expensive target day
      makeEntry({
        ts: NOW - 3 * HOUR,
        costUSD: 6,
        project: '/p/alpha',
        model: 'opus',
        sessionId: 's1',
      }),
      makeEntry({
        ts: NOW - 2 * HOUR,
        costUSD: 3,
        project: '/p/beta',
        model: 'sonnet',
        sessionId: 's2',
        tools: ['Bash'],
      }),
      makeEntry({
        ts: NOW - 1 * HOUR,
        costUSD: 1,
        project: '/p/alpha',
        model: 'opus',
        sessionId: 's1',
      }),
    ];
    const b = dayBreakdown(entries, TODAY)!;
    expect(b.cost).toBe(10);
    expect(b.sessions).toBe(2);
    // median over all active days INCLUDING this one: median([2,10]) = 6
    expect(b.medianCost).toBe(6);
    expect(b.vsMedianPct).toBeCloseTo(66.67, 1); // (10-6)/6 → +66.67%
    // alpha (6+1=7) leads beta (3)
    expect(b.topProjects[0].key).toBe('/p/alpha');
    expect(b.topProjects[0].cost).toBe(7);
    expect(b.topProjects[0].pct).toBeCloseTo(70, 0);
    expect(b.topModels[0].key).toBe('opus');
    expect(b.topSessions[0].key).toBe('s1');
    expect(b.toolTurns).toBe(1);
    expect(b.toolInvocations).toBe(1);
  });

  it('flags projects that debuted on the day', () => {
    const entries = [
      makeEntry({ ts: NOW - 24 * HOUR, costUSD: 1, project: '/p/old', dateKey: Y }),
      makeEntry({ ts: NOW - 2 * HOUR, costUSD: 5, project: '/p/old' }),
      makeEntry({ ts: NOW - 1 * HOUR, costUSD: 4, project: '/p/fresh' }),
    ];
    const b = dayBreakdown(entries, TODAY)!;
    expect(b.newProjects).toEqual(['/p/fresh']);
  });

  it('counts compactions on the day and returns null for an empty day', () => {
    const entries = [makeEntry({ ts: NOW - 2 * HOUR, costUSD: 5 })];
    const comps: CompactMarker[] = [
      { kind: 'compact', ts: NOW - 90 * MIN, sessionId: 's1', source: null },
      { kind: 'compact', ts: NOW - 26 * HOUR, sessionId: 's1', source: null }, // yesterday
    ];
    const b = dayBreakdown(entries, TODAY, { compactions: comps })!;
    expect(b.compactions).toBe(1);
    expect(dayBreakdown(entries, '2000-01-01')).toBeNull();
  });
});

describe('buildSnapshot — timezone bucketing', () => {
  // 23:30 UTC: still the 10th in UTC, already the 11th in Tokyo.
  const LATE = Date.parse('2026-06-10T23:30:00Z');

  /** An entry stamped the way the parser would stamp it under `zone`. */
  const zoned = (ts: number, zone: string, over: Partial<UsageEntry> = {}): UsageEntry => ({
    ...makeEntry({ ts, ...over }),
    dateKey: dayKeyFor(ts, zone),
  });

  const snapIn = (zone: string, entries: UsageEntry[]) =>
    buildSnapshot(
      [...entries].sort((a, b) => a.ts - b.ts),
      {
        now: LATE,
        settings: { costMode: 'auto', startOfWeek: 'monday', timezone: zone },
      },
    );

  it('puts the same instant on different calendar days per zone', () => {
    const utc = snapIn('UTC', [zoned(LATE, 'UTC', { costUSD: 5 })]);
    const tokyo = snapIn('Asia/Tokyo', [zoned(LATE, 'Asia/Tokyo', { costUSD: 5 })]);

    expect(utc.days[utc.days.length - 1].date).toBe('2026-06-10');
    expect(tokyo.days[tokyo.days.length - 1].date).toBe('2026-06-11');
    // and in both cases the entry counts as "today" — the point of the setting
    expect(utc.today.cost).toBe(5);
    expect(tokyo.today.cost).toBe(5);
  });

  it('treats an empty timezone as the system zone', () => {
    const sys = snapIn('', [zoned(LATE, '', { costUSD: 5 })]);
    expect(sys.days[sys.days.length - 1].date).toBe(localDateKey(LATE));
    expect(sys.today.cost).toBe(5);
  });

  it('splits one instant across yesterday/today depending on the zone', () => {
    // An entry 2h earlier (21:30 UTC) is the 10th in UTC and the 11th in Tokyo,
    // so under Tokyo BOTH entries are "today" while under UTC both are the 10th.
    const earlier = LATE - 2 * HOUR;
    const utc = snapIn('UTC', [
      zoned(earlier, 'UTC', { costUSD: 3, sessionId: 'a' }),
      zoned(LATE, 'UTC', { costUSD: 5, sessionId: 'b' }),
    ]);
    const tokyo = snapIn('Asia/Tokyo', [
      zoned(earlier, 'Asia/Tokyo', { costUSD: 3, sessionId: 'a' }),
      zoned(LATE, 'Asia/Tokyo', { costUSD: 5, sessionId: 'b' }),
    ]);
    expect(utc.today.cost).toBe(8);
    expect(tokyo.today.cost).toBe(8);
    // Honolulu (−10:00) puts 21:30Z and 23:30Z on the 10th, i.e. still "today"
    const hono = snapIn('Pacific/Honolulu', [
      zoned(earlier, 'Pacific/Honolulu', { costUSD: 3, sessionId: 'a' }),
      zoned(LATE, 'Pacific/Honolulu', { costUSD: 5, sessionId: 'b' }),
    ]);
    expect(hono.days[hono.days.length - 1].date).toBe('2026-06-10');
    expect(hono.today.cost).toBe(8);
  });

  it('orients the rhythm heatmap by the zone, not the system clock', () => {
    const utc = snapIn('UTC', [zoned(LATE, 'UTC', { in: 100, out: 50 })]);
    const tokyo = snapIn('Asia/Tokyo', [zoned(LATE, 'Asia/Tokyo', { in: 100, out: 50 })]);

    // 23:30 UTC on Wed 10 Jun → weekday 2 (Mon-first), hour 23
    expect(utc.hourly[2][23]).toBe(150);
    // 08:30 Thu 11 Jun in Tokyo → weekday 3, hour 8
    expect(tokyo.hourly[3][8]).toBe(150);
  });

  it('scopes accountSpend.today by the zone', () => {
    const e = zoned(LATE, 'Asia/Tokyo', { costUSD: 5, source: '/root/projects' });
    const spendTokyo = accountSpend([e], { now: LATE, timezone: 'Asia/Tokyo' });
    const spendUtc = accountSpend([e], { now: LATE, timezone: 'UTC' });
    // the entry's key is Tokyo's 11th, which is Tokyo's today but not UTC's
    expect(Object.values(spendTokyo)[0].today).toBe(5);
    expect(Object.values(spendUtc)[0].today).toBe(0);
  });
});

describe('buildSnapshot — cost reconciliation', () => {
  /** engine prices fake-model at $10/MTok in, $20/MTok out */
  const priced = (over: Partial<UsageEntry> = {}) =>
    makeEntry({ model: 'fake-model', in: 1e6, out: 0, ...over });

  const recon = (entries: UsageEntry[], costMode = 'auto') =>
    snap(entries, { pricing: engine, settings: { costMode, startOfWeek: 'monday' } }).reconcile;

  it('compares recorded costUSD against a fresh calculation', () => {
    // calculated = 1M × $10 = $10; the CLI recorded $12
    const r = recon([priced({ costUSD: 12 })]);
    expect(r.compared).toBe(1);
    expect(r.recorded).toBeCloseTo(12, 6);
    expect(r.calculated).toBeCloseTo(10, 6);
    expect(r.drift).toBeCloseTo(-2, 6);
    expect(r.driftPct).toBeCloseTo(-2 / 12, 6);
  });

  it('reports drift under EVERY cost mode — the whole point of the panel', () => {
    // Under 'auto'/'display' the snapshot's own cost IS the recorded value, so a
    // naive implementation would report 0 here and say nothing.
    for (const mode of ['auto', 'calculate', 'display']) {
      const r = recon([priced({ costUSD: 12 })], mode);
      expect(r.drift, `mode ${mode}`).toBeCloseTo(-2, 6);
    }
  });

  it('only counts entries that carry a recorded cost, and reports coverage', () => {
    const r = recon([priced({ costUSD: 12 }), priced({ costUSD: null })]);
    expect(r.compared).toBe(1);
    expect(r.total).toBe(2);
    expect(r.coverage).toBeCloseTo(0.5, 6);
  });

  it('skips entries whose model has no price rather than scoring them as 100% drift', () => {
    const r = recon([
      priced({ costUSD: 12 }),
      makeEntry({ model: 'totally-unknown-model', in: 1e6, costUSD: 5 }),
    ]);
    expect(r.compared).toBe(1);
    expect(r.recorded).toBeCloseTo(12, 6);
  });

  it('is all-zero and coverage 0 when nothing is comparable', () => {
    const r = recon([priced({ costUSD: null })]);
    expect(r).toMatchObject({ compared: 0, recorded: 0, calculated: 0, drift: 0, driftPct: 0 });
    expect(r.coverage).toBe(0);
    expect(r.byDay).toEqual([]);
    expect(r.byModel).toEqual([]);
  });

  it('buckets by day ascending', () => {
    const r = recon([
      priced({ ts: NOW - 24 * HOUR, costUSD: 12 }),
      priced({ ts: NOW, costUSD: 11 }),
    ]);
    expect(r.byDay).toHaveLength(2);
    expect(r.byDay[0].key < r.byDay[1].key).toBe(true);
    expect(r.byDay.reduce((n, d) => n + d.entries, 0)).toBe(2);
  });

  it('sorts models by worst absolute drift first', () => {
    const r = recon([
      priced({ costUSD: 10.5 }), //          fake-model: small drift (calc $10)
      makeEntry({ model: 'fake-model-fast', in: 1e6, costUSD: 5 }), // fast: calc $20 → big drift
    ]);
    expect(r.byModel[0].key).toBe('fake-model-fast');
    expect(Math.abs(r.byModel[0].calculated - r.byModel[0].recorded)).toBeGreaterThan(
      Math.abs(r.byModel[1].calculated - r.byModel[1].recorded),
    );
  });

  it('day and model buckets both sum to the headline totals', () => {
    const r = recon([
      priced({ ts: NOW - 24 * HOUR, costUSD: 12 }),
      priced({ ts: NOW, costUSD: 11 }),
    ]);
    for (const series of [r.byDay, r.byModel]) {
      expect(series.reduce((n, x) => n + x.recorded, 0)).toBeCloseTo(r.recorded, 6);
      expect(series.reduce((n, x) => n + x.calculated, 0)).toBeCloseTo(r.calculated, 6);
    }
  });
});
