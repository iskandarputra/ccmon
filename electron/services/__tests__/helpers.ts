/**
 * @file helpers.ts
 * @brief Shared test fixtures — synthetic usage entries and time constants.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { localDateKey } from '../parser';
import type { UsageEntry } from '../../../shared/types';

let seq = 0;

/** Synthetic usage entry; dateKey always derived from ts (local tz, like the parser). */
export function makeEntry(over: Partial<UsageEntry> = {}): UsageEntry {
  seq += 1;
  const ts = over.ts ?? Date.parse('2026-06-01T10:00:00Z');
  return {
    key: `k${seq}`,
    msgId: `m${seq}`,
    ts,
    model: 'test-model',
    fast: false,
    project: '/p/alpha',
    sessionId: 's1',
    sidechain: false,
    in: 100,
    out: 50,
    read: 0,
    w5m: 0,
    w1h: 0,
    costUSD: null,
    ...over,
    // dateKey always derives from the final ts — never allow disagreement
    dateKey: localDateKey(ts),
  };
}

export const HOUR = 3_600_000;
export const MIN = 60_000;
