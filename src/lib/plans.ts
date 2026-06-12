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
