/**
 * @file types.ts
 * @brief Shared data contracts (docs/v2-spec.md) imported by both main and renderer.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Shared data contracts (docs/v2-spec.md). Single source of truth for both
 * the Electron main process (electron/) and the renderer (src/) — keep this
 * file dependency-free so either side can import it.
 */

// ---- entries (parser output, §1) -----------------------------------------

export interface UsageEntry {
  /** `${message.id}:${requestId}` | `m:${id}` | `f:${file}#${line}` */
  key: string;
  /** message.id or null (for sidechain-aware dedupe) */
  msgId: string | null;
  /** epoch ms */
  ts: number;
  /** 'YYYY-MM-DD' local time */
  dateKey: string;
  /** model id; '-fast' suffix appended when usage.speed === 'fast' */
  model: string;
  fast: boolean;
  project: string;
  sessionId: string;
  sidechain: boolean;
  in: number;
  out: number;
  /** cache_read_input_tokens */
  read: number;
  /** 5-minute-tier cache writes */
  w5m: number;
  /** 1-hour-tier cache writes */
  w1h: number;
  /** cost recorded on the line, or null — dollars resolve at aggregate time */
  costUSD: number | null;
  /** tool_use block names in order (may repeat); omitted when none */
  tools?: string[];
  /** message.stop_reason ('tool_use' | 'end_turn' | 'max_tokens' | …) or null */
  stop?: string | null;
  /** owning data root (source scoping), stamped by the watcher */
  source?: string | null;
}

export interface ResetMarker {
  kind: 'reset';
  ts: number | null;
  /** when the usage limit lifts (epoch ms) */
  resetTs: number;
}

/** A context-compaction event (isCompactSummary line). */
export interface CompactMarker {
  kind: 'compact';
  ts: number;
  sessionId: string;
  /** owning data root, stamped by the watcher (scope filtering) */
  source?: string | null;
}

export type ParsedLine = ({ kind: 'entry' } & UsageEntry) | ResetMarker | CompactMarker | null;

/** Token splits accepted by the pricing engine's cost(). */
export interface TokenCounts {
  in?: number;
  out?: number;
  read?: number;
  w5m?: number;
  w1h?: number;
}

// ---- pricing (§2) ----------------------------------------------------------

export type CostMode = 'auto' | 'calculate' | 'display';

export type PricingSource = 'litellm-live' | 'litellm-cache' | 'bundled';

export interface PricingMeta {
  source: PricingSource;
  fetchedAt: number | null;
  modelCount: number;
  /** verbose reason the most recent refresh attempt failed, or null */
  lastError?: string | null;
}

export interface TieredRates {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/** Internal rate row, USD per TOKEN (fast multiplier already applied). */
export interface RateRow {
  source: string;
  input: number;
  output: number;
  /** 5m cache write rate */
  cacheCreate: number;
  cacheRead: number;
  /** explicit 1h write override only — otherwise 1h bills at input × 2 */
  cacheCreate1h: number | null;
  tiered: TieredRates | null;
  contextLimit: number | null;
  /** fast multiplier available for -fast variants */
  fast: number | null;
  fastApplied: number;
}

/** Compacted LiteLLM catalog entry (bundled snapshot + runtime cache). */
export interface LitellmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;
  max_input_tokens?: number;
  provider_specific_entry?: { fast?: number };
}

/** Compacted models.dev entry (per-MTok costs, divided by 1e6 on load). */
export interface ModelsDevEntry {
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  limit?: { context?: number; output?: number };
}

/** User override row, per-MTok like v1 (~/.config/ccmon/config.json). */
export interface PricingOverride {
  in?: number;
  out?: number;
  w5m?: number;
  w1h?: number;
  read?: number;
}

// ---- settings (§5) ---------------------------------------------------------

export type StartOfWeek = 'sunday' | 'monday';
export type TokenLimitSetting = 'max' | number | null;

export interface AppSettings {
  theme: string;
  costMode: CostMode;
  pricingOffline: boolean;
  startOfWeek: StartOfWeek;
  tokenLimit: TokenLimitSetting;
  compactNumbers: boolean;
  /** display currency, ISO code — costs stay USD internally (§5) */
  currency: string;
  /** null (primary account) | array of project dirs (multi-account scoping) */
  sources: string[] | null;
}

// ---- currency (§5) ----------------------------------------------------------

/** Top-10 crypto display currencies: code → CoinGecko id. */
export const CRYPTO_CURRENCIES: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  XRP: 'ripple',
  BNB: 'binancecoin',
  SOL: 'solana',
  USDC: 'usd-coin',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  TRX: 'tron',
};

/** Hourly-fetched USD exchange rates for display conversion. */
export interface CurrencyRates {
  base: 'USD';
  /** when the rates were fetched, null when none have ever loaded */
  fetchedAt: number | null;
  source: 'live' | 'cache' | 'none';
  /** ISO code → units per USD */
  rates: Record<string, number>;
  /** verbose reason the most recent refresh failed, or null */
  lastError?: string | null;
}

/** Hand-edited power-user config at ~/.config/ccmon/config.json. */
export interface UserConfig {
  claudeDirs?: string[];
  pricing?: Record<string, PricingOverride>;
}

// ---- blocks (§3) -----------------------------------------------------------

export type BurnLevel = 'normal' | 'moderate' | 'high';

export interface BurnRate {
  /** includes cache traffic — drives limit projections */
  tokensPerMin: number;
  /** in+out only — drives the activity gauge */
  tokensPerMinIndicator: number;
  costPerHour: number;
  level: BurnLevel;
}

export interface BlockProjection {
  totalTokens: number;
  totalCost: number;
  remainingMinutes: number;
}

export type LimitStatus = 'ok' | 'warning' | 'exceeds';

export interface BlockLimit {
  value: number;
  source: 'max' | 'custom';
  currentPct: number;
  projectedPct: number;
  status: LimitStatus;
}

export interface BlockRow {
  id: string;
  start: number;
  end: number;
  actualEnd: number | null;
  isActive: boolean;
  isGap: boolean;
  entries: number;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  totalTokens: number;
  models: string[];
  burn: BurnRate | null;
}

export interface ActiveBlock {
  start: number;
  end: number;
  entries: number;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  totalTokens: number;
  models: string[];
  firstTs: number;
  lastTs: number;
  remainingMs: number;
  burn: BurnRate | null;
  projection: BlockProjection | null;
  limit: BlockLimit | null;
  /** from transcript reset markers when in the future */
  usageLimitResetTs?: number | null;
}

// ---- snapshot v2 (§4) -------------------------------------------------------

export interface SumRow {
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  entries: number;
}

export interface ModelDayRow extends SumRow {
  model: string;
}

export interface DayRow {
  date: string;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  /** in + out */
  tokens: number;
  /** in + out + read + write */
  allTokens: number;
  entries: number;
  sessions: number;
  /** sorted cost desc — powers stacked-by-model charts */
  models: ModelDayRow[];
}

export interface TodayRow extends DayRow {
  vsYesterdayPct: number | null;
}

export interface WeeklyRow {
  /** 'YYYY-MM-DD' bucket start, per settings.startOfWeek */
  week: string;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  tokens: number;
  entries: number;
  days: number;
}

export interface MonthlyRow {
  /** 'YYYY-MM' */
  month: string;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  tokens: number;
  entries: number;
  days: number;
}

export interface ModelRow extends SumRow {
  model: string;
  sessions: number;
  firstTs: number;
  lastTs: number;
}

export interface ProjectRow {
  path: string;
  cost: number;
  todayCost: number;
  weekCost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  tokens: number;
  entries: number;
  sessions: number;
  lastTs: number;
  /** est cost of this project's sidechain (subagent) entries */
  sidechainCost: number;
  daily: Array<{ date: string; cost: number }>;
}

export interface SessionContext {
  tokens: number;
  limit: number;
  pct: number;
}

export interface SessionRow {
  id: string;
  project: string;
  firstTs: number;
  lastTs: number;
  durationMs: number;
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  tokens: number;
  entries: number;
  models: string[];
  /** context compactions observed in this session */
  compactions: number;
  /** only for sessions active in the last 48h */
  context: SessionContext | null;
}

export interface FeedEvent {
  key: string;
  ts: number;
  model: string;
  project: string;
  sessionId: string;
  sidechain: boolean;
  in: number;
  out: number;
  read: number;
  write: number;
  /** context-window footprint of this turn (in + read + w5m + w1h) */
  ctx: number;
  cost: number;
}

/** Cache writes re-paid because a session idled past the cache TTL (§4). */
export interface CacheIdleStats {
  /** entries that re-wrote cache after an idle gap past the TTL */
  events: number;
  /** cache-write tokens re-paid by those entries */
  tokens: number;
  /** marginal cost vs returning before expiry: Σ tokens × (write − read) */
  extraUSD: number;
}

export interface CacheStats {
  readTokens: number;
  writeTokens: number;
  /** read / (read + in) */
  hitRate: number;
  /** Σ read × (input_rate − read_rate) */
  savedUSD: number;
  /** totals.cost + savedUSD */
  wouldHaveCostUSD: number;
  /** the cost of walking away — TTL-expired cache re-writes */
  idle: CacheIdleStats;
}

/** One tool's aggregate usage (§4). */
export interface ToolRow {
  name: string;
  /** total tool_use blocks */
  invocations: number;
  /** entries (turns) where the tool appears at least once */
  entries: number;
  /** est cost of those turns — overlapping when a turn uses several tools */
  cost: number;
}

export interface ToolStats {
  /** invocations desc, ≤20 */
  rows: ToolRow[];
  /** top ≤8 tools × the 35-day window (aligned to snapshot.days), invocations/day */
  daily: Array<{ name: string; days: number[] }>;
  /** entries with ≥1 tool_use */
  turns: number;
  invocations: number;
}

/** Spend attributed to sidechain (subagent/workflow) entries (§4). */
export interface SidechainStats {
  cost: number;
  entries: number;
}

/** Counterfactual: ALL recorded traffic re-priced onto one model (§4). */
export interface WhatIfRow {
  model: string;
  /** what everything would have cost on this model */
  totalCost: number;
  /** totalCost − totals.cost (negative = cheaper than the actual mix) */
  delta: number;
  /** per-day re-priced cost aligned to snapshot.days (35) */
  daily?: number[];
}

export interface UsageRecords {
  maxDay: { date: string; cost: number } | null;
  maxBlockTokens: number;
  longestSession: { id: string; project: string; durationMs: number } | null;
  activeDays: number;
  /** span first → last */
  totalDays: number;
  /** consecutive active days */
  streak: { current: number; longest: number };
  /** over active days */
  avgDailyCost: number;
}

export interface SnapshotTotals {
  cost: number;
  in: number;
  out: number;
  read: number;
  write: number;
  tokens: number;
  allTokens: number;
  entries: number;
  sessions: number;
  firstTs: number | null;
  lastTs: number | null;
}

export interface Snapshot {
  generatedAt: number;
  version: string;
  sourceDirs: string[];
  entryCount: number;
  costMode: CostMode;
  unknownModels: string[];
  totals: SnapshotTotals;
  today: TodayRow;
  /** rolling last-7-days incl today */
  week: { cost: number; tokens: number };
  /** continuous, zero-filled, ascending — 35 days */
  days: DayRow[];
  weekly: WeeklyRow[];
  monthly: MonthlyRow[];
  /** 7×24 (in+out), Monday-first */
  hourly: number[][];
  /** 7×24 est cost, same orientation as hourly */
  hourlyCost: number[][];
  /** cost desc */
  models: ModelRow[];
  /** lastTs desc, ≤40 */
  projects: ProjectRow[];
  /** lastTs desc, ≤150 */
  sessions: SessionRow[];
  /** active block or null */
  block: ActiveBlock | null;
  /** last 30 days incl gaps, ascending */
  blocks: BlockRow[];
  /** all-time usage-block count (gaps excluded) */
  blockCount: number;
  /** "limit reached, resets at" marker even when no active block */
  usageLimitResetTs: number | null;
  cache: CacheStats;
  /** all traffic re-priced onto each top model, totalCost asc */
  whatIf: WhatIfRow[];
  /** spend on entries that survive dedupe with the sidechain flag */
  sidechain: SidechainStats;
  /** tool_use analytics from transcript content blocks */
  toolUse: ToolStats;
  /** stop_reason → entry count (max_tokens = truncations) */
  stopReasons: Record<string, number>;
  /** total context compactions across the scoped entries */
  compactions: number;
  records: UsageRecords;
  recentEvents: FeedEvent[];
}

// ---- accounts & live limits (§5) --------------------------------------------

export interface AccountInfo {
  plan: string | null;
  /** plan multiplier parsed from rateLimitTier, e.g. '5x' | '20x' */
  tier: string | null;
  email: string | null;
  organization: string | null;
  hasCredentials: boolean;
}

export interface LimitWindow {
  pct: number | null;
  resetsAt: number | null;
}

/** One persisted poll of the usage endpoint (utilization percentages). */
export interface LimitSample {
  ts: number;
  session: number | null;
  week: number | null;
  weekOpus?: number | null;
}

/** Linear fit over recent samples: when the window hits 100% at this pace. */
export interface WindowForecast {
  /** epoch ms when utilization reaches 100% (clamped to now), or null when flat */
  etaTs: number | null;
  pctPerHour: number;
}

export interface LimitsForecast {
  session: WindowForecast | null;
  week: WindowForecast | null;
}

/** Retrospective over the retained poll history: how often a window reset, and how often it was ~100% when it did. */
export interface WindowCaps {
  resets: number;
  capped: number;
}

export interface LimitsCaps {
  session: WindowCaps;
  week: WindowCaps;
}

/** Verbose failure detail for a live-limits fetch. */
export interface LimitsFailure {
  /** human-readable reason, e.g. 'rate limited by anthropic (HTTP 429 …)' */
  error: string;
  /** HTTP status when the failure was an HTTP response */
  status?: number | null;
  /** Retry-After from the response, normalized to ms */
  retryAfterMs?: number | null;
  /** when the failure happened (epoch ms) */
  at?: number;
  /** when the next automatic retry is scheduled (epoch ms) */
  nextRetryAt?: number | null;
}

export type LimitsResult =
  | {
      ok: true;
      fetchedAt: number;
      session: LimitWindow | null;
      week: LimitWindow | null;
      weekOpus: LimitWindow | null;
      weekSonnet?: LimitWindow | null;
      /** utilization-pct samples for sparklines (thinned, ascending) */
      history?: LimitSample[];
      /** linear time-to-cap forecast from recent samples */
      forecast?: LimitsForecast | null;
      /** reset/cap retrospective over the retained history (≤7d) */
      caps?: LimitsCaps | null;
      /** retained pre-failure data — still shown, just aging */
      stale?: boolean;
      /** most recent failure while serving stale data */
      lastError?: { error: string; at: number } | null;
      /** when the next automatic retry is scheduled (epoch ms) */
      nextRetryAt?: number | null;
    }
  | ({ ok: false } & LimitsFailure);

/** source dir → account identity */
export type AccountsMap = Record<string, AccountInfo>;
/** source dir → live plan-limit result */
export type LimitsMap = Record<string, LimitsResult>;
