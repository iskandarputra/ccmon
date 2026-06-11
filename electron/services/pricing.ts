/**
 * @file pricing.ts
 * @brief Layered model-pricing engine: LiteLLM snapshots, models.dev, user overrides.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Layered pricing engine (ccusage parity). Resolves Claude model ids to
 * per-TOKEN USD rates; later layers are consulted only when earlier ones
 * miss:
 *
 *   1. bundled LiteLLM snapshot   data/litellm-claude.json
 *   2. runtime LiteLLM refresh    <cacheDir>/pricing-cache.json — fetched in
 *                                 the background with a 24 h TTL, never
 *                                 blocking and never throwing
 *   3. bundled models.dev         data/modelsdev-anthropic.json (per-MTok,
 *                                 divided by 1e6 on load)
 *   4. user overrides             ~/.config/ccmon/config.json "pricing"
 *                                 (case-insensitive regex → per-MTok
 *                                 {in, out, w5m, w1h, read}) — always win
 *
 * These are API list prices; for subscription (Pro/Max) accounts the result
 * reads as "API-equivalent cost". Pure Node — no Electron imports; the disk
 * cache directory is injected by the caller. The bundled snapshots are JSON
 * imports so the esbuild bundle is self-contained.
 */

import fs from 'fs';
import path from 'path';
import type {
  CostMode,
  LitellmEntry,
  ModelsDevEntry,
  PricingMeta,
  PricingOverride,
  PricingSource,
  RateRow,
  TokenCounts,
  UsageEntry,
} from '../../shared/types';
import bundledLitellmJson from './data/litellm-claude.json';
import bundledModelsDevJson from './data/modelsdev-anthropic.json';
import { localDateKey } from './parser';
import type { PricingArchive } from './pricing-archive';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const LITELLM_PREFIXES = ['claude-', 'anthropic.', 'anthropic/'];
/** Fields kept when compacting the raw LiteLLM catalog (snapshot + cache). */
const LITELLM_FIELDS = [
  'input_cost_per_token',
  'output_cost_per_token',
  'cache_creation_input_token_cost',
  'cache_read_input_token_cost',
  'input_cost_per_token_above_200k_tokens',
  'output_cost_per_token_above_200k_tokens',
  'cache_creation_input_token_cost_above_200k_tokens',
  'cache_read_input_token_cost_above_200k_tokens',
  'max_input_tokens',
  'provider_specific_entry',
] as const;

const CACHE_FILE = 'pricing-cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const TIER_THRESHOLD = 200_000; // in+read+w5m+w1h above this → above-200k rates
const CACHE_1H_MULTIPLIER = 2; // ccusage CACHE_CREATE_1H_INPUT_MULTIPLIER
const DEFAULT_FAST_MULTIPLIER = 2; // when provider_specific_entry.fast is absent
const DEFAULT_CONTEXT_LIMIT = 200_000;

type LitellmCatalog = Record<string, LitellmEntry>;
type ModelsDevCatalog = Record<string, ModelsDevEntry>;

interface PricingCacheFile {
  fetchedAt: number;
  models: LitellmCatalog;
}

export interface PricingEngineOptions {
  /** userData dir for the fetched-pricing disk cache */
  cacheDir?: string | null;
  /** never touch the network */
  offline?: boolean;
  /** ~/.config/ccmon/config.json "pricing" (regex → row) */
  overrides?: Record<string, PricingOverride>;
  /** date-stamped pricing layers — enables rates-of-the-day costing */
  archive?: PricingArchive | null;
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Filter a raw LiteLLM catalog down to Claude entries and the fields the
 * engine uses. Entries without any token pricing are dropped. Shared with
 * scripts/update-pricing-snapshots.ts so snapshot and runtime cache agree.
 */
export function compactLitellm(raw: Record<string, unknown> | null | undefined): LitellmCatalog {
  const out: LitellmCatalog = {};
  for (const [key, entry] of Object.entries(raw || {})) {
    if (!LITELLM_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (!entry || typeof entry !== 'object') continue;
    const src = entry as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const f of LITELLM_FIELDS) if (src[f] !== undefined) row[f] = src[f];
    const typed = row as LitellmEntry;
    if (typed.input_cost_per_token == null && typed.output_cost_per_token == null) continue;
    out[key] = typed;
  }
  return out;
}

/** Fetch + compact the live LiteLLM catalog (10 s timeout, throws on failure). */
async function fetchLitellm(): Promise<LitellmCatalog> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`litellm fetch: HTTP ${res.status}`);
    return compactLitellm((await res.json()) as Record<string, unknown>);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lookup key variants, tried in order: exact, trailing `-YYYYMMDD` date
 * suffix stripped, trailing `[...]` bracket suffix stripped (then both).
 */
function candidates(model: string): string[] {
  const out = [model];
  const push = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  push(model.replace(/-\d{8}$/, ''));
  const bare = model.replace(/\[[^\]]*\]$/, '');
  push(bare);
  push(bare.replace(/-\d{8}$/, ''));
  return out;
}

function normalizeLitellm(e: LitellmEntry, source: string): RateRow | null {
  if (e.input_cost_per_token == null && e.output_cost_per_token == null) return null;
  const input = e.input_cost_per_token || 0;
  const tierInput = e.input_cost_per_token_above_200k_tokens;
  const hasTier =
    tierInput != null ||
    e.output_cost_per_token_above_200k_tokens != null ||
    e.cache_creation_input_token_cost_above_200k_tokens != null ||
    e.cache_read_input_token_cost_above_200k_tokens != null;
  const ti = tierInput ?? input;
  return {
    source,
    input,
    output: e.output_cost_per_token || 0,
    cacheCreate: e.cache_creation_input_token_cost ?? input * 1.25,
    cacheRead: e.cache_read_input_token_cost ?? input * 0.1,
    cacheCreate1h: null,
    tiered: hasTier
      ? {
          input: ti,
          output: e.output_cost_per_token_above_200k_tokens ?? e.output_cost_per_token ?? 0,
          cacheCreate: e.cache_creation_input_token_cost_above_200k_tokens ?? ti * 1.25,
          cacheRead: e.cache_read_input_token_cost_above_200k_tokens ?? ti * 0.1,
        }
      : null,
    contextLimit: e.max_input_tokens ?? null,
    fast: e.provider_specific_entry?.fast || null,
    fastApplied: 1,
  };
}

/** models.dev entries carry per-MTok costs — divide by 1e6 on load. */
function normalizeModelsDev(e: ModelsDevEntry): RateRow | null {
  const c = e?.cost;
  if (!c) return null;
  const input = (c.input || 0) / 1e6;
  return {
    source: 'modelsdev',
    input,
    output: (c.output || 0) / 1e6,
    cacheCreate: c.cache_write != null ? c.cache_write / 1e6 : input * 1.25,
    cacheRead: c.cache_read != null ? c.cache_read / 1e6 : input * 0.1,
    cacheCreate1h: null,
    tiered: null,
    contextLimit: e.limit?.context || null,
    fast: null,
    fastApplied: 1,
  };
}

/** User override row (per-MTok like v1) → internal per-token row. */
function overrideRow(rate: PricingOverride): RateRow {
  const input = (rate.in || 0) / 1e6;
  return {
    source: 'override',
    input,
    output: (rate.out || 0) / 1e6,
    cacheCreate: rate.w5m != null ? rate.w5m / 1e6 : input * 1.25,
    cacheRead: rate.read != null ? rate.read / 1e6 : input * 0.1,
    cacheCreate1h: rate.w1h != null ? rate.w1h / 1e6 : null,
    tiered: null,
    contextLimit: null,
    fast: null,
    fastApplied: 1,
  };
}

/**
 * The cost formula against one resolved row: in×input + out×output +
 * read×cacheRead + w5m×cacheCreate + w1h×(input×2 | explicit override); the
 * whole entry moves to the above-200k rates when its context exceeds the
 * tier threshold.
 */
export function costWith(row: RateRow, t: TokenCounts): number {
  const inTok = t.in || 0;
  const outTok = t.out || 0;
  const read = t.read || 0;
  const w5m = t.w5m || 0;
  const w1h = t.w1h || 0;
  const r = row.tiered && inTok + read + w5m + w1h > TIER_THRESHOLD ? row.tiered : row;
  const w1hRate = row.cacheCreate1h ?? r.input * CACHE_1H_MULTIPLIER;
  return inTok * r.input + outTok * r.output + read * r.cacheRead + w5m * r.cacheCreate + w1h * w1hRate;
}

/** Scale every rate in a row for a `-fast` variant (limits unchanged). */
function applyFast(row: RateRow, mult: number): RateRow {
  return {
    ...row,
    input: row.input * mult,
    output: row.output * mult,
    cacheCreate: row.cacheCreate * mult,
    cacheRead: row.cacheRead * mult,
    cacheCreate1h: row.cacheCreate1h != null ? row.cacheCreate1h * mult : null,
    tiered: row.tiered && {
      input: row.tiered.input * mult,
      output: row.tiered.output * mult,
      cacheCreate: row.tiered.cacheCreate * mult,
      cacheRead: row.tiered.cacheRead * mult,
    },
    fastApplied: mult,
  };
}

export class PricingEngine {
  private readonly cacheDir: string | null;
  readonly offline: boolean;
  private readonly overrides: Array<{ re: RegExp; row: RateRow }> = [];
  private readonly bundled: LitellmCatalog;
  private readonly modelsdev: ModelsDevCatalog;
  private runtime: LitellmCatalog | null = null;
  private readonly archive: PricingArchive | null;
  private source: PricingSource = 'bundled';
  private fetchedAtMs: number | null = null;
  private readonly resolveMemo = new Map<string, RateRow | null>();
  private readonly dataMemo = new Map<string, RateRow | null>();
  /** layer index → model → resolved row (archive layers are append-only) */
  private readonly archiveMemo = new Map<number, Map<string, RateRow | null>>();
  private readonly unknownModels = new Set<string>();
  private inflight: Promise<void> | null = null;
  private refreshErrorMsg: string | null = null;

  constructor({ cacheDir = null, offline = false, overrides = {}, archive = null }: PricingEngineOptions = {}) {
    this.cacheDir = cacheDir;
    this.offline = !!offline;
    this.archive = archive;

    // Overrides compiled once; first match wins (insertion order, like v1).
    for (const [pattern, rate] of Object.entries(overrides || {})) {
      try {
        this.overrides.push({ re: new RegExp(pattern, 'i'), row: overrideRow(rate || {}) });
      } catch {
        // invalid user regex — skip the row rather than crash at startup
      }
    }

    this.bundled = bundledLitellmJson as LitellmCatalog;
    this.modelsdev = bundledModelsDevJson as ModelsDevCatalog;

    // Runtime LiteLLM layer from the disk cache, when present and sane.
    // A stale cache is still kept as a layer — better than nothing until
    // the background refresh lands.
    if (cacheDir) {
      const c = readJsonSafe<PricingCacheFile>(path.join(cacheDir, CACHE_FILE));
      if (c && typeof c.fetchedAt === 'number' && c.models && typeof c.models === 'object') {
        this.runtime = c.models;
        this.source = 'litellm-cache';
        this.fetchedAtMs = c.fetchedAt;
      }
    }
  }

  /** Resolved per-token rate row, or null when no layer knows the model. */
  rates(model: string): RateRow | null {
    const row = this.resolve(model);
    if (row) this.unknownModels.delete(model);
    else this.unknownModels.add(model);
    return row;
  }

  /**
   * USD for one entry's token counts, or null for unknown models.
   * Formula: in×input + out×output + read×cacheRead + w5m×cacheCreate +
   * w1h×(input×2). When in+read+w5m+w1h > 200k and the model has
   * above-200k rates, the whole entry is priced at those rates.
   */
  cost(model: string, t: TokenCounts): number | null {
    const row = this.rates(model);
    if (!row) return null;
    return costWith(row, t);
  }

  /**
   * Like cost(), but at the rates of the entry's day when the pricing
   * archive has a layer covering it. Overrides still win (they're
   * timeless); models missing from the dated layer fall back to the normal
   * current-rates resolution, as do dates before the first layer.
   */
  costAt(model: string, t: TokenCounts, dateKey: string): number | null {
    const layer = this.archive?.layerFor(dateKey);
    if (!layer) return this.cost(model, t);
    const row = this.resolveInLayer(model, layer.idx, layer.models) ?? this.rates(model);
    if (!row) return null;
    return costWith(row, t);
  }

  /**
   * max_input_tokens (LiteLLM) / limit.context (models.dev) for the model,
   * or 200000. Resolved against data layers only — overrides carry no
   * limits — with the `-fast` suffix ignored.
   */
  contextLimit(model: string): number {
    const base = model.endsWith('-fast') ? model.slice(0, -5) : model;
    const row = this.lookupData(base);
    return row?.contextLimit || DEFAULT_CONTEXT_LIMIT;
  }

  /** Models that resolved to null since creation (self-healing on refresh). */
  unknown(): string[] {
    return [...this.unknownModels];
  }

  /**
   * { source: 'litellm-live'|'litellm-cache'|'bundled', fetchedAt: ms|null,
   *   modelCount, lastError } — source describes the freshest LiteLLM layer
   * in use; modelCount is the distinct keys across all data layers;
   * lastError is the verbose reason the most recent refresh failed (null
   * after a success).
   */
  meta(): PricingMeta {
    const keys = new Set([
      ...Object.keys(this.bundled),
      ...(this.runtime ? Object.keys(this.runtime) : []),
      ...Object.keys(this.modelsdev),
    ]);
    return {
      source: this.source,
      fetchedAt: this.fetchedAtMs,
      modelCount: keys.size,
      lastError: this.refreshErrorMsg,
    };
  }

  /**
   * Force a LiteLLM refetch (ignores `offline`). Always resolves with
   * meta() — on failure the previous layer stays active and the verbose
   * reason lands in meta().lastError. Concurrent calls share one in-flight
   * fetch.
   */
  refresh(): Promise<PricingMeta> {
    if (!this.inflight) {
      this.inflight = fetchLitellm()
        .then((models) => {
          this.applyFetched(models);
          this.refreshErrorMsg = null;
        })
        .catch((err) => {
          const e = err as Error;
          this.refreshErrorMsg =
            e.name === 'AbortError'
              ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s fetching the LiteLLM catalog`
              : `${e.name}: ${e.message || 'fetch failed'}`;
          console.warn('[ccmon] pricing refresh failed:', this.refreshErrorMsg);
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight.then(() => this.meta());
  }

  private applyFetched(models: LitellmCatalog): void {
    this.runtime = models;
    this.source = 'litellm-live';
    this.fetchedAtMs = Date.now();
    this.resolveMemo.clear();
    this.dataMemo.clear();
    // today's layer may have been replaced by the fresh table — drop memos
    if (this.archive?.record(localDateKey(this.fetchedAtMs), models)) this.archiveMemo.clear();
    if (!this.cacheDir) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.cacheDir, CACHE_FILE),
        JSON.stringify({ fetchedAt: this.fetchedAtMs, models }),
      );
    } catch {
      // disk cache is best-effort; the in-memory layer is already updated
    }
  }

  /** Full resolution: overrides → `-fast` base × multiplier → data layers. */
  private resolve(model: string): RateRow | null {
    const memo = this.resolveMemo.get(model);
    if (memo !== undefined) return memo;
    let row: RateRow | null = null;
    for (const o of this.overrides) {
      if (o.re.test(model)) {
        row = o.row;
        break;
      }
    }
    if (!row) {
      if (model.endsWith('-fast')) {
        const base = this.resolve(model.slice(0, -5));
        row = base ? applyFast(base, base.fast || DEFAULT_FAST_MULTIPLIER) : null;
      } else {
        row = this.lookupData(model);
      }
    }
    this.resolveMemo.set(model, row);
    return row;
  }

  /**
   * Resolution against one dated archive layer: overrides → `-fast` base ×
   * multiplier → the layer's catalog only. Returns null on a layer miss so
   * costAt can fall back to the normal current-rates path.
   */
  private resolveInLayer(model: string, layerIdx: number, models: LitellmCatalog): RateRow | null {
    let memo = this.archiveMemo.get(layerIdx);
    if (!memo) this.archiveMemo.set(layerIdx, (memo = new Map()));
    const hit = memo.get(model);
    if (hit !== undefined) return hit;
    let row: RateRow | null = null;
    for (const o of this.overrides) {
      if (o.re.test(model)) {
        row = o.row;
        break;
      }
    }
    if (!row) {
      if (model.endsWith('-fast')) {
        const base = this.resolveInLayer(model.slice(0, -5), layerIdx, models);
        row = base ? applyFast(base, base.fast || DEFAULT_FAST_MULTIPLIER) : null;
      } else {
        for (const key of candidates(model)) {
          if (!Object.prototype.hasOwnProperty.call(models, key)) continue;
          row = normalizeLitellm(models[key], `archive:${layerIdx}`);
          if (row) break;
        }
      }
    }
    memo.set(model, row);
    return row;
  }

  /** Data layers in order, all key candidates per layer before moving on. */
  private lookupData(model: string): RateRow | null {
    const memo = this.dataMemo.get(model);
    if (memo !== undefined) return memo;
    const layers: Array<{ models: LitellmCatalog | ModelsDevCatalog | null; litellm: boolean; source: string }> = [
      { models: this.bundled, litellm: true, source: 'litellm-bundled' },
      { models: this.runtime, litellm: true, source: this.source },
      { models: this.modelsdev, litellm: false, source: 'modelsdev' },
    ];
    let row: RateRow | null = null;
    for (const layer of layers) {
      if (!layer.models) continue;
      for (const key of candidates(model)) {
        if (!Object.prototype.hasOwnProperty.call(layer.models, key)) continue;
        row = layer.litellm
          ? normalizeLitellm((layer.models as LitellmCatalog)[key], layer.source)
          : normalizeModelsDev((layer.models as ModelsDevCatalog)[key]);
        if (row) break;
      }
      if (row) break;
    }
    this.dataMemo.set(model, row);
    return row;
  }
}

/**
 * Build the engine. Resolves immediately from bundled + cached data; when
 * the disk cache is missing or older than 24 h (and not offline) a
 * background refresh is kicked off — it never blocks and never throws.
 */
export async function createPricingEngine(opts: PricingEngineOptions = {}): Promise<PricingEngine> {
  const engine = new PricingEngine(opts);
  const fetchedAt = engine.meta().fetchedAt;
  const stale = fetchedAt == null || Date.now() - fetchedAt >= CACHE_TTL_MS;
  if (!engine.offline && stale) void engine.refresh(); // fire-and-forget; never rejects
  return engine;
}

/**
 * Per-entry cost under the costMode setting:
 *   'display'   → the cost recorded on the line, else 0
 *   'calculate' → always computed from token counts, else 0
 *   'auto'      → recorded cost, else computed, else 0
 * Computed costs use the rates of the entry's day when the pricing archive
 * covers it (engine.costAt) — identical to cost() until layers exist.
 */
export function costForMode(entry: UsageEntry, mode: CostMode, engine: PricingEngine): number {
  if (mode === 'display') return entry.costUSD ?? 0;
  if (mode === 'calculate') return engine.costAt(entry.model, entry, entry.dateKey) ?? 0;
  return entry.costUSD ?? engine.costAt(entry.model, entry, entry.dateKey) ?? 0;
}
