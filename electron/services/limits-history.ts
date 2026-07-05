/**
 * @file limits-history.ts
 * @brief Persisted limit polls: sparkline history, time-to-cap forecasts, cap retrospective.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type {
  LimitSample,
  LimitsCaps,
  LimitsForecast,
  LimitsResult,
  WindowCaps,
  WindowForecast,
} from '../../shared/types';

/**
 * Persistence + forecasting for the live plan-limit polls (docs/v2-spec.md §5).
 *
 * Main records every successful non-stale poll here; the samples power the
 * per-account sparkline and the "caps ~thu 15:04 at this pace" forecasts in
 * the PlanLimits panel. Pure Node on purpose — no Electron imports.
 */

const RAW_WINDOW_MS = 2 * 3600e3; // keep every sample this recent
const THIN_BUCKET_MS = 15 * 60e3; // older samples thin to one per bucket
const MAX_AGE_MS = 7 * 86400e3; //  hard cap on history depth
const UI_POINTS = 120; //           sparkline budget per account

const RESET_DROP_PCT = 5; // utilization drop beyond this = the window reset
const MIN_SAMPLES = 3;
const FLAT_PCT_PER_HOUR = 0.05; // slower than this is "flat" — no ETA
const CAPPED_PCT = 95; // a window at/above this when it reset counts as a cap hit

interface WindowSpec {
  pick: (s: LimitSample) => number | null | undefined;
  lookbackMs: number;
  minSpanMs: number;
}

const WINDOWS: Record<'session' | 'week', WindowSpec> = {
  session: { pick: (s) => s.session, lookbackMs: 3600e3, minSpanMs: 10 * 60e3 },
  week: { pick: (s) => s.week, lookbackMs: 6 * 3600e3, minSpanMs: 30 * 60e3 },
};

/** Drop samples past the age cap; thin those older than 2h to 15-min buckets. */
function compact(arr: LimitSample[], now: number): LimitSample[] {
  const out: LimitSample[] = [];
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

/**
 * Least-squares utilization slope over the window's trailing samples, cut at
 * the most recent reset (utilization only climbs between resets, so an older
 * sample sitting meaningfully ABOVE a newer one marks a reset in between).
 */
function fitWindow(samples: LimitSample[], spec: WindowSpec, now: number): WindowForecast | null {
  const cutoff = now - spec.lookbackMs;
  const pts: Array<{ ts: number; pct: number }> = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.ts < cutoff) break;
    const pct = spec.pick(s);
    if (pct == null) continue;
    if (pts.length && pct > pts[pts.length - 1].pct + RESET_DROP_PCT) break;
    pts.push({ ts: s.ts, pct });
  }
  pts.reverse();
  if (pts.length < MIN_SAMPLES) return null;
  if (pts[pts.length - 1].ts - pts[0].ts < spec.minSpanMs) return null;

  const x0 = pts[0].ts;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = (p.ts - x0) / 3600e3; // hours, for numeric sanity
    sx += x;
    sy += p.pct;
    sxx += x * x;
    sxy += x * p.pct;
  }
  const n = pts.length;
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const pctPerHour = (n * sxy - sx * sy) / denom;

  const last = pts[pts.length - 1];
  if (pctPerHour <= FLAT_PCT_PER_HOUR) return { etaTs: null, pctPerHour };
  if (last.pct >= 100) return { etaTs: now, pctPerHour };
  const etaTs = last.ts + ((100 - last.pct) / pctPerHour) * 3600e3;
  return { etaTs: Math.max(etaTs, now), pctPerHour };
}

/** Count window resets in the history and how many happened at ~100%. */
function capsWindow(samples: LimitSample[], pick: WindowSpec['pick']): WindowCaps {
  let resets = 0;
  let capped = 0;
  let prev: number | null = null;
  for (const s of samples) {
    const pct = pick(s);
    if (pct == null) continue;
    if (prev != null && pct < prev - RESET_DROP_PCT) {
      resets += 1;
      if (prev >= CAPPED_PCT) capped += 1;
    }
    prev = pct;
  }
  return { resets, capped };
}

export class LimitsHistory {
  private readonly file: string;
  private data: Record<string, LimitSample[]> = {};

  constructor(file: string) {
    this.file = file;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, LimitSample[]>;
      if (raw && typeof raw === 'object') this.data = raw;
    } catch {
      /* first run or unreadable history — start fresh */
    }
  }

  /** Append a successful poll's utilization snapshot for one account dir. */
  record(dir: string, r: LimitsResult, now = Date.now()): void {
    if (!r.ok || r.stale) return;
    const arr = this.data[dir] || [];
    arr.push({
      ts: now,
      session: r.session?.pct ?? null,
      week: r.week?.pct ?? null,
      weekOpus: r.weekOpus?.pct ?? null,
    });
    this.data[dir] = compact(arr, now);
    this.save();
  }

  /** Thinned ascending history for renderer sparklines (≤120 points). */
  uiSamples(dir: string): LimitSample[] {
    const arr = this.data[dir] || [];
    if (arr.length <= UI_POINTS) return arr.slice();
    const step = arr.length / UI_POINTS;
    const out: LimitSample[] = [];
    for (let i = 0; i < UI_POINTS; i++) out.push(arr[Math.floor(i * step)]);
    out[out.length - 1] = arr[arr.length - 1];
    return out;
  }

  /** Time-to-cap forecast per window, or null without enough signal. */
  forecast(dir: string, now = Date.now()): LimitsForecast | null {
    const arr = this.data[dir];
    if (!arr?.length) return null;
    const session = fitWindow(arr, WINDOWS.session, now);
    const week = fitWindow(arr, WINDOWS.week, now);
    if (!session && !week) return null;
    return { session, week };
  }

  /**
   * Migrate this account's history to a new dir key after a folder rename
   * (`renameAccountDir`) — otherwise the sparkline/forecast/caps for that
   * account silently reset to empty under the new path while the old key
   * sits orphaned forever.
   */
  renameDir(oldDir: string, newDir: string): void {
    if (oldDir === newDir || !this.data[oldDir]) return;
    const merged = [...(this.data[newDir] || []), ...this.data[oldDir]].sort((a, b) => a.ts - b.ts);
    this.data[newDir] = merged;
    delete this.data[oldDir];
    this.save();
  }

  /** Reset/cap retrospective over the retained history, or null when empty. */
  caps(dir: string): LimitsCaps | null {
    const arr = this.data[dir];
    if (!arr?.length) return null;
    return {
      session: capsWindow(arr, WINDOWS.session.pick),
      week: capsWindow(arr, WINDOWS.week.pick),
    };
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch (err) {
      console.warn('[ccmon] limits history not saved:', (err as Error).message);
    }
  }
}
