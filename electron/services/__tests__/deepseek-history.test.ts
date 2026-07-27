/**
 * @file deepseek-history.test.ts
 * @brief Unit tests for balance-poll persistence, measured burn, runway, and
 *        the computed-vs-observed drift reconciliation.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { DeepseekHistory, compact, consumption } from '../deepseek-history';
import type { DeepseekBalance, DeepseekSample } from '../../../shared/types';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-10T12:00:00Z');

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function fresh(): DeepseekHistory {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-deepseek-test-'));
  roots.push(root);
  return new DeepseekHistory(path.join(root, 'deepseek-history.json'));
}

const bal = (total: number, currency = 'USD'): DeepseekBalance => ({
  total,
  currency,
  granted: 0,
  toppedUp: total,
});

const sample = (ts: number, total: number, currency = 'USD'): DeepseekSample => ({
  ts,
  total,
  currency,
});

/** Record `n` samples ending at NOW, `stepHours` apart, dropping `perStep` each. */
function seed(h: DeepseekHistory, n: number, stepHours: number, start: number, perStep: number) {
  for (let i = 0; i < n; i++) {
    h.record(bal(start - i * perStep), NOW - (n - 1 - i) * stepHours * HOUR);
  }
}

/** USD passthrough plus a fixed CNY peg, standing in for the live rate table. */
const toUSD = (amount: number, currency: string) =>
  currency === 'USD' ? amount : currency === 'CNY' ? amount / 7 : null;

describe('compact', () => {
  it('keeps every sample inside the 24h raw window', () => {
    const arr = [sample(NOW - 20 * HOUR, 10), sample(NOW - HOUR, 9), sample(NOW, 8)];
    expect(compact(arr, NOW)).toHaveLength(3);
  });

  it('thins older samples to one per hour and drops anything past 30 days', () => {
    const arr: DeepseekSample[] = [
      sample(NOW - 40 * DAY, 100), //          past the age cap
      sample(NOW - 5 * DAY, 50), //            same hour bucket…
      sample(NOW - 5 * DAY + 60_000, 49), //   …as this one, so it's thinned
      sample(NOW - 5 * DAY + 2 * HOUR, 48),
      sample(NOW, 40),
    ];
    const out = compact(arr, NOW);
    expect(out.map((s) => s.total)).toEqual([50, 48, 40]);
  });
});

describe('consumption', () => {
  it('sums only the drops — a top-up must not read as negative spend', () => {
    const arr = [
      sample(NOW - 3 * HOUR, 100),
      sample(NOW - 2 * HOUR, 90), //  −10 spent
      sample(NOW - HOUR, 190), //     +100 top-up
      sample(NOW, 180), //            −10 spent
    ];
    expect(consumption(arr, 'USD', NOW)?.spent).toBe(20);
  });

  it('never differences across a currency change', () => {
    const arr = [sample(NOW - 2 * HOUR, 700, 'CNY'), sample(NOW - HOUR, 40), sample(NOW, 38)];
    const c = consumption(arr, 'USD', NOW);
    expect(c?.spent).toBe(2);
    expect(c?.fromTs).toBe(NOW - HOUR);
  });

  it('ignores samples older than the 7-day window', () => {
    const arr = [sample(NOW - 9 * DAY, 500), sample(NOW - HOUR, 40), sample(NOW, 30)];
    expect(consumption(arr, 'USD', NOW)?.spent).toBe(10);
  });

  it('needs two samples in the window to say anything', () => {
    expect(consumption([sample(NOW, 40)], 'USD', NOW)).toBeNull();
  });
});

describe('DeepseekHistory.derive', () => {
  const noCost = () => 0;

  it('measures burn per day and turns it into a runway', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 1); // 12h span, $1/h → $24/day, ending at $88
    const d = h.derive(bal(88), { now: NOW, toUSD, computedUSD: noCost });
    expect(d.burnUSDPerDay).toBeCloseTo(24, 5);
    expect(d.runwayDays).toBeCloseTo(88 / 24, 5);
  });

  it('holds back burn until the samples span long enough to mean something', () => {
    const h = fresh();
    h.record(bal(100), NOW - 30 * 60_000);
    h.record(bal(99), NOW);
    const d = h.derive(bal(99), { now: NOW, toUSD, computedUSD: noCost });
    expect(d.burnUSDPerDay).toBeNull();
    expect(d.runwayDays).toBeNull();
  });

  it('reports no runway for an idle account rather than one measured in centuries', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 0); // 12h of polls, balance never moves
    const d = h.derive(bal(100), { now: NOW, toUSD, computedUSD: noCost });
    expect(d.burnUSDPerDay).toBe(0);
    expect(d.runwayDays).toBeNull();
  });

  it('converts a CNY balance before reporting USD figures', () => {
    const h = fresh();
    for (let i = 0; i <= 12; i++) h.record(bal(700 - i * 7, 'CNY'), NOW - (12 - i) * HOUR);
    const d = h.derive(bal(616, 'CNY'), { now: NOW, toUSD, computedUSD: noCost });
    // 84 CNY over 12h = 168 CNY/day = $24/day at the 7:1 peg
    expect(d.burnUSDPerDay).toBeCloseTo(24, 5);
    expect(d.runwayDays).toBeCloseTo(88 / 24, 5);
  });

  it('drops the USD figures rather than guessing when no rate is known', () => {
    const h = fresh();
    for (let i = 0; i <= 12; i++) h.record(bal(700 - i * 7, 'XYZ'), NOW - (12 - i) * HOUR);
    const d = h.derive(bal(616, 'XYZ'), { now: NOW, toUSD, computedUSD: noCost });
    expect(d.burnUSDPerDay).toBeNull();
    expect(d.runwayDays).toBeNull();
    expect(d.drift).toBeNull();
    expect(d.history.length).toBeGreaterThan(0); // the sparkline still works
  });

  it('reconciles observed consumption against the computed cost', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 1); // $12 actually consumed over 12h
    const d = h.derive(bal(88), { now: NOW, toUSD, computedUSD: () => 10 });
    expect(d.drift?.observedUSD).toBeCloseTo(12, 5);
    expect(d.drift?.computedUSD).toBe(10);
    expect(d.drift?.ratio).toBeCloseTo(0.2, 5); // ccmon under-counted by 20%
  });

  it('hands the drift callback the exact span its samples cover', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 1);
    let span: [number, number] | null = null;
    h.derive(bal(88), {
      now: NOW,
      toUSD,
      computedUSD: (from, to) => {
        span = [from, to];
        return 12;
      },
    });
    expect(span).toEqual([NOW - 12 * HOUR, NOW]);
  });

  it('leaves the ratio null when there is no computed cost to divide by', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 1);
    const d = h.derive(bal(88), { now: NOW, toUSD, computedUSD: noCost });
    expect(d.drift?.ratio).toBeNull();
    expect(d.drift?.observedUSD).toBeCloseTo(12, 5);
  });

  it('withholds drift on a span too short to be meaningful, but still reports burn', () => {
    const h = fresh();
    seed(h, 4, 1, 100, 1); // 3h span — past the burn floor, under the drift floor
    const d = h.derive(bal(97), { now: NOW, toUSD, computedUSD: () => 3 });
    expect(d.burnUSDPerDay).not.toBeNull();
    expect(d.drift).toBeNull();
  });
});

describe('DeepseekHistory persistence', () => {
  it('reloads samples from disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-deepseek-test-'));
    roots.push(root);
    const file = path.join(root, 'deepseek-history.json');
    const a = new DeepseekHistory(file);
    a.record(bal(50), NOW - HOUR);
    a.record(bal(49), NOW);
    expect(new DeepseekHistory(file).uiSamples()).toHaveLength(2);
  });

  it('clear() forgets everything — a new key must not inherit the old curve', () => {
    const h = fresh();
    seed(h, 13, 1, 100, 1);
    h.clear();
    expect(h.uiSamples()).toEqual([]);
    expect(h.derive(bal(88), { now: NOW, toUSD, computedUSD: () => 1 }).burnUSDPerDay).toBeNull();
  });

  it('survives an unreadable history file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-deepseek-test-'));
    roots.push(root);
    const file = path.join(root, 'deepseek-history.json');
    fs.writeFileSync(file, '{not json');
    expect(new DeepseekHistory(file).uiSamples()).toEqual([]);
  });
});
