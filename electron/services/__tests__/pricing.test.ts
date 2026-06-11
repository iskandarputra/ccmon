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
    expect(archive.record('2026-03-05', { 'hist-model': { input_cost_per_token: 2e-6 } })).toBe(false);
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
