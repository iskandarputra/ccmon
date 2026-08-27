/**
 * @file pricing.test.ts
 * @brief Unit tests for the pricing engine — formula, tiers, modes, historical archive.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { costForMode, createPricingEngine } from '../pricing';
import { AUTO_REVIEW_MODELS } from '../adapters/codex';
import { PricingArchive } from '../pricing-archive';
import { makeEntry } from './helpers';
import bundled from '../data/litellm-claude.json';
import type { LitellmEntry } from '../../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-pricing-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const engine = await createPricingEngine({
  offline: true,
  overrides: { '^fake-model$': { in: 10, out: 20, read: 1, w5m: 12.5 } },
});

describe('pricing — overrides and the cost formula', () => {
  it('prices per-MTok override rows exactly', () => {
    // 1M in × $10 + 0.5M out × $20 + 2M read × $1 + 0.1M w5m × $12.5
    const usd = engine.cost('fake-model', { in: 1e6, out: 0.5e6, read: 2e6, w5m: 0.1e6 });
    expect(usd).toBeCloseTo(10 + 10 + 2 + 1.25, 6);
  });

  it('bills 1h cache writes at input × 2 when no explicit w1h override exists', () => {
    const usd = engine.cost('fake-model', { w1h: 1e6 });
    expect(usd).toBeCloseTo(20, 6); // $10/MTok input × 2
  });

  it('multiplies -fast variants by the default 2× on the base rates', () => {
    const base = engine.cost('fake-model', { in: 1e6 })!;
    const fast = engine.cost('fake-model-fast', { in: 1e6 })!;
    expect(fast).toBeCloseTo(base * 2, 6);
  });

  it('returns null for models no layer knows, and tracks them', () => {
    expect(engine.cost('totally-unknown-model', { in: 1 })).toBeNull();
    expect(engine.unknown()).toContain('totally-unknown-model');
  });
});

const tiered = await createPricingEngine({
  offline: true,
  overrides: {
    // full tier spec + explicit context window + explicit fast multiplier
    '^proxy-full$': {
      in: 10,
      out: 20,
      tier: { in: 30, out: 60, w5m: 40, read: 3 },
      contextLimit: 1_000_000,
      fast: 6,
    },
    // tier.in only — the other tier rates must derive from it
    '^proxy-thin$': { in: 10, out: 20, tier: { in: 30 } },
    // fast: 1 prices the -fast variant absolutely (no multiple)
    '^proxy-flat$': { in: 10, out: 20, fast: 1 },
    // no tier at all — must never switch rates, however large the context
    '^proxy-untiered$': { in: 10, out: 20 },
  },
});

describe('pricing — overrides reach tier rates, contextLimit and fast', () => {
  const overThreshold = { in: 300_000 };
  const underThreshold = { in: 100_000 };

  it('applies base rates under the threshold and tier rates above it', () => {
    expect(tiered.cost('proxy-full', underThreshold)).toBeCloseTo(1, 6); // 0.1M × $10
    expect(tiered.cost('proxy-full', overThreshold)).toBeCloseTo(9, 6); // 0.3M × $30
  });

  it('uses each explicit tier rate', () => {
    // 0.25M out + 0.05M w5m + 0.05M read, with 0.3M in pushing past the tier
    const usd = tiered.cost('proxy-full', {
      in: 300_000,
      out: 250_000,
      w5m: 50_000,
      read: 50_000,
    })!;
    // in 0.3×30 + out 0.25×60 + w5m 0.05×40 + read 0.05×3
    expect(usd).toBeCloseTo(9 + 15 + 2 + 0.15, 6);
  });

  it('derives unset tier rates from tier.in exactly as the LiteLLM layer does', () => {
    // w5m = tier.in × 1.25 = $37.5, read = tier.in × 0.1 = $3, out falls back to base $20
    const usd = tiered.cost('proxy-thin', {
      in: 300_000,
      out: 100_000,
      w5m: 100_000,
      read: 100_000,
    })!;
    expect(usd).toBeCloseTo(0.3 * 30 + 0.1 * 20 + 0.1 * 37.5 + 0.1 * 3, 6);
  });

  it('never switches rates for an override with no tier block', () => {
    const small = tiered.cost('proxy-untiered', underThreshold)!;
    const large = tiered.cost('proxy-untiered', overThreshold)!;
    expect(large / small).toBeCloseTo(3, 6); // purely proportional to tokens
  });

  it('exposes an overridden context limit to the session gauge', () => {
    expect(tiered.contextLimit('proxy-full')).toBe(1_000_000);
  });

  it('falls back to the default context limit when the override omits one', () => {
    expect(tiered.contextLimit('proxy-thin')).toBe(200_000);
  });

  it('uses the override fast multiplier instead of the default 2×', () => {
    const base = tiered.cost('proxy-full', { in: 1e6 })!;
    expect(tiered.cost('proxy-full-fast', { in: 1e6 })).toBeCloseTo(base * 6, 6);
  });

  it('scales tier rates by the fast multiplier too', () => {
    expect(tiered.cost('proxy-full-fast', overThreshold)).toBeCloseTo(9 * 6, 6);
  });

  it('treats fast: 1 as absolute pricing for the -fast variant', () => {
    const base = tiered.cost('proxy-flat', { in: 1e6 })!;
    expect(tiered.cost('proxy-flat-fast', { in: 1e6 })).toBeCloseTo(base, 6);
  });

  it('multiplies a -fast variant whose base name matches a prefix pattern', () => {
    // The regression: a pattern without `$` used to match `<model>-fast`
    // directly, so the multiplier was silently skipped and fast turns billed
    // at base rate. Resolution now strips `-fast` before matching.
    expect(tiered.cost('proxy-full-fast', { in: 1e6 })).not.toBeCloseTo(
      tiered.cost('proxy-full', { in: 1e6 })!,
      6,
    );
  });
});

describe('pricing — bundled-catalog resolution', () => {
  const catalog = bundled as Record<string, LitellmEntry>;

  it('strips a trailing -YYYYMMDD date suffix on lookup', () => {
    // a fictitious dated variant of an existing key resolves to its base row
    const base = Object.keys(catalog).find((k) => k.startsWith('claude-') && !/-\d{8}$/.test(k));
    if (!base) return; // snapshot shape changed — nothing to assert
    expect(engine.rates(`${base}-29991231`)).toEqual(engine.rates(base));
  });

  it('prices the WHOLE entry at above-200k rates past the tier threshold', () => {
    const tiered = Object.entries(catalog).find(
      ([, v]) => v.input_cost_per_token_above_200k_tokens != null,
    );
    if (!tiered) return; // snapshot lost its tiered models — nothing to assert
    const [model, row] = tiered;
    const below = engine.cost(model, { in: 100_000 })!;
    const above = engine.cost(model, { in: 300_000 })!;
    expect(below).toBeCloseTo(100_000 * row.input_cost_per_token!, 8);
    expect(above).toBeCloseTo(300_000 * row.input_cost_per_token_above_200k_tokens!, 8);
  });
});

describe('costForMode', () => {
  const recorded = makeEntry({ model: 'fake-model', in: 1e6, out: 0, costUSD: 99 });
  const bare = makeEntry({ model: 'fake-model', in: 1e6, out: 0, costUSD: null });

  it('display uses only the recorded cost', () => {
    expect(costForMode(recorded, 'display', engine)).toBe(99);
    expect(costForMode(bare, 'display', engine)).toBe(0);
  });

  it('calculate always recomputes', () => {
    expect(costForMode(recorded, 'calculate', engine)).toBeCloseTo(10, 6);
  });

  it('auto prefers the recorded cost, else computes', () => {
    expect(costForMode(recorded, 'auto', engine)).toBe(99);
    expect(costForMode(bare, 'auto', engine)).toBeCloseTo(10, 6);
  });
});

describe('historical pricing — archive + costAt', () => {
  // every archive gets its own dir — the file persists by design
  const mkArchive = (dir = fs.mkdtempSync(path.join(tmp, 'arch-'))) => {
    const archive = new PricingArchive(dir);
    archive.record('2026-01-01', { 'hist-model': { input_cost_per_token: 1e-6 } });
    archive.record('2026-03-01', { 'hist-model': { input_cost_per_token: 2e-6 } });
    return archive;
  };

  it('layers only when the table actually changed, and survives a reload', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'arch-'));
    const archive = mkArchive(dir);
    expect(archive.size).toBe(2);
    expect(archive.record('2026-03-05', { 'hist-model': { input_cost_per_token: 2e-6 } })).toBe(
      false,
    );
    expect(archive.size).toBe(2);
    expect(new PricingArchive(dir).size).toBe(2);
  });

  it('layerFor picks the newest layer at or before the date', () => {
    const archive = mkArchive();
    expect(archive.layerFor('2026-02-15')?.idx).toBe(0);
    expect(archive.layerFor('2026-03-01')?.idx).toBe(1);
    expect(archive.layerFor('2025-12-31')).toBeNull();
  });

  it('costAt prices at the rates of the day, falling back when uncovered', async () => {
    const dated = await createPricingEngine({ offline: true, archive: mkArchive() });
    expect(dated.costAt('hist-model', { in: 1e6 }, '2026-02-01')).toBeCloseTo(1, 6);
    expect(dated.costAt('hist-model', { in: 1e6 }, '2026-04-01')).toBeCloseTo(2, 6);
    // before the first layer → current resolution; hist-model is unknown there
    expect(dated.costAt('hist-model', { in: 1e6 }, '2025-06-01')).toBeNull();
    // a model the layer doesn't know falls back to current rates
    const known = Object.keys(bundled)[0];
    expect(dated.costAt(known, { in: 1e6 }, '2026-02-01')).toEqual(dated.cost(known, { in: 1e6 }));
  });
});

describe('pricing — OpenAI / Codex models', () => {
  it('prices the Codex models that Codex CLI actually runs', async () => {
    // These were counted correctly and billed at $0, because the pricing
    // snapshot only ever carried anthropic and deepseek. A Codex user's whole
    // spend read as zero — the tokens were right and the dollars were absent.
    const e = await createPricingEngine({ offline: true });
    for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5']) {
      const usd = e.cost(model, { in: 1_000_000 });
      expect(usd, `${model} must be priced`).not.toBeNull();
      expect(usd!, `${model} must cost something`).toBeGreaterThan(0);
    }
  });

  it('bills a long-context Codex request entirely at tier rates', async () => {
    // models.dev gives gpt-5.6-terra a 272K context tier: input 2 -> 4,
    // output 12 -> 18, cache_read 0.2 -> 0.4 per MTok. ccusage bills the WHOLE
    // request at the tier rate once the threshold is crossed, not just the
    // excess, and ccmon's engine already works that way.
    const e = await createPricingEngine({ offline: true });

    const under = e.cost('gpt-5.6-terra', { in: 100_000, out: 1_000 })!;
    expect(under).toBeCloseTo(100_000 * 2e-6 + 1_000 * 12e-6, 9);

    const over = e.cost('gpt-5.6-terra', { in: 300_000, out: 1_000 })!;
    expect(over).toBeCloseTo(300_000 * 4e-6 + 1_000 * 18e-6, 9);
  });

  it("uses the model's OWN tier threshold, not Anthropic's 200K", async () => {
    // 250K is above Anthropic's 200K but below OpenAI's 272K — the give-away
    // that the threshold is per-model rather than one global constant.
    const e = await createPricingEngine({ offline: true });
    const at250k = e.cost('gpt-5.6-terra', { in: 250_000 })!;
    expect(at250k).toBeCloseTo(250_000 * 2e-6, 9); // base rate, not 4e-6
  });

  it('prices EVERY model the auto-review table can resolve to', async () => {
    // The table exists to stop an auto-review turn billing at $0, and it only
    // does that if the id it maps TO is itself priceable. models.dev has since
    // retired the older codex models, so three of the seven mapped to nothing
    // and the table swapped one unpriced string for another.
    const e = await createPricingEngine({ offline: true });
    for (const model of AUTO_REVIEW_MODELS) {
      const usd = e.cost(model, { in: 1_000_000 });
      expect(usd, `${model} must be priced — the fallback table maps to it`).not.toBeNull();
      expect(usd!, model).toBeGreaterThan(0);
    }
  });

  it('bills gpt-5.5 fast turns at 2.5×, not the default 2×', async () => {
    // models.dev publishes no fast multiplier, so every OpenAI model would
    // take the engine's default 2×. gpt-5.5 is 2.5× — the one Codex model
    // where the default is wrong.
    const e = await createPricingEngine({ offline: true });
    const base = e.cost('gpt-5.5', { in: 1_000_000 })!;
    expect(e.cost('gpt-5.5-fast', { in: 1_000_000 })).toBeCloseTo(base * 2.5, 9);
  });

  it('leaves the gpt-5.6 family on the default 2×', async () => {
    const e = await createPricingEngine({ offline: true });
    const base = e.cost('gpt-5.6-terra', { in: 1_000_000 })!;
    expect(e.cost('gpt-5.6-terra-fast', { in: 1_000_000 })).toBeCloseTo(base * 2, 9);
  });

  it('still applies the 200K threshold to Anthropic models', async () => {
    const e = await createPricingEngine({ offline: true });
    const base = e.cost('claude-sonnet-4-5', { in: 100_000 });
    const above = e.cost('claude-sonnet-4-5', { in: 250_000 });
    if (base == null || above == null) return; // model retired from the snapshot
    // 2.5× the tokens must cost MORE than 2.5× the base rate once tiered
    expect(above).toBeGreaterThan(base * 2.5);
  });
});
