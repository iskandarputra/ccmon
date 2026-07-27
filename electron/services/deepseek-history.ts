/**
 * @file deepseek-history.ts
 * @brief Persisted DeepSeek balance polls: sparkline history, measured burn,
 *        runway, and the computed-vs-observed drift reconciliation.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type {
  DeepseekBalance,
  DeepseekDrift,
  DeepseekSample,
} from '../../shared/types';

/**
 * DeepSeek publishes a balance and nothing else — no usage history, no quota
 * endpoint (docs/v2-spec.md §5.7). Everything more interesting than "you have
 * $X left" has to be measured here, by watching that number move.
 *
 * The balance falling IS the ground truth for what the account spent, which
 * makes it a rare thing in ccmon: a number the app can check itself against.
 * `drift` does exactly that — it compares the balance actually consumed with
 * what ccmon computed from the local transcripts over the same span, so a
 * stale pricing snapshot or DeepSeek usage from outside Claude Code shows up
 * as a gap instead of silently skewing every cost on screen.
 *
 * Pure Node on purpose — no Electron imports. Currency conversion and the
 * transcript-derived cost are INJECTED (main owns the rate table and the
 * entries), which keeps this file unit-testable with plain functions.
 */

const RAW_WINDOW_MS = 24 * 3600e3; //  keep every sample this recent
const THIN_BUCKET_MS = 3600e3; //      older samples thin to one per hour
const MAX_AGE_MS = 30 * 86400e3; //    hard cap on history depth
const UI_POINTS = 120; //              sparkline budget

const WINDOW_MS = 7 * 86400e3; //      lookback for burn + drift
const MIN_BURN_SPAN_MS = 2 * 3600e3; //   below this a burn rate is noise
const MIN_DRIFT_SPAN_MS = 6 * 3600e3; //  drift needs a longer arc to mean anything

/** Convert a native-currency amount to USD, or null when no rate is known. */
export type ToUSD = (amount: number, currency: string) => number | null;

export interface DeriveOptions {
  now?: number;
  toUSD: ToUSD;
  /** transcript-derived DeepSeek cost in USD over [fromTs, toTs] */
  computedUSD: (fromTs: number, toTs: number) => number;
}

export interface DeepseekDerived {
  history: DeepseekSample[];
  burnUSDPerDay: number | null;
  runwayDays: number | null;
  drift: DeepseekDrift | null;
}

/** Drop samples past the age cap; thin those older than 24h to hourly buckets. */
export function compact(arr: DeepseekSample[], now: number): DeepseekSample[] {
  const out: DeepseekSample[] = [];
  let lastBucket = -1;
  for (const s of arr) {
    if (now - s.ts > MAX_AGE_MS) continue;
    if (now - s.ts <= RAW_WINDOW_MS) {
      out.push(s);
      continue;
    }
    const bucket = Math.floor(s.ts / THIN_BUCKET_MS);
    if (bucket !== lastBucket) {
      out.push(s);
      lastBucket = bucket;
    }
  }
  return out;
}

interface Consumption {
  fromTs: number;
  toTs: number;
  /** balance consumed over the span, in the samples' native currency */
  spent: number;
  currency: string;
}

/**
 * Balance actually consumed over the trailing window.
 *
 * Only DROPS count. A top-up raises the balance between two polls, and
 * netting that against spend would report a user who topped up $100 as having
 * earned money back — so positive deltas just re-baseline. Consecutive
 * samples in different currencies are never differenced (an account switch
 * would otherwise read as one enormous spend or refund).
 *
 * Caveat this cannot see: DeepSeek's granted balance expires, and an
 * expiry lands here as a drop indistinguishable from spend. It inflates burn
 * for one window and then washes out.
 */
export function consumption(
  samples: DeepseekSample[],
  currency: string,
  now: number,
): Consumption | null {
  const cutoff = now - WINDOW_MS;
  const win = samples.filter((s) => s.ts >= cutoff && s.currency === currency);
  if (win.length < 2) return null;
  let spent = 0;
  for (let i = 1; i < win.length; i++) {
    const delta = win[i - 1].total - win[i].total;
    if (delta > 0) spent += delta;
  }
  return { fromTs: win[0].ts, toTs: win[win.length - 1].ts, spent, currency };
}

export class DeepseekHistory {
  private readonly file: string;
  private samples: DeepseekSample[] = [];

  constructor(file: string) {
    this.file = file;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { samples?: DeepseekSample[] };
      if (Array.isArray(raw?.samples)) this.samples = raw.samples;
    } catch {
      /* first run or unreadable history — start fresh */
    }
  }

  /** Append one successful poll's primary balance. */
  record(primary: DeepseekBalance, now = Date.now()): void {
    this.samples.push({ ts: now, total: primary.total, currency: primary.currency });
    this.samples = compact(this.samples, now);
    this.save();
  }

  /** Thinned ascending history for the renderer sparkline (≤120 points). */
  uiSamples(): DeepseekSample[] {
    const arr = this.samples;
    if (arr.length <= UI_POINTS) return arr.slice();
    const step = arr.length / UI_POINTS;
    const out: DeepseekSample[] = [];
    for (let i = 0; i < UI_POINTS; i++) out.push(arr[Math.floor(i * step)]);
    out[out.length - 1] = arr[arr.length - 1];
    return out;
  }

  /**
   * Everything measured rather than reported: burn, runway, and the drift
   * reconciliation. Each piece degrades to null on its own — a missing
   * exchange rate kills the USD figures without touching the sparkline, and a
   * short history yields a burn rate but no drift.
   */
  derive(primary: DeepseekBalance, opts: DeriveOptions): DeepseekDerived {
    const now = opts.now ?? Date.now();
    const history = this.uiSamples();
    const cons = consumption(this.samples, primary.currency, now);
    const span = cons ? cons.toTs - cons.fromTs : 0;

    let burnUSDPerDay: number | null = null;
    let runwayDays: number | null = null;
    if (cons && span >= MIN_BURN_SPAN_MS) {
      const spentUSD = opts.toUSD(cons.spent, cons.currency);
      if (spentUSD != null) {
        burnUSDPerDay = spentUSD / (span / 86400e3);
        const totalUSD = opts.toUSD(primary.total, primary.currency);
        // a burn under a cent a day is indistinguishable from an idle account;
        // dividing by it yields a runway of centuries, which is worse than none
        if (totalUSD != null && burnUSDPerDay > 0.01) runwayDays = totalUSD / burnUSDPerDay;
      }
    }

    let drift: DeepseekDrift | null = null;
    if (cons && span >= MIN_DRIFT_SPAN_MS) {
      const observedUSD = opts.toUSD(cons.spent, cons.currency);
      if (observedUSD != null) {
        const computedUSD = opts.computedUSD(cons.fromTs, cons.toTs);
        drift = {
          fromTs: cons.fromTs,
          toTs: cons.toTs,
          observedUSD,
          computedUSD,
          ratio: computedUSD > 0.005 ? observedUSD / computedUSD - 1 : null,
        };
      }
    }

    return { history, burnUSDPerDay, runwayDays, drift };
  }

  /** Forget every sample — used when the user disconnects a key. */
  clear(): void {
    this.samples = [];
    this.save();
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ samples: this.samples }));
    } catch (err) {
      console.warn('[ccmon] deepseek history not saved:', (err as Error).message);
    }
  }
}
