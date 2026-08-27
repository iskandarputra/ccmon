/**
 * @file recompute.ts
 * @brief The change signature that decides whether a snapshot rebuild is needed — pure.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Aggregation is a debounced FULL recompute (~720 ms at 110k entries), and the
 * periodic tick re-enters it every minute. This signature is what stops that
 * from costing a second of main-process CPU per minute for no reason: if the
 * signature is unchanged, nothing that could alter the snapshot has changed,
 * and the rebuild is skipped.
 *
 * It therefore has to be exhaustive in one direction and only one. A field
 * MISSING from the signature is a stale snapshot the user cannot refresh — the
 * expensive kind of bug, because it looks like the data is wrong rather than
 * the cache. A field wrongly INCLUDED only costs an unnecessary recompute.
 * When in doubt, include it.
 *
 * Lived in `main.ts` and so could not be tested; the fields it must cover are
 * exactly the ones a test can pin.
 */

import { dayKeyFor } from '../../shared/daykey';
import type { AppSettings, TimeRange, UsageEntry } from '../../shared/types';

export interface RecomputeSigInput {
  entries: readonly UsageEntry[];
  settings: AppSettings | null;
  /** pricing layer identity — a refetch re-prices every entry */
  pricingFetchedAt: number | null;
  pricingSource: string | null;
  /** latest "usage limit reached" marker */
  resetTs: number | null;
  /** true when a 5-hour block is currently open */
  blockActive: boolean;
  range: TimeRange;
  now: number;
}

/**
 * Fold everything that can change the snapshot into one comparable string.
 *
 * Notes on the two non-obvious members:
 *
 *   - the LAST entry's key, alongside the count. A count alone misses an
 *     in-place dedupe merge that upgraded the final entry's tokens without
 *     adding a row.
 *   - `now` bucketed to the minute, but ONLY while a block is open. A live
 *     block's "time remaining" and burn rate move with the clock, so the
 *     snapshot genuinely goes stale once a minute; with no block open nothing
 *     depends on the clock and the constant `'idle'` lets the tick elide.
 */
export function recomputeSig(i: RecomputeSigInput): string {
  const s = i.settings;
  const last = i.entries[i.entries.length - 1];
  return [
    i.entries.length,
    last?.key ?? '',
    s
      ? `${s.costMode}|${s.startOfWeek}|${s.tokenLimit}|${s.timezone || ''}|${s.blockHours ?? ''}|${(s.sources || []).join(',')}`
      : '',
    i.pricingFetchedAt ?? 0,
    i.pricingSource ?? '',
    i.resetTs ?? 0,
    // the day key, not the raw clock: crossing midnight re-buckets "today",
    // and it must do so in the USER's zone, not the system's
    dayKeyFor(i.now, s?.timezone || null),
    i.blockActive ? Math.floor(i.now / 60_000) : 'idle',
    `${i.range.preset}|${i.range.customStart ?? ''}|${i.range.customEnd ?? ''}`,
  ].join('§');
}
