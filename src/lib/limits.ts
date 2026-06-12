/**
 * @file limits.ts
 * @brief Limit-window helpers — binding windows, scope resolution, display window.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { ActiveBlock, LimitsMap, LimitWindow } from '../../shared/types';
import { primarySource } from './format';

/**
 * Renderer mirror of main's sourceScope(): the source dirs the current
 * snapshot is built from. No saved choice → the primary account only (when
 * several roots exist); a saved selection keeps its live entries; an
 * all-stale selection falls back to the default.
 */
export function scopedDirs(sources: string[] | null | undefined, all: string[]): string[] {
  if (Array.isArray(sources) && sources.length) {
    const live = sources.filter((d) => all.includes(d));
    if (live.length === all.length) return all;
    if (live.length) return live;
  }
  if (all.length > 1) {
    const p = primarySource(all);
    if (p) return [p];
  }
  return all;
}

/**
 * The binding live session window — the one with the highest utilization,
 * since that's the limit you'll hit first. `limits` now spans every account
 * (polled independently of the data scope), so callers that mean "the window
 * for the accounts I'm viewing" pass `dirs` = the scoped source dirs; omit it
 * to bind across all logins (e.g. the accounts dashboard). Returns
 * {pct, resetsAt} or null when no considered account has live data.
 */
export function bindingSession(
  limits: LimitsMap = {},
  dirs?: string[],
): LimitWindow | null {
  let best: LimitWindow | null = null;
  for (const k of dirs ?? Object.keys(limits)) {
    const r = limits[k];
    const s = r?.ok ? r.session : null;
    if (!s || (s.pct == null && !s.resetsAt)) continue;
    if (!best || (s.pct ?? 0) > (best.pct ?? 0)) best = s;
  }
  return best;
}

/** The binding weekly (all-models) window; `dirs` scopes it as bindingSession. */
export function bindingWeek(
  limits: LimitsMap = {},
  dirs?: string[],
): LimitWindow | null {
  let best: LimitWindow | null = null;
  for (const k of dirs ?? Object.keys(limits)) {
    const r = limits[k];
    const w = r?.ok ? r.week : null;
    if (!w || (w.pct == null && !w.resetsAt)) continue;
    if (!best || (w.pct ?? 0) > (best.pct ?? 0)) best = w;
  }
  return best;
}

/** ok → warn (≥70%) → bad (≥90%) accent for a utilization percentage. */
export const limitColor = (pct: number | null | undefined): string =>
  pct == null
    ? 'var(--text-faint)'
    : pct >= 90
      ? 'var(--bad)'
      : pct >= 70
        ? 'var(--warn)'
        : 'var(--ok)';

const SESSION_MS = 5 * 3600e3;

export interface DisplayWindow {
  start: number;
  end: number;
  live: boolean;
}

/**
 * The active window to DISPLAY: Anthropic's real session window when a live
 * reset is known (resetsAt − 5h → resetsAt), else the local floor-hour block.
 * The local estimate rounds the start down to the hour, so its countdown can
 * disagree with the real reset by up to 59 minutes.
 */
export function displayWindow(
  block: Pick<ActiveBlock, 'start' | 'end'>,
  liveSession: LimitWindow | null,
  now: number,
): DisplayWindow {
  const liveEnd =
    liveSession?.resetsAt && liveSession.resetsAt > now ? liveSession.resetsAt : null;
  return liveEnd
    ? { start: liveEnd - SESSION_MS, end: liveEnd, live: true }
    : { start: block.start, end: block.end, live: false };
}
