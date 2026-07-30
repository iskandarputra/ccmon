/**
 * @file blocks.ts
 * @brief ccusage-parity 5-hour billing windows: gaps, burn rates, projections, token limits.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * ccusage-parity 5-hour billing windows, all UTC-epoch math.
 *
 * A block opens at the first entry's timestamp floored to the hour and spans
 * exactly 5h. A new block starts when an entry lands strictly more than 5h
 * after the block start, or strictly more than 5h after the previous entry —
 * the latter also records the idle stretch as a synthetic "gap" block.
 */

import type {
  ActiveBlock,
  BlockLimit,
  BlockRow,
  BurnRate,
  TokenLimitSetting,
  UsageEntry,
} from '../../shared/types';

/**
 * Anthropic's billing window, and the default. Exported because the tests and
 * the settings UI both need the canonical value.
 */
export const BLOCK_MS = 5 * 3600 * 1000;
/** Bounds for a user-chosen window — 1h is the smallest useful, 24h the largest. */
export const MIN_BLOCK_HOURS = 1;
export const MAX_BLOCK_HOURS = 24;

/** Clamp a settings value to a usable window length in ms. */
export function blockMsFor(hours: number | null | undefined): number {
  if (!hours || !Number.isFinite(hours)) return BLOCK_MS;
  const h = Math.min(MAX_BLOCK_HOURS, Math.max(MIN_BLOCK_HOURS, Math.round(hours)));
  return h * 3600 * 1000;
}
const RECENT_MS = 30 * 86400000; // history window returned to the renderer

const floorHour = (ts: number) => Math.floor(ts / 3600000) * 3600000;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface RawGap {
  isGap: true;
  start: number;
  end: number;
}

interface RawBlock {
  isGap: false;
  start: number;
  end: number;
  entries: number;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  firstTs: number;
  lastTs: number;
  models: Set<string>;
}

/**
 * Dual burn rates over the block's observed span (lastTs − firstTs).
 * `tokensPerMin` includes cache traffic and drives limit projections;
 * `tokensPerMinIndicator` is in+out only and drives the activity gauge
 * (ccusage thresholds: <2000 normal, <5000 moderate, else high).
 */
function burnRate(b: RawBlock, totalTokens: number): BurnRate | null {
  const mins = (b.lastTs - b.firstTs) / 60000;
  if (b.entries < 2 || mins <= 0) return null;
  const indicator = (b.in + b.out) / mins;
  return {
    tokensPerMin: totalTokens / mins,
    tokensPerMinIndicator: indicator,
    costPerHour: (b.cost / mins) * 60,
    level: indicator < 2000 ? 'normal' : indicator < 5000 ? 'moderate' : 'high',
  };
}

/** Token-limit gauge for the active block ('max' = largest completed block). */
function resolveLimit(
  setting: TokenLimitSetting,
  active: ActiveBlock,
  maxCompletedTokens: number,
): BlockLimit | null {
  let value: number | null = null;
  let source: 'max' | 'custom' | null = null;
  if (setting === 'max') {
    value = maxCompletedTokens;
    source = 'max';
  } else if (typeof setting === 'number' && Number.isFinite(setting)) {
    value = setting;
    source = 'custom';
  }
  if (value == null || source == null || !(value > 0)) return null;
  const currentPct = (active.totalTokens / value) * 100;
  const projectedPct = active.projection
    ? (active.projection.totalTokens / value) * 100
    : currentPct;
  return {
    value,
    source,
    currentPct,
    projectedPct,
    status: projectedPct > 100 ? 'exceeds' : projectedPct > 80 ? 'warning' : 'ok',
  };
}

export interface ComputeBlocksOptions {
  /** clock for active/limit math */
  now?: number;
  /** 'max' | number | null (the user setting) */
  tokenLimit?: TokenLimitSetting;
  /**
   * (entry) → resolved USD; aggregate passes a closure so blocks see the
   * same cost-mode dollars as the rest of the snapshot
   */
  costOf?: (e: UsageEntry) => number;
  /**
   * Window length in hours; null/absent = 5, Anthropic's actual billing window.
   * Clamped to 1-24. Only 5 matches real billing — any other value makes the
   * blocks a personal work-session view, which the settings UI says outright.
   */
  blockHours?: number | null;
}

export interface ComputeBlocksResult {
  /** rich shape for the live block panel, or null */
  active: ActiveBlock | null;
  /** last 30 days (gaps included), ascending */
  blocks: BlockRow[];
  /** all-time usage-block count (gaps excluded) */
  count: number;
  /** all-time per-block token record (active included) */
  maxBlockTokens: number;
}

/** @param entries usage entries ascending by ts */
export function computeBlocks(
  entries: UsageEntry[],
  {
    now = Date.now(),
    tokenLimit = null,
    costOf = () => 0,
    blockHours = null,
  }: ComputeBlocksOptions = {},
): ComputeBlocksResult {
  // Window length is per-call, not module state: the same process serves the
  // app, the CLI and the tests, and they must be able to disagree.
  const blockMs = blockMsFor(blockHours);
  // pass 1 — split entries into raw blocks + gap markers
  const raw: Array<RawGap | RawBlock> = [];
  let cur: RawBlock | null = null;

  for (const e of entries) {
    if (cur && (e.ts - cur.start > blockMs || e.ts - cur.lastTs > blockMs)) {
      if (e.ts - cur.lastTs > blockMs) {
        raw.push({ isGap: true, start: cur.lastTs + blockMs, end: e.ts });
      }
      cur = null;
    }
    if (!cur) {
      const start = floorHour(e.ts);
      cur = {
        isGap: false,
        start,
        end: start + blockMs,
        entries: 0,
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        models: new Set(),
      };
      raw.push(cur);
    }
    cur.entries += 1;
    cur.cost += costOf(e) || 0;
    cur.in += e.in;
    cur.out += e.out;
    cur.read += e.read;
    cur.write += e.w5m + e.w1h;
    cur.lastTs = e.ts;
    cur.models.add(e.model);
  }

  // pass 2 — shape the history, find the active block, track token records
  const cutoff = now - RECENT_MS;
  const blocks: BlockRow[] = [];
  let active: ActiveBlock | null = null;
  let count = 0;
  let maxBlockTokens = 0; // any usage block (records)
  let maxCompleted = 0; //   completed blocks only (token-limit 'max')

  for (const b of raw) {
    if (b.isGap) {
      if (b.end > cutoff) {
        blocks.push({
          id: `gap-${new Date(b.start).toISOString()}`,
          start: b.start,
          end: b.end,
          actualEnd: null,
          isActive: false,
          isGap: true,
          entries: 0,
          cost: 0,
          in: 0,
          out: 0,
          read: 0,
          write: 0,
          totalTokens: 0,
          models: [],
          burn: null,
        });
      }
      continue;
    }

    count += 1;
    const totalTokens = b.in + b.out + b.read + b.write; // cache included
    const isActive = now - b.lastTs < blockMs && now < b.end;
    if (totalTokens > maxBlockTokens) maxBlockTokens = totalTokens;
    if (!isActive && totalTokens > maxCompleted) maxCompleted = totalTokens;

    const burn = isActive ? burnRate(b, totalTokens) : null;
    if (b.end > cutoff) {
      blocks.push({
        id: new Date(b.start).toISOString(),
        start: b.start,
        end: b.end,
        actualEnd: b.lastTs,
        isActive,
        isGap: false,
        entries: b.entries,
        cost: b.cost,
        in: b.in,
        out: b.out,
        read: b.read,
        write: b.write,
        totalTokens,
        models: [...b.models],
        burn,
      });
    }

    if (isActive) {
      const remainingMinutes = Math.round((b.end - now) / 60000);
      active = {
        start: b.start,
        end: b.end,
        entries: b.entries,
        cost: b.cost,
        in: b.in,
        out: b.out,
        read: b.read,
        write: b.write,
        totalTokens,
        models: [...b.models],
        firstTs: b.firstTs,
        lastTs: b.lastTs,
        remainingMs: b.end - now,
        burn,
        projection: burn
          ? {
              totalTokens: Math.round(totalTokens + burn.tokensPerMin * remainingMinutes),
              totalCost: round2(b.cost + (burn.costPerHour / 60) * remainingMinutes),
              remainingMinutes,
            }
          : null,
        limit: null, // resolved below, once maxCompleted is final
      };
    }
  }

  if (active) active.limit = resolveLimit(tokenLimit, active, maxCompleted);

  return { active, blocks, count, maxBlockTokens };
}
