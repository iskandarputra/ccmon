/**
 * @file limits-history.test.ts
 * @brief Unit tests for limit-poll persistence, forecasting, and the cap retrospective.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { LimitsHistory } from '../limits-history';
import type { LimitsResult } from '../../../shared/types';

const HOUR = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-06-10T12:00:00Z');
const DIR = '/data/projects';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function fresh(): LimitsHistory {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-limits-test-'));
  roots.push(root);
  return new LimitsHistory(path.join(root, 'limits-history.json'));
}

type OkResult = Extract<LimitsResult, { ok: true }>;

function ok(sessionPct: number | null, weekPct: number | null, at: number): OkResult {
  return {
    ok: true,
    fetchedAt: at,
    session: sessionPct == null ? null : { pct: sessionPct, resetsAt: null },
    week: weekPct == null ? null : { pct: weekPct, resetsAt: null },
    weekOpus: null,
  };
}

/** Record a linear week-pct climb: one sample per `stepMin`, ending at NOW. */
function climb(h: LimitsHistory, fromPct: number, perHour: number, hours: number) {
  const stepMin = 5;
  const steps = (hours * 60) / stepMin;
  for (let i = 0; i <= steps; i++) {
    const at = NOW - (steps - i) * stepMin * MIN;
    const pct = fromPct + (perHour * (i * stepMin)) / 60;
    h.record(DIR, ok(pct, pct, at), at);
  }
}

describe('LimitsHistory — recording', () => {
  it('ignores failures and stale re-serves', () => {
    const h = fresh();
    h.record(DIR, { ok: false, error: 'x' }, NOW);
    h.record(DIR, { ...ok(10, 10, NOW), stale: true }, NOW);
    expect(h.uiSamples(DIR)).toHaveLength(0);
  });

  it('drops samples past 7 days and thins those older than 2h to 15-min buckets', () => {
    const h = fresh();
    h.record(DIR, ok(1, 1, NOW - 8 * 24 * HOUR), NOW - 8 * 24 * HOUR);
    // 1-min samples 3h ago land in the thinned zone once NOW-time samples arrive
    for (let i = 0; i < 30; i++) {
      const at = NOW - 3 * HOUR + i * MIN;
      h.record(DIR, ok(5, 5, at), at);
    }
    h.record(DIR, ok(6, 6, NOW), NOW);
    const samples = h.uiSamples(DIR);
    expect(samples.find((s) => s.ts === NOW - 8 * 24 * HOUR)).toBeUndefined();
    const thinned = samples.filter((s) => s.ts < NOW - 2 * HOUR);
    expect(thinned.length).toBeLessThanOrEqual(3); // 30 minutes → ≤3 15-min buckets
  });

  it('caps the sparkline payload at 120 points', () => {
    const h = fresh();
    for (let i = 0; i < 130; i++) {
      const at = NOW - (130 - i) * MIN;
      h.record(DIR, ok(1, 1, at), at);
    }
    expect(h.uiSamples(DIR).length).toBeLessThanOrEqual(120);
  });
});

describe('LimitsHistory — forecast', () => {
  it('fits a clean linear climb and projects the 100% ETA', () => {
    const h = fresh();
    climb(h, 50, 10, 3); // 50% → 80% over 3h at +10%/h
    const fc = h.forecast(DIR, NOW)!;
    expect(fc.week).not.toBeNull();
    expect(fc.week!.pctPerHour).toBeCloseTo(10, 1);
    // 20% to go at 10%/h → ~2h out
    expect(fc.week!.etaTs).toBeCloseTo(NOW + 2 * HOUR, -5);
  });

  it('reports a flat pace with no ETA', () => {
    const h = fresh();
    climb(h, 40, 0, 3);
    const fc = h.forecast(DIR, NOW)!;
    expect(fc.week!.etaTs).toBeNull();
  });

  it('cuts the fit at the most recent reset', () => {
    const h = fresh();
    // old steep climb to 90, then a reset, then a gentle climb
    for (let i = 0; i <= 12; i++) {
      const at = NOW - 5 * HOUR + i * 10 * MIN;
      h.record(DIR, ok(30 + i * 5, 30 + i * 5, at), at);
    }
    climb(h, 2, 4, 2); // post-reset: +4%/h
    const fc = h.forecast(DIR, NOW)!;
    expect(fc.week!.pctPerHour).toBeCloseTo(4, 0); // not dragged up by the pre-reset 30%/h
  });

  it('returns null without enough span', () => {
    const h = fresh();
    h.record(DIR, ok(10, 10, NOW - MIN), NOW - MIN);
    h.record(DIR, ok(11, 11, NOW), NOW);
    expect(h.forecast(DIR, NOW)).toBeNull();
  });
});

describe('LimitsHistory — cap retrospective', () => {
  it('counts resets and which of them happened at ~100%', () => {
    const h = fresh();
    const at = (i: number) => NOW - (40 - i) * 10 * MIN;
    let i = 0;
    // climb to 97 → reset (capped), climb to 50 → reset (not capped)
    for (const pct of [80, 90, 97, 3, 25, 50, 5, 10]) {
      h.record(DIR, ok(pct, pct, at(i)), at(i));
      i += 1;
    }
    const caps = h.caps(DIR)!;
    expect(caps.week.resets).toBe(2);
    expect(caps.week.capped).toBe(1);
  });
});
