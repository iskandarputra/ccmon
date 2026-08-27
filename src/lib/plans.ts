/**
 * @file plans.ts
 * @brief Resolve a detected account plan + tier to its monthly subscription price.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { CHATGPT_PLAN_PRICES_USD, PLAN_PRICES_USD } from '../../shared/plans';
import type { ToolId } from '../../shared/types';

/**
 * Monthly subscription price (USD) for a detected plan (docs/v2-spec.md §6).
 * Prices live in shared/plans.ts — max with an unknown tier assumes 5x;
 * team/enterprise are seat-priced by the org, so there is nothing to compare
 * and this returns null.
 *
 * `tool` selects the price table, and is NOT optional in spirit: the two
 * vocabularies collide on "pro" for very different money (Claude Pro $20,
 * ChatGPT Pro $200), so pricing a Codex plan against the Anthropic table
 * under-reports it tenfold. It defaults to 'claude' only so existing
 * Claude-only call sites read unchanged.
 */
export function planPriceUSD(
  plan: string | null,
  tier: string | null,
  tool: ToolId = 'claude',
): number | null {
  const p = (plan || '').toLowerCase();
  if (tool === 'codex') {
    // exact matches: "pro" must never be reached by a substring test that
    // "enterprise" or a future "pro-max" would also satisfy
    if (p === 'plus') return CHATGPT_PLAN_PRICES_USD.plus;
    if (p === 'pro') return CHATGPT_PLAN_PRICES_USD.pro;
    return null; // free, business, enterprise, or unrecognised
  }
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
