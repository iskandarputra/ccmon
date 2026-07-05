/**
 * @file plans.ts
 * @brief Resolve a detected account plan + tier to its monthly subscription price.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { PLAN_PRICES_USD } from '../../shared/plans';

/**
 * Monthly subscription price (USD) for a detected plan (docs/v2-spec.md §6).
 * Prices live in shared/plans.ts — max with an unknown tier assumes 5x;
 * team/enterprise are seat-priced by the org, so there is nothing to compare
 * and this returns null.
 */
export function planPriceUSD(plan: string | null, tier: string | null): number | null {
  const p = (plan || '').toLowerCase();
  if (p.includes('max')) return tier === '20x' ? PLAN_PRICES_USD.max20x : PLAN_PRICES_USD.max5x;
  if (p.includes('pro')) return PLAN_PRICES_USD.pro;
  return null;
}

/**
 * A distinct badge color per plan/tier so the Accounts view reads at a
 * glance — pro vs team vs max 5x vs max 20x. Returns a theme CSS var, or
 * null for an unrecognized plan (the badge falls back to its neutral
 * default).
 */
export function planBadgeColor(plan: string | null, tier: string | null): string | null {
  const p = (plan || '').toLowerCase();
  if (p.includes('max')) {
    if (tier === '20x') return 'var(--amber)'; // top tier
    if (tier === '5x') return 'var(--sage)';
    return 'var(--chart-2)'; // max, tier not yet known
  }
  if (p.includes('pro')) return 'var(--blue)';
  if (p.includes('team')) return 'var(--chart-4)';
  if (p.includes('enterprise')) return 'var(--chart-6)';
  return null;
}
