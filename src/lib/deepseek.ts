/**
 * @file deepseek.ts
 * @brief Renderer-side DeepSeek balance math — native-currency conversion,
 *        transcript-derived burn fallback, and runway/drift labelling.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { isDeepseekModel } from '../../shared/providers';
import type { CurrencyRates, DayRow, DeepseekResult } from '../../shared/types';

/**
 * A DeepSeek balance arrives in the account's own currency — commonly CNY,
 * which is the one number in ccmon that is NOT already USD (docs/v2-spec.md
 * §5.4). Everything here converts to USD first so `fmtUSD` can then apply the
 * user's chosen display currency exactly like every other figure on screen.
 */

/** Native amount → USD via the hourly rate table, or null when no rate is known. */
export function nativeToUSD(
  amount: number,
  currency: string,
  rates: CurrencyRates | null,
): number | null {
  if (currency === 'USD') return amount;
  const rate = rates?.rates?.[currency];
  return typeof rate === 'number' && rate > 0 ? amount / rate : null;
}

/** Native-currency rendering (`CN¥ 110.00`) for the "on DeepSeek's books" note. */
export function fmtNative(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`; // unknown ISO code — still readable
  }
}

/**
 * Average daily DeepSeek spend from the local transcripts, over the trailing
 * `lookback` days that actually carry data.
 *
 * This is the fallback burn: the measured one (from the balance falling) only
 * exists after a couple of hours of polling, and a user who just connected a
 * key should still see a runway. Days with no DeepSeek usage at all are
 * excluded — averaging a week that includes four untouched days would halve
 * the burn of someone who only works weekdays and overstate their runway.
 */
export function transcriptBurnUSDPerDay(days: DayRow[], lookback = 7): number | null {
  const window = days.slice(-lookback);
  let total = 0;
  let active = 0;
  for (const d of window) {
    const cost = d.models.reduce((s, m) => (isDeepseekModel(m.model) ? s + m.cost : s), 0);
    if (cost > 0) {
      total += cost;
      active += 1;
    }
  }
  return active > 0 ? total / active : null;
}

export interface Runway {
  days: number;
  /** 'measured' → from the balance actually falling; 'transcripts' → local cost */
  source: 'measured' | 'transcripts';
  burnUSDPerDay: number;
}

/**
 * Days of balance left. Prefers the measured burn — the balance falling is
 * ground truth and captures spend ccmon can't see (other tools, other
 * machines) — and falls back to the transcript estimate until enough polls
 * have accumulated. The source is carried through so the UI can say which
 * one it used rather than presenting an estimate as a measurement.
 */
export function deriveRunway(
  result: DeepseekResult | null,
  rates: CurrencyRates | null,
  days: DayRow[],
): Runway | null {
  if (!result?.ok) return null;
  if (result.runwayDays != null && result.burnUSDPerDay != null) {
    return { days: result.runwayDays, source: 'measured', burnUSDPerDay: result.burnUSDPerDay };
  }
  const balanceUSD = nativeToUSD(result.primary.total, result.primary.currency, rates);
  const burn = transcriptBurnUSDPerDay(days);
  if (balanceUSD == null || burn == null || burn <= 0.01) return null;
  return { days: balanceUSD / burn, source: 'transcripts', burnUSDPerDay: burn };
}

/** Runway as a short label: `4h` · `12d` · `3.4mo` · `>1y`. */
export function runwayLabel(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '—';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 60) return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
  if (days < 365) return `${(days / 30.44).toFixed(1)}mo`;
  return '>1y';
}

/** How alarmed to be about a runway, mapped to the theme's status tokens. */
export function runwayColor(days: number): string {
  if (days < 3) return 'var(--bad)';
  if (days < 10) return 'var(--warn)';
  return 'var(--ok)';
}

/**
 * Whether a drift ratio is worth flagging. Below ±10% is ordinary noise —
 * poll timing, rounding, off-peak rates — and a badge on every card would
 * train the user to ignore it.
 */
export const DRIFT_ALERT = 0.1;

/** `+18%` / `−4%` — signed, so the direction of the gap reads at a glance. */
export function driftLabel(ratio: number): string {
  const pct = ratio * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`;
}
