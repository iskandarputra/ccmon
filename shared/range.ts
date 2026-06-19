/**
 * @file range.ts
 * @brief Pure resolver for the global analytics time range — preset → absolute
 *        day-key bounds. Shared by main (resolve at recompute) and renderer
 *        (labels, default). No IO; safe in both processes.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { RangePreset, ResolvedRange, TimeRange } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' in LOCAL time (matches parser.localDateKey + aggregate keys). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Noon-anchored local Date for `now` (dodges DST edges in day arithmetic). */
function noon(now: number): Date {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  return d;
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Short 'Jun 3' style label for a 'YYYY-MM-DD' key. */
function shortLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/**
 * Resolve a {@link TimeRange} against `now` to inclusive local day-key bounds.
 * Rolling presets (7d/30d/90d) end today; calendar presets (month/lastMonth)
 * snap to month edges; 'all' is unbounded; 'custom' uses the stored keys
 * (normalized so start ≤ end). The result is display-labelled.
 */
export function resolveRange(range: TimeRange, now: number): ResolvedRange {
  const today = noon(now);
  const todayKey = dayKey(today);
  const back = (days: number): string => {
    const d = noon(now);
    d.setDate(d.getDate() - days);
    return dayKey(d);
  };

  const preset: RangePreset = range?.preset ?? 'all';
  switch (preset) {
    case 'today':
      return { preset, startKey: todayKey, endKey: todayKey, label: 'today' };
    case '7d':
      return { preset, startKey: back(6), endKey: todayKey, label: 'last 7 days' };
    case '30d':
      return { preset, startKey: back(29), endKey: todayKey, label: 'last 30 days' };
    case '90d':
      return { preset, startKey: back(89), endKey: todayKey, label: 'last 90 days' };
    case 'month': {
      const s = noon(now);
      s.setDate(1);
      return { preset, startKey: dayKey(s), endKey: todayKey, label: monthLabel(s) };
    }
    case 'lastMonth': {
      const s = noon(now);
      s.setDate(1);
      s.setMonth(s.getMonth() - 1);
      const e = noon(now);
      e.setDate(0); // day 0 of this month = last day of previous month
      return { preset, startKey: dayKey(s), endKey: dayKey(e), label: monthLabel(s) };
    }
    case 'custom': {
      let startKey = range.customStart || null;
      let endKey = range.customEnd || null;
      if (startKey && endKey && startKey > endKey) [startKey, endKey] = [endKey, startKey];
      const label =
        startKey && endKey
          ? startKey === endKey
            ? shortLabel(startKey)
            : `${shortLabel(startKey)} – ${shortLabel(endKey)}`
          : startKey
            ? `since ${shortLabel(startKey)}`
            : endKey
              ? `until ${shortLabel(endKey)}`
              : 'all time';
      return { preset, startKey, endKey, label };
    }
    case 'all':
    default:
      return { preset: 'all', startKey: null, endKey: null, label: 'all time' };
  }
}

/**
 * Does a local day key fall within the resolved bounds? Inclusive on both ends;
 * a null bound is unbounded. String comparison is valid for zero-padded
 * 'YYYY-MM-DD'. 'all' (both null) accepts everything.
 */
export function dayKeyInRange(dateKey: string, range: ResolvedRange): boolean {
  if (range.startKey && dateKey < range.startKey) return false;
  if (range.endKey && dateKey > range.endKey) return false;
  return true;
}

/** True when the range actually constrains anything (i.e. not lifetime). */
export function isBoundedRange(range: ResolvedRange): boolean {
  return range.startKey != null || range.endKey != null;
}
