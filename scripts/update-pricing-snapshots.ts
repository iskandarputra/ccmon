/**
 * @file update-pricing-snapshots.ts
 * @brief Refreshes the committed LiteLLM and models.dev pricing snapshots.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Refetches the LiteLLM and models.dev pricing catalogs and rewrites the
 * bundled snapshots used by electron/services/pricing.ts:
 *
 *   electron/services/data/litellm-claude.json      claude-/anthropic.
 *     prefixed keys, compacted to the 10 fields the engine reads
 *   electron/services/data/modelsdev-anthropic.json anthropic provider →
 *     { <model>: { cost, limit } } (per-MTok, divided by 1e6 at load time)
 *
 * Usage: npm run pricing:update
 */

import fs from 'fs';
import path from 'path';
import { compactLitellm } from '../electron/services/pricing';
import type { ModelsDevEntry } from '../shared/types';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const MODELSDEV_URL = 'https://models.dev/api.json';
const DATA_DIR = path.join(__dirname, '..', 'electron', 'services', 'data');
const FETCH_TIMEOUT_MS = 30_000;

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface ModelsDevApi {
  anthropic?: {
    models?: Record<
      string,
      { cost?: Record<string, number>; limit?: Record<string, number> }
    >;
  };
}

/** models.dev api → anthropic models compacted to { cost, limit }. */
export function compactModelsDev(api: ModelsDevApi): Record<string, ModelsDevEntry> {
  const models = api?.anthropic?.models || {};
  const out: Record<string, ModelsDevEntry> = {};
  for (const [key, m] of Object.entries(models)) {
    if (!m || !m.cost) continue;
    const cost: Record<string, number> = {};
    for (const f of ['input', 'output', 'cache_read', 'cache_write'] as const) {
      if (m.cost[f] !== undefined) cost[f] = m.cost[f];
    }
    const limit: Record<string, number> = {};
    if (m.limit) {
      for (const f of ['context', 'output'] as const) {
        if (m.limit[f] !== undefined) limit[f] = m.limit[f];
      }
    }
    out[key] = { cost, limit };
  }
  return out;
}

/** Recursively sort object keys so snapshots diff cleanly between runs. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const src = value as Record<string, unknown>;
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out;
  }
  return value;
}

/** Pretty-printed, key-sorted JSON — same style as the committed files. */
function writeSnapshot(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(sortKeysDeep(data), null, 1));
}

async function main(): Promise<void> {
  const [litellmRaw, modelsdevRaw] = await Promise.all([
    fetchJson(LITELLM_URL),
    fetchJson(MODELSDEV_URL),
  ]);

  const litellm = compactLitellm(litellmRaw as Record<string, unknown>);
  const modelsdev = compactModelsDev(modelsdevRaw as ModelsDevApi);
  if (!Object.keys(litellm).length) throw new Error('LiteLLM compaction yielded 0 models — not writing');
  if (!Object.keys(modelsdev).length) throw new Error('models.dev compaction yielded 0 models — not writing');

  writeSnapshot(path.join(DATA_DIR, 'litellm-claude.json'), litellm);
  writeSnapshot(path.join(DATA_DIR, 'modelsdev-anthropic.json'), modelsdev);
  console.log(`litellm-claude.json       ${Object.keys(litellm).length} models`);
  console.log(`modelsdev-anthropic.json  ${Object.keys(modelsdev).length} models`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`update-pricing-snapshots failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
