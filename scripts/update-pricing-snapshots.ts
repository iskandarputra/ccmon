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
 * Snapshots are MERGED, not replaced: entries the upstream no longer publishes
 * are retained (see mergeRetaining). Both catalogs prune retired models, and
 * dropping a retired model's price only un-prices transcripts a user chose to
 * keep. Pass `--prune` to overwrite instead, when a committed entry is wrong.
 *
 * Usage: npm run pricing:update [-- --prune]
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
  // NO OpenAI split here, deliberately. LiteLLM does not publish the
  // long-context tiers for the gpt-5.x models, and every LiteLLM layer is
  // consulted BEFORE models.dev — a LiteLLM OpenAI layer would therefore
  // resolve gpt-5.6-terra to its base rates and silently drop the 272K tier.
  // models.dev is the authoritative source for these; see MODELSDEV_SPLITS.
];

const MODELSDEV_SPLITS: Array<{ provider: string; file: string }> = [
  { provider: 'anthropic', file: 'modelsdev-anthropic.json' },
  { provider: 'deepseek', file: 'modelsdev-deepseek.json' },
  // Codex CLI. Without this the codex adapter counted tokens perfectly and
  // billed every one of them at $0 — the models were in no catalog ccmon
  // carried. models.dev is also the only upstream publishing their
  // long-context tiers (`cost.tiers[]`, `tier: {type: 'context', size: …}`).
  { provider: 'openai', file: 'modelsdev-openai.json' },
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

/** One above-threshold rate band as models.dev publishes it. */
interface ModelsDevTier {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tier?: { type?: string; size?: number };
}

interface ModelsDevApi {
  [provider: string]: {
    models?: Record<
      string,
      {
        cost?: Record<string, number> & { tiers?: ModelsDevTier[] };
        limit?: Record<string, number>;
      }
    >;
  };
}

/** models.dev api → provider models compacted to { cost, limit }. */
export function compactModelsDev(
  api: ModelsDevApi,
  provider: string,
): Record<string, ModelsDevEntry> {
  const models = api?.[provider]?.models || {};
  const out: Record<string, ModelsDevEntry> = {};
  for (const [key, m] of Object.entries(models)) {
    if (!m || !m.cost) continue;
    const cost: Record<string, number> = {};
    for (const f of ['input', 'output', 'cache_read', 'cache_write'] as const) {
      if (m.cost[f] !== undefined) cost[f] = m.cost[f];
    }
    // Carry the CONTEXT rate band through. Without it the OpenAI
    // long-context models would compact down to their base rates and a
    // 300K-token gpt-5.6 turn would bill at half price, silently.
    const band = m.cost.tiers?.find((t) => t?.tier?.type === 'context' && (t.tier.size ?? 0) > 0);
    const tiers = band
      ? [
          {
            ...(band.input !== undefined ? { input: band.input } : {}),
            ...(band.output !== undefined ? { output: band.output } : {}),
            ...(band.cache_read !== undefined ? { cache_read: band.cache_read } : {}),
            ...(band.cache_write !== undefined ? { cache_write: band.cache_write } : {}),
            tier: { type: 'context', size: band.tier!.size! },
          },
        ]
      : undefined;
    const limit: Record<string, number> = {};
    if (m.limit) {
      for (const f of ['context', 'output'] as const) {
        if (m.limit[f] !== undefined) limit[f] = m.limit[f];
      }
    }
    out[key] = { cost: tiers ? { ...cost, tiers } : cost, limit };
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

/** Parse an existing committed snapshot, or {} when absent/corrupt. */
function readSnapshot(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Merge a freshly fetched catalog over the committed one, RETAINING keys the
 * upstream no longer publishes.
 *
 * Both catalogs prune retired models: models.dev dropped the whole Claude 3.5
 * family, and LiteLLM never carried `claude-3-5-*` under the bare prefix. A
 * plain overwrite therefore un-prices transcripts that a user deliberately
 * kept (`cleanupPeriodDays` is theirs to raise), turning history into
 * `unknownModels`. A retired model's price is a frozen fact — dropping it only
 * ever loses information, and the pricing archive already handles the case
 * where a live model's rate changes. Fresh entries always win on conflict.
 *
 * `--prune` opts out, for when a committed entry is actively wrong.
 */
export function mergeRetaining<T>(
  existing: Record<string, T>,
  fresh: Record<string, T>,
  prune = false,
): { merged: Record<string, T>; retained: string[] } {
  if (prune) return { merged: fresh, retained: [] };
  const retained = Object.keys(existing).filter((k) => !(k in fresh));
  return { merged: { ...existing, ...fresh }, retained };
}

/** `n models (+r retained)`, listing the retained keys when there are few. */
function report(file: string, count: number, retained: string[]): void {
  let line = `${file.padEnd(28)} ${count} models`;
  if (retained.length) line += ` (+${retained.length} retained)`;
  console.log(line);
  if (retained.length && retained.length <= 15) {
    console.log(`${' '.repeat(30)}retained: ${retained.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const prune = process.argv.includes('--prune');
  if (prune) console.log('--prune: dropping entries the upstreams no longer publish\n');

  const [litellmRaw, modelsdevRaw] = await Promise.all([
    fetchJson(LITELLM_URL),
    fetchJson(MODELSDEV_URL),
  ]);

  // LiteLLM splits
  for (const split of LITELLM_SPLITS) {
    const file = path.join(DATA_DIR, split.file);
    const filtered = filterLitellm(litellmRaw as Record<string, unknown>, split.prefixes);
    const compacted = compactLitellm(filtered);
    if (!Object.keys(compacted).length) {
      console.warn(`WARNING: LiteLLM ${split.file} yielded 0 models — skipping (keeping existing)`);
      continue;
    }
    const { merged, retained } = mergeRetaining(readSnapshot(file), compacted, prune);
    writeSnapshot(file, merged);
    report(split.file, Object.keys(merged).length, retained);
  }

  // models.dev splits
  const api = modelsdevRaw as ModelsDevApi;
  for (const split of MODELSDEV_SPLITS) {
    const file = path.join(DATA_DIR, split.file);
    const compacted = compactModelsDev(api, split.provider);
    if (!Object.keys(compacted).length) {
      console.warn(
        `WARNING: models.dev ${split.file} yielded 0 models — skipping (keeping existing)`,
      );
      continue;
    }
    const { merged, retained } = mergeRetaining(readSnapshot(file), compacted, prune);
    writeSnapshot(file, merged);
    report(split.file, Object.keys(merged).length, retained);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`update-pricing-snapshots failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
