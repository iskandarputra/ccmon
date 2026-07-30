/**
 * @file status-text.ts
 * @brief Pure text formatters for ambient surfaces — the tray and the CLI statusline.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The tray (Electron, main-process) and the CLI statusline (plain node) need the
 * same compact renderings of the same numbers, so they live here: pure Node, no
 * Electron, unit-testable without a window or a scan.
 *
 * Deliberately NOT `src/lib/format.ts`: that one converts to the user's display
 * currency at render time inside the renderer. These surfaces are outside the
 * renderer and always speak USD, which is what every stored dollar already is.
 */

import type { LimitsMap, LimitWindow, Snapshot } from '../../shared/types';

/** Fixed-2 USD. */
export const usd = (n: number | null | undefined): string => `$${(n || 0).toFixed(2)}`;

/**
 * Money formatter honouring privacy mode.
 *
 * The tray and the CLI statusline are on-screen surfaces, so a privacy toggle
 * that only masked the window would be broken by a tooltip. `ccmon json` and
 * `ccmon csv` are deliberately NOT masked — they are data for scripts, and
 * blanking numbers there would corrupt the output rather than protect it.
 */
export const money = (n: number | null | undefined, privacy = false): string =>
  privacy ? '$•••' : usd(n);

/** `1.2B` / `3.4M` / `56k` / `789` — for spaces where digits are expensive. */
export function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** `2h 45m`, `45m`, `0m`. Never negative — an expired deadline reads `0m`. */
export function humanDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** The most-consumed live window across every account, or null when none. */
export interface NearestCap {
  /** account label, as passed through `labelFor` */
  account: string;
  /** 'session' | 'week' | 'week (opus)' | 'week (sonnet)' */
  window: string;
  pct: number;
  resetsAt: number | null;
}

/**
 * Find the single window closest to its cap. That is the one number a glance
 * should surface: it answers "am I about to be cut off" regardless of which
 * account or window is responsible.
 *
 * Stale results still count — aging data is the app's documented behaviour and
 * hiding a 95% window because the last poll failed would be the dangerous
 * choice. Failed results carry no windows and are skipped.
 */
export function nearestCap(limits: LimitsMap, labelFor: (dir: string) => string): NearestCap | null {
  let best: NearestCap | null = null;
  for (const [dir, r] of Object.entries(limits || {})) {
    if (!r || !r.ok) continue;
    const windows: Array<[string, LimitWindow | null | undefined]> = [
      ['session', r.session],
      ['week', r.week],
      ['week (opus)', r.weekOpus],
      ['week (sonnet)', r.weekSonnet],
    ];
    for (const [name, w] of windows) {
      if (w?.pct == null) continue;
      if (best && w.pct <= best.pct) continue;
      best = { account: labelFor(dir), window: name, pct: w.pct, resetsAt: w.resetsAt ?? null };
    }
  }
  return best;
}

export interface TrayText {
  /** hover text — one line, the three numbers that matter */
  tooltip: string;
  /** disabled menu rows, in order; the menu is the only readable surface on Linux */
  lines: string[];
  /** macOS-only ambient label next to the icon; kept very short */
  title: string;
}

/**
 * Build every string the tray shows.
 *
 * Written as one pure function returning all three renderings so the tooltip,
 * the menu and the macOS title can never disagree about the same number.
 * A null snapshot means "still scanning" rather than "$0.00", because showing
 * a confident zero during startup is a lie.
 */
export function trayText(
  snapshot: Snapshot | null,
  limits: LimitsMap,
  labelFor: (dir: string) => string,
  now = Date.now(),
  privacy = false,
): TrayText {
  if (!snapshot) {
    return { tooltip: 'ccmon · scanning…', lines: ['scanning…'], title: '' };
  }

  const today = money(snapshot.today.cost, privacy);
  const lines: string[] = [`today  ${today}`];

  const block = snapshot.block;
  if (block) {
    lines.push(`block  ${money(block.cost, privacy)} · ${humanDuration(block.remainingMs)} left`);
    if (block.burn) {
      lines.push(`burn   ${money(block.burn.costPerHour, privacy)}/hr · ${block.burn.level}`);
    }
  } else {
    lines.push('block  none active');
  }

  const cap = nearestCap(limits, labelFor);
  if (cap) {
    const reset = cap.resetsAt ? ` · resets ${humanDuration(cap.resetsAt - now)}` : '';
    lines.push(`cap    ${Math.round(cap.pct)}% ${cap.window} (${cap.account})${reset}`);
  }

  // A quota already exhausted outranks everything else on screen.
  const resetTs = block?.usageLimitResetTs ?? snapshot.usageLimitResetTs;
  if (resetTs && resetTs > now) {
    lines.push(`limit  resets in ${humanDuration(resetTs - now)}`);
  }

  const tipParts = [`ccmon · ${today} today`];
  if (block) {
    tipParts.push(`block ${money(block.cost, privacy)} (${humanDuration(block.remainingMs)} left)`);
  }
  if (cap) tipParts.push(`${Math.round(cap.pct)}% ${cap.window}`);

  return {
    tooltip: tipParts.join(' · '),
    lines,
    // the macOS menu bar is scarce real estate: spend, plus a cap only once
    // it is worth interrupting someone over
    title: cap && cap.pct >= 90 ? `${today} ${Math.round(cap.pct)}%` : today,
  };
}
