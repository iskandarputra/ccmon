/**
 * @file plans.test.ts
 * @brief Unit tests for plan → subscription price, across both tools' vocabularies.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { noPriceReason, planLabel, planPriceUSD } from '../plans';

describe('planPriceUSD — Claude', () => {
  it('prices pro and both max tiers', () => {
    expect(planPriceUSD('pro', null)).toBe(20);
    expect(planPriceUSD('max', '5x')).toBe(100);
    expect(planPriceUSD('max', '20x')).toBe(200);
  });

  it('assumes 5x for max with an unknown tier', () => {
    expect(planPriceUSD('max', null)).toBe(100);
  });

  it('prices team plans and tier upgrades', () => {
    expect(planPriceUSD('team', null)).toBe(30);
    expect(planPriceUSD('team', '5x')).toBe(125);
    expect(planPriceUSD('team', '20x')).toBe(225);
  });

  it('returns null for enterprise and unknown plans', () => {
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

describe('noPriceReason — why a card shows no monthly price', () => {
  it('does not call a free plan seat-priced', () => {
    // the card said "seat-priced plan" to a ChatGPT free-tier user, which is
    // three kinds of wrong at once
    expect(noPriceReason('free')).toBe('free plan');
  });

  it('says WHO is paying for a seat-priced plan, not just that it is one', () => {
    // "seat-priced plan" under a chip reading "Team - Pro Max x5" looks like a
    // contradiction; naming the org explains why there is no figure.
    expect(noPriceReason('team', 'Pingspace')).toBe('billed per seat by Pingspace');
    expect(noPriceReason('enterprise', 'Acme')).toBe('billed per seat by Acme');
    expect(noPriceReason('business')).toBe('billed per seat by your org');
  });

  it('admits when no plan was detected at all', () => {
    expect(noPriceReason(null)).toBe('no plan detected');
    expect(noPriceReason('')).toBe('no plan detected');
  });

  it('names an unrecognised plan rather than mislabelling it', () => {
    expect(noPriceReason('edu')).toBe('edu plan · price unknown');
  });
});

describe('planLabel — the plan as a person would name it', () => {
  /**
   * "team · 5x" described neither half of what is actually going on: a Team
   * ORG is the billing relationship, and Max 5x is that one seat's rate-limit
   * entitlement, set per member.
   */
  it('names a Team seat with its own entitlement', () => {
    expect(planLabel('team', '5x')).toBe('Team - Pro Max x5');
    expect(planLabel('team', '20x')).toBe('Team - Pro Max x20');
    expect(planLabel('team', null)).toBe('Team - Pro');
  });

  it('names a personal subscription without an org prefix', () => {
    expect(planLabel('pro', null)).toBe('Pro');
    expect(planLabel('max', '5x')).toBe('Pro Max x5');
    expect(planLabel('max', '20x')).toBe('Pro Max x20');
    expect(planLabel('max', null)).toBe('Pro Max');
  });

  it('names an Enterprise seat the same way', () => {
    expect(planLabel('enterprise', '20x')).toBe('Enterprise - Pro Max x20');
  });

  it('keeps ChatGPT plans flat — they have no seat/org split', () => {
    expect(planLabel('free', null, 'codex')).toBe('Free');
    expect(planLabel('plus', null, 'codex')).toBe('Plus');
    expect(planLabel('pro', null, 'codex')).toBe('Pro');
  });

  it('says nothing when no plan was detected', () => {
    expect(planLabel(null, null)).toBeNull();
    expect(planLabel('', '5x')).toBeNull();
  });
});
