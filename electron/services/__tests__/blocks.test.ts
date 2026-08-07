/**
 * @file blocks.test.ts
 * @brief Unit tests for the 5-hour block math — windowing, gaps, burn, projections, limits.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { BLOCK_MS, MAX_BLOCK_HOURS, MIN_BLOCK_HOURS, blockMsFor, computeBlocks } from '../blocks';
import { HOUR, MIN, makeEntry } from './helpers';

const T0 = Date.parse('2026-06-01T10:20:00Z'); // floors to 10:00

describe('computeBlocks — windowing', () => {
  it('opens at the entry hour floored and spans exactly 5h', () => {
    const { blocks, count } = computeBlocks([makeEntry({ ts: T0 })], { now: T0 + MIN });
    expect(count).toBe(1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(Date.parse('2026-06-01T10:00:00Z'));
    expect(blocks[0].end).toBe(blocks[0].start + BLOCK_MS);
  });

  it('inserts a gap block when entries sit more than 5h apart', () => {
    const e1 = makeEntry({ ts: T0 });
    const e2 = makeEntry({ ts: T0 + 7 * HOUR });
    const { blocks, count } = computeBlocks([e1, e2], { now: T0 + 8 * HOUR });
    expect(count).toBe(2);
    expect(blocks.map((b) => b.isGap)).toEqual([false, true, false]);
    const gap = blocks[1];
    expect(gap.start).toBe(e1.ts + BLOCK_MS);
    expect(gap.end).toBe(e2.ts);
  });

  it('starts a new block past the 5h window WITHOUT a gap when activity continued', () => {
    const e1 = makeEntry({ ts: T0 });
    const e2 = makeEntry({ ts: T0 + 4 * HOUR });
    const e3 = makeEntry({ ts: T0 + 5 * HOUR }); // >5h after block START (10:00), <5h after e2
    const { blocks } = computeBlocks([e1, e2, e3], { now: T0 + 6 * HOUR });
    expect(blocks.filter((b) => b.isGap)).toHaveLength(0);
    expect(blocks.filter((b) => !b.isGap)).toHaveLength(2);
  });

  it('totalTokens includes cache traffic', () => {
    const e = makeEntry({ ts: T0, in: 10, out: 20, read: 300, w5m: 40, w1h: 5 });
    const { blocks } = computeBlocks([e], { now: T0 });
    expect(blocks[0].totalTokens).toBe(10 + 20 + 300 + 40 + 5);
  });

  it('keeps old blocks in count/records but out of the 30-day history', () => {
    const old = makeEntry({ ts: T0 - 40 * 24 * HOUR, in: 9000, out: 0, read: 0 });
    const fresh = makeEntry({ ts: T0 });
    const { blocks, count, maxBlockTokens } = computeBlocks([old, fresh], { now: T0 + MIN });
    expect(count).toBe(2);
    expect(blocks.filter((b) => !b.isGap)).toHaveLength(1); // only the fresh one
    expect(maxBlockTokens).toBe(9000);
  });
});

describe('computeBlocks — active block, burn, projection, limit', () => {
  const e1 = makeEntry({ ts: T0, in: 1000, out: 500, read: 0, w5m: 0 });
  const e2 = makeEntry({ ts: T0 + 10 * MIN, in: 3000, out: 1500, read: 1000, w5m: 0 });
  const now = T0 + 20 * MIN;

  it('computes burn over the observed span with ccusage semantics', () => {
    const { active } = computeBlocks([e1, e2], { now, costOf: () => 1.2 });
    expect(active).not.toBeNull();
    const burn = active!.burn!;
    // span = 10 min; indicator = (in+out)/min = 6000/10
    expect(burn.tokensPerMinIndicator).toBeCloseTo(600);
    // tokensPerMin includes cache: 7000/10
    expect(burn.tokensPerMin).toBeCloseTo(700);
    // cost 2 × 1.2 over 10 min → per hour
    expect(burn.costPerHour).toBeCloseTo((2.4 / 10) * 60);
    expect(burn.level).toBe('normal');
  });

  it('grades burn levels by the in+out indicator', () => {
    const fast = [
      makeEntry({ ts: T0, in: 0, out: 0 }),
      makeEntry({ ts: T0 + 10 * MIN, in: 49_000, out: 3000 }), // 5200/min
    ];
    const { active } = computeBlocks(fast, { now });
    expect(active!.burn!.level).toBe('high');
  });

  it('projects to the block end at the current burn rate', () => {
    const { active } = computeBlocks([e1, e2], { now, costOf: () => 1.2 });
    const proj = active!.projection!;
    const remainingMinutes = Math.round((active!.end - now) / MIN);
    expect(proj.remainingMinutes).toBe(remainingMinutes);
    expect(proj.totalTokens).toBe(Math.round(7000 + 700 * remainingMinutes));
  });

  it('resolves a custom token limit with status thresholds', () => {
    const { active } = computeBlocks([e1, e2], { now, tokenLimit: 1_000_000 });
    const limit = active!.limit!;
    expect(limit.source).toBe('custom');
    expect(limit.currentPct).toBeCloseTo(0.7);
    expect(limit.status).toBe('ok');
  });

  it("token limit 'max' uses the largest COMPLETED block", () => {
    const big = makeEntry({ ts: T0 - 24 * HOUR, in: 50_000, out: 0 });
    const { active } = computeBlocks([big, e1, e2], { now, tokenLimit: 'max' });
    expect(active!.limit!.value).toBe(50_000);
    expect(active!.limit!.source).toBe('max');
  });

  it('reports no active block once the window lapses', () => {
    const { active } = computeBlocks([e1, e2], { now: T0 + 6 * HOUR });
    expect(active).toBeNull();
  });
});

describe('computeBlocks — configurable window length', () => {
  it("defaults to Anthropic's 5 hours", () => {
    expect(blockMsFor(null)).toBe(BLOCK_MS);
    expect(blockMsFor(undefined)).toBe(BLOCK_MS);
    expect(blockMsFor(5)).toBe(BLOCK_MS);
  });

  it('clamps to a usable 1-24h and ignores nonsense', () => {
    expect(blockMsFor(0)).toBe(BLOCK_MS); // falsy → default, not a zero window
    expect(blockMsFor(-3)).toBe(MIN_BLOCK_HOURS * 3600 * 1000);
    expect(blockMsFor(999)).toBe(MAX_BLOCK_HOURS * 3600 * 1000);
    expect(blockMsFor(Number.NaN)).toBe(BLOCK_MS);
    expect(blockMsFor(2.4)).toBe(2 * 3600 * 1000); // rounded
  });

  it('splits one span into more blocks as the window shrinks', () => {
    const t0 = Date.parse('2026-06-10T00:00:00Z');
    // one entry per hour for 9 hours
    const entries = Array.from({ length: 9 }, (_, i) =>
      makeEntry({ ts: t0 + i * HOUR, in: 10, out: 5, costUSD: 1 }),
    );
    const at = (h: number | null) =>
      computeBlocks(entries, { now: t0 + 9 * HOUR, blockHours: h }).count;

    expect(at(null)).toBe(2); // 5h default: 0-5, 5-9
    expect(at(3)).toBeGreaterThan(at(null)); // shorter window → more blocks
    expect(at(24)).toBe(1); // one long window swallows the lot
  });

  it('keeps the whole span accounted for at every window length', () => {
    const t0 = Date.parse('2026-06-10T00:00:00Z');
    const entries = Array.from({ length: 9 }, (_, i) =>
      makeEntry({ ts: t0 + i * HOUR, in: 10, out: 5, costUSD: 1 }),
    );
    for (const h of [1, 2, 5, 12, 24]) {
      const r = computeBlocks(entries, { now: t0 + 9 * HOUR, blockHours: h });
      const usage = r.blocks.filter((b) => !b.isGap);
      // every entry lands in exactly one usage block, whatever the window
      expect(usage.reduce((n, b) => n + b.entries, 0)).toBe(9);
    }
  });

  it('treats a longer gap as a gap under a shorter window', () => {
    const t0 = Date.parse('2026-06-10T00:00:00Z');
    const entries = [
      makeEntry({ ts: t0, in: 10, out: 5, costUSD: 1 }),
      makeEntry({ ts: t0 + 4 * HOUR, in: 10, out: 5, costUSD: 1 }),
    ];
    // 4h apart: inside a 5h window, but a gap once the window is 2h
    expect(computeBlocks(entries, { now: t0 + 4 * HOUR, blockHours: 5 }).count).toBe(1);
    const short = computeBlocks(entries, { now: t0 + 4 * HOUR, blockHours: 2 });
    expect(short.count).toBe(2);
    expect(short.blocks.some((b) => b.isGap)).toBe(true);
  });
});
