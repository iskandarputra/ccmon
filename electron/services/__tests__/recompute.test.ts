/**
 * @file recompute.test.ts
 * @brief Unit tests for the snapshot-invalidation signature.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The asymmetry that makes these worth writing: a field MISSING from the
 * signature shows up as a stale snapshot the user cannot refresh — which reads
 * as "the numbers are wrong", not "the cache is wrong". A field wrongly
 * included only costs a recompute. So every test here asserts that some change
 * DOES invalidate; only the last group asserts that something doesn't.
 */

import { describe, expect, it } from 'vitest';
import { recomputeSig, type RecomputeSigInput } from '../recompute';
import { makeEntry } from './helpers';
import { DEFAULTS } from '../settings';
import type { AppSettings } from '../../../shared/types';

const NOW = Date.parse('2026-06-01T12:00:00Z');

const base = (over: Partial<RecomputeSigInput> = {}): RecomputeSigInput => ({
  entries: [makeEntry({ key: 'a' }), makeEntry({ key: 'b' })],
  settings: { ...DEFAULTS },
  pricingFetchedAt: 1000,
  pricingSource: 'bundled',
  resetTs: null,
  blockActive: false,
  range: { preset: 'all' },
  now: NOW,
  ...over,
});

/** Changing `patch` must produce a different signature. */
const invalidates = (patch: Partial<RecomputeSigInput>) =>
  expect(recomputeSig(base(patch))).not.toBe(recomputeSig(base()));

const settings = (over: Partial<AppSettings>): AppSettings => ({ ...DEFAULTS, ...over });

describe('recomputeSig — what must invalidate', () => {
  it('a new entry', () => {
    invalidates({
      entries: [makeEntry({ key: 'a' }), makeEntry({ key: 'b' }), makeEntry({ key: 'c' })],
    });
  });

  /**
   * The count alone is not enough. A dedupe merge upgrades an existing entry's
   * tokens in place without adding a row, and if that entry is the last one the
   * key is the only thing that moves.
   */
  it('the last entry being replaced without the count changing', () => {
    invalidates({ entries: [makeEntry({ key: 'a' }), makeEntry({ key: 'different' })] });
  });

  it('the cost mode', () => invalidates({ settings: settings({ costMode: 'display' }) }));
  it('the token limit', () => invalidates({ settings: settings({ tokenLimit: 5_000_000 }) }));
  it('the timezone', () => invalidates({ settings: settings({ timezone: 'Asia/Tokyo' }) }));
  it('the block length', () => invalidates({ settings: settings({ blockHours: 8 }) }));
  it('the selected sources', () => invalidates({ settings: settings({ sources: ['/a'] }) }));

  it('a pricing refetch', () => invalidates({ pricingFetchedAt: 2000 }));
  it('the pricing layer source', () => invalidates({ pricingSource: 'litellm' }));
  it('a new usage-limit reset marker', () => invalidates({ resetTs: 12345 }));
  it('the analytics range', () => invalidates({ range: { preset: '7d' } }));
  it('a custom range boundary', () => {
    const a = recomputeSig(base({ range: { preset: 'custom', customStart: '2026-01-01' } }));
    const b = recomputeSig(base({ range: { preset: 'custom', customStart: '2026-01-02' } }));
    expect(a).not.toBe(b);
  });

  /** Crossing midnight re-buckets "today" — in the USER's zone, not the system's. */
  it('crossing a day boundary in the configured timezone', () => {
    const tz = settings({ timezone: 'UTC' });
    const before = recomputeSig(base({ settings: tz, now: Date.parse('2026-06-01T23:59:00Z') }));
    const after = recomputeSig(base({ settings: tz, now: Date.parse('2026-06-02T00:01:00Z') }));
    expect(before).not.toBe(after);
  });

  /** A live block's remaining time and burn rate move with the clock. */
  it('a minute passing while a block is open', () => {
    const a = recomputeSig(base({ blockActive: true, now: NOW }));
    const b = recomputeSig(base({ blockActive: true, now: NOW + 61_000 }));
    expect(a).not.toBe(b);
  });
});

describe('recomputeSig — what must NOT invalidate', () => {
  it('is stable for identical inputs', () => {
    expect(recomputeSig(base())).toBe(recomputeSig(base()));
  });

  /**
   * With no block open nothing depends on the wall clock, so the once-a-minute
   * periodic tick must elide — otherwise an idle app rebuilds the whole
   * snapshot every 60 s forever.
   */
  it('time passing while NO block is open', () => {
    const a = recomputeSig(base({ blockActive: false, now: NOW }));
    const b = recomputeSig(base({ blockActive: false, now: NOW + 5 * 60_000 }));
    expect(a).toBe(b);
  });

  it('handles a null settings object without throwing', () => {
    expect(() => recomputeSig(base({ settings: null }))).not.toThrow();
  });

  it('handles an empty entry list', () => {
    expect(() => recomputeSig(base({ entries: [] }))).not.toThrow();
  });
});
