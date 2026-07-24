/**
 * @file update-pricing-snapshots.ts
 * @brief Refreshes the committed LiteLLM and models.dev pricing snapshots.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Refetches the LiteLLM and models.dev pricing catalogs and rewrites the
 * bundled snapshots used by electron/services/pricing.ts:
 *
 *   electron/services/data/litellm-claude.json        claude- / anthropic.
 *     prefixed keys, compacted to the 10 fields the engine reads
 *   electron/services/data/litellm-deepseek.json      deepseek/ / deepseek.
 *     prefixed keys, same compaction
 *   electron/services/data/modelsdev-anthropic.json    anthropic provider →
 *     { <model>: { cost, limit } } (per-MTok, divided by 1e6 at load time)
 *   electron/services/data/modelsdev-deepseek.json    deepseek provider →
 *     same format
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

const LITELLM_SPLITS: Array<{ prefixes: string[]; file: string }> = [
  { prefixes: ['claude-', 'anthropic.', 'anthropic/'], file: 'litellm-claude.json' },
  { prefixes: ['deepseek/', 'deepseek.'], file: 'litellm-deepseek.json' },
];

const MODELSDEV_SPLITS: Array<{ provider: string; file: string }> = [
  { provider: 'anthropic', file: 'modelsdev-anthropic.json' },
  { provider: 'deepseek', file: 'modelsdev-deepseek.json' },
];

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
  [provider: string]: {
    models?: Record<
      string,
      { cost?: Record<string, number>; limit?: Record<string, number> }
    >;
  };
}

/** models.dev api → provider models compacted to { cost, limit }. */
export function compactModelsDev(api: ModelsDevApi, provider: string): Record<string, ModelsDevEntry> {
  const models = api?.[provider]?.models || {};
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

/** Filter a LiteLLM catalog to only entries matching at least one prefix. */
function filterLitellm(
  catalog: Record<string, unknown>,
  prefixes: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(catalog)) {
    if (prefixes.some((p) => key.startsWith(p))) out[key] = entry;
  }
  return out;
}

async function main(): Promise<void> {
  const [litellmRaw, modelsdevRaw] = await Promise.all([
    fetchJson(LITELLM_URL),
    fetchJson(MODELSDEV_URL),
  ]);

  // LiteLLM splits
  for (const split of LITELLM_SPLITS) {
    const filtered = filterLitellm(litellmRaw as Record<string, unknown>, split.prefixes);
    const compacted = compactLitellm(filtered);
    if (!Object.keys(compacted).length) {
      console.warn(`WARNING: LiteLLM ${split.file} yielded 0 models — skipping (keeping existing)`);
      continue;
    }
    writeSnapshot(path.join(DATA_DIR, split.file), compacted);
    console.log(`${split.file.padEnd(28)} ${Object.keys(compacted).length} models`);
  }

  // models.dev splits
  const api = modelsdevRaw as ModelsDevApi;
  for (const split of MODELSDEV_SPLITS) {
    const compacted = compactModelsDev(api, split.provider);
    if (!Object.keys(compacted).length) {
      console.warn(`WARNING: models.dev ${split.file} yielded 0 models — skipping (keeping existing)`);
      continue;
    }
    writeSnapshot(path.join(DATA_DIR, split.file), compacted);
    console.log(`${split.file.padEnd(28)} ${Object.keys(compacted).length} models`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`update-pricing-snapshots failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
