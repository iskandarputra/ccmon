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
 * The plan as a person would name it: "Team - Pro Max x5", not "team · 5x".
 *
 * Two facts get combined, and they are genuinely separate. The PLAN is the
 * billing relationship — a Team org, an Enterprise org, or a personal
 * subscription. The TIER is the seat's own rate-limit entitlement, which on a
 * Team org is set per member: `organizationType: 'claude_team'` with
 * `userRateLimitTier: 'default_claude_max_5x'` is one person on Max 5x inside
 * a Team, and showing only one half of that describes neither.
 *
 * Codex has no such split — ChatGPT plans are flat — so it just gets its plan
 * name capitalised.
 */
export function planLabel(
  plan: string | null,
  tier: string | null,
  tool: ToolId = 'claude',
): string | null {
  const p = (plan || '').toLowerCase();
  if (!p) return null;
  const title = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

  if (tool === 'codex') return title(p); // Free · Plus · Pro

  // the seat's entitlement: a tier always means one of the Max plans
  const seat = tier ? `Pro Max x${tier.replace(/x$/i, '')}` : p.includes('max') ? 'Pro Max' : 'Pro';
  if (p.includes('team')) return `Team - ${seat}`;
  if (p.includes('enterprise')) return `Enterprise - ${seat}`;
  // Only claim "Pro" for a plan that actually says so. Defaulting to it meant
  // a free — or merely unrecognised — Claude account advertised a paid
  // subscription it does not have.
  if (p.includes('pro') || p.includes('max')) return seat;
  return title(p);
}

/**
 * Why an account shows no monthly price — the three reasons are different and
 * the card used to call all of them "seat-priced plan".
 *
 * A free ChatGPT plan is not seat-priced, it is free; an account whose plan
 * was never detected is not seat-priced either, it is unknown. Saying
 * "seat-priced" to a free-tier user is simply false.
 */
export function noPriceReason(plan: string | null, organization?: string | null): string {
  const p = (plan || '').toLowerCase();
  if (!p) return 'no plan detected';
  if (p === 'free') return 'free plan';
  if (p.includes('team') || p.includes('business') || p.includes('enterprise')) {
    // Not "seat-priced plan", which reads as a contradiction under a chip
    // saying "Team - Pro Max x5". Say who is paying and why there is no
    // figure: the org negotiates its own per-seat rate, so there is no public
    // price to compare this account's spend against.
    return organization ? `billed per seat by ${organization}` : 'billed per seat by your org';
  }
  return `${p} plan · price unknown`;
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
