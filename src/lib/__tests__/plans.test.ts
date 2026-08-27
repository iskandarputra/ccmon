/**
 * @file plans.test.ts
 * @brief Unit tests for plan → subscription price, across both tools' vocabularies.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { planPriceUSD } from '../plans';

describe('planPriceUSD — Claude', () => {
  it('prices pro and both max tiers', () => {
    expect(planPriceUSD('pro', null)).toBe(20);
    expect(planPriceUSD('max', '5x')).toBe(100);
    expect(planPriceUSD('max', '20x')).toBe(200);
  });

  it('assumes 5x for max with an unknown tier', () => {
    expect(planPriceUSD('max', null)).toBe(100);
  });

  it('returns null for seat-priced plans, which have nothing to compare', () => {
    expect(planPriceUSD('team', null)).toBeNull();
    expect(planPriceUSD('enterprise', null)).toBeNull();
    expect(planPriceUSD(null, null)).toBeNull();
  });
});

describe('planPriceUSD — Codex', () => {
  /**
   * The collision this exists to prevent. Both vocabularies use the word
   * "pro" and mean an order of magnitude apart: Claude Pro is $20/mo,
   * ChatGPT Pro is $200/mo. Pricing a Codex plan against the Anthropic table
   * under-reported a ChatGPT Pro subscription tenfold, and gave ChatGPT Plus
   * no price at all because "plus" matches nothing there.
   */
  it("prices ChatGPT Pro at $200, NOT Claude Pro's $20", () => {
    expect(planPriceUSD('pro', null, 'codex')).toBe(200);
    expect(planPriceUSD('pro', null, 'claude')).toBe(20);
  });

  it('prices ChatGPT Plus, which the Anthropic table does not know at all', () => {
    expect(planPriceUSD('plus', null, 'codex')).toBe(20);
    expect(planPriceUSD('plus', null, 'claude')).toBeNull();
  });

  it('gives a free plan no subscription price', () => {
    expect(planPriceUSD('free', null, 'codex')).toBeNull();
  });

  it('returns null for seat-priced ChatGPT plans', () => {
    expect(planPriceUSD('business', null, 'codex')).toBeNull();
    expect(planPriceUSD('enterprise', null, 'codex')).toBeNull();
  });

  it('matches exactly, so a longer plan name cannot be read as "pro"', () => {
    // a substring test would price "enterprise" as Pro via… nothing today,
    // but the Anthropic branch DOES use includes(), and this branch must not
    expect(planPriceUSD('pro-legacy', null, 'codex')).toBeNull();
    expect(planPriceUSD('plus-trial', null, 'codex')).toBeNull();
  });

  it('ignores the tier, which Codex has no concept of', () => {
    expect(planPriceUSD('pro', '20x', 'codex')).toBe(200);
  });
});
