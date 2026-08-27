/**
 * @file types.ts
 * @brief Shared data contracts (docs/v2-spec.md) imported by both main and renderer.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Shared data contracts (docs/v2-spec.md). Single source of truth for both
 * the Electron main process (electron/) and the renderer (src/) — keep this
 * file dependency-free so either side can import it.
 */

/**
 * The coding CLIs ccmon reads. Declared HERE rather than in `shared/tools.ts`
 * so this file stays dependency-free: `tools.ts` imports the id from here, not
 * the other way round. The profile behind each id lives there.
 */
export type ToolId = 'claude' | 'codex';

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
  /**
   * Which coding CLI produced this usage — a {@link SourceAdapter} id, stamped
   * by the watcher from the owning root's adapter (e.g. 'claude').
   *
   * Optional only for construction convenience (test fixtures, and entries
   * built before the adapter seam existed); the watcher always sets it. Treat a
   * missing value as 'claude', the format ccmon was built around.
   */
  agent?: string;
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

/**
 * A tool_result returned on a user-side line — NON-billable (carries no usage),
 * kept ONLY to size the tool output that gets re-fed as context on later turns.
 * Deliberately separate from usage entries so token parity is never affected.
 */
export interface ToolResultMarker {
  kind: 'toolresult';
  ts: number;
  sessionId: string;
  /** total characters of tool_result content on this line */
  chars: number;
  /** owning data root, stamped by the watcher (scope filtering) */
  source?: string | null;
}

/**
 * tool_result volume aggregated by local day → {count, chars}. The snapshot
 * only ever needs a count + total chars after a day-range filter, so the
 * watcher folds each marker into a day bucket on arrival instead of retaining
 * one object per result (tens of thousands at scale). Node-side only — never
 * crosses IPC; the snapshot carries the final {count, chars, estTokens} rollup.
 */
export type ToolResultByDay = Map<string, { count: number; chars: number }>;

export type ParsedLine =
  ({ kind: 'entry' } & UsageEntry) | ResetMarker | CompactMarker | ToolResultMarker | null;

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
  /**
   * Above-threshold rates, per-MTok, any subset. Unset fields derive from
   * `tier.in` exactly as the LiteLLM layer derives them (w5m = in × 1.25,
   * read = in × 0.1), and `tier.out` falls back to the base `out`. Omit the
   * whole object for a model that isn't tiered.
   */
  tier?: {
    in?: number;
    out?: number;
    w5m?: number;
    read?: number;
  };
  /** context window in tokens — drives the per-session context gauge */
  contextLimit?: number;
  /**
   * Multiplier applied to every rate for this model's `-fast` variant.
   * Without it an overridden model's fast turns bill at the base rate, since
   * overrides are matched before the `-fast` fallback path.
   */
  fast?: number;
}

// ---- settings (§5) ---------------------------------------------------------

export type StartOfWeek = 'sunday' | 'monday';
export type TokenLimitSetting = 'max' | number | null;

export interface AppSettings {
  theme: string;
  costMode: CostMode;
  /**
   * IANA zone name used for ALL day bucketing (entries, day/week/month keys,
   * the hourly heatmap, range resolution). '' means the system zone — the
   * default, and ccmon's behaviour before this setting existed.
   *
   * Changing it re-buckets history WITHOUT a rescan: main re-derives every
   * entry's dateKey in one pass. The pricing archive keeps whatever zone it
   * recorded in, so rates-of-the-day lookups can be off by a day at a boundary
   * where rates also changed — bounded and documented in v2-spec.md §2.
   */
  timezone: string;
  pricingOffline: boolean;
  startOfWeek: StartOfWeek;
  tokenLimit: TokenLimitSetting;
  /**
   * Billing-window length in hours for the blocks view. null = 5, Anthropic's
   * real window. Any other value turns blocks into a personal work-session
   * view rather than a billing one — the UI states that.
   */
  blockHours: number | null;
  compactNumbers: boolean;
  /**
   * Blank every money figure at format time — for screenshots, streams and
   * shared screens. Display-only: nothing stored or computed changes.
   */
  privacyMode: boolean;
  /** display currency, ISO code — costs stay USD internally (§5) */
  currency: string;
  /** null (primary account) | array of project dirs (multi-account scoping) */
  sources: string[] | null;
  /** opt-in: fire an OS notification when any account crosses ~90% of a window */
  notifyNearCap: boolean;
  /**
   * Opt-in: closing the window hides it to the tray instead of quitting.
   *
   * Default FALSE on purpose. Silently turning a close gesture into "still
   * running, no visible window" is a trap, so the user has to ask for it, and
   * the tray's Quit item is the documented way out.
   */
  closeToTray: boolean;
  /** model id the AI usage advisor uses (reuses the Claude Code login) */
  aiModel: string;
  /** per config-root shell-wrapper prefs (rename / untrack), keyed by root path */
  accountWrapperPrefs: Record<string, AccountWrapperPrefs>;
}

/** A user override for one account's generated shell wrapper. */
export interface AccountWrapperPrefs {
  /** overrides the auto-suggested wrapper command name */
  name?: string;
  /** true = excluded from the generated wrapper file (untracked, not deleted) */
  disabled?: boolean;
  /**
   * true = hidden from ccmon entirely (grid, scope picker, limits poll,
   * snapshot). Purely a view preference: nothing on disk is touched and the
   * shell wrapper is left alone, so unhiding restores everything. This is
   * ccmon's answer to "remove this account" — it never deletes a config dir,
   * because that dir holds the transcripts the whole app is built on.
   */
  hidden?: boolean;
  /**
   * Extra environment this account's wrapper exports (see `AccountSpec.env`) —
   * how an alternate-provider account (Claude Code pointed at DeepSeek) is
   * described. Persisted so reopening the wizard doesn't silently regenerate
   * the wrapper without it.
   *
   * May hold an API token, so `settings.json` is written 0600 like every other
   * ccmon file that can carry a secret.
   */
  env?: Record<string, string>;
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
  /** extra Codex homes (the dir holding `sessions/`), beyond `CODEX_HOME` */
  codexDirs?: string[];
  pricing?: Record<string, PricingOverride>;
  /** raw model id → display label (DISPLAY ONLY — never affects pricing) */
  modelAliases?: Record<string, string>;
  /** raw project path → display label (DISPLAY ONLY) */
  projectAliases?: Record<string, string>;
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
  /** resolved input price USD per MTok (from the pricing engine), or null when unknown */
  inputRate: number | null;
  /** resolved output price USD per MTok (from the pricing engine), or null when unknown */
  outputRate: number | null;
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

/**
 * Global analytics time range. The renderer picks a preset (or a custom
 * from–to span); the main process resolves it to concrete day-key bounds at
 * recompute time via {@link resolveRange}. Scopes the historical body of the
 * snapshot (totals, daily/weekly/monthly series, models, projects, sessions,
 * cache, what-if, tools, insights). Live plan limits and per-account spend are
 * separate paths and never range-scoped.
 */
export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'month' | 'lastMonth' | 'all' | 'custom';

export interface TimeRange {
  preset: RangePreset;
  /** inclusive 'YYYY-MM-DD' local day keys — only meaningful for preset 'custom' */
  customStart?: string | null;
  customEnd?: string | null;
}

/** A {@link TimeRange} resolved against a concrete `now` to absolute bounds. */
export interface ResolvedRange {
  preset: RangePreset;
  /** inclusive lower bound local day key, or null = unbounded (from first entry) */
  startKey: string | null;
  /** inclusive upper bound local day key, or null = unbounded (through today) */
  endKey: string | null;
  /** human label for display, e.g. 'last 30 days', 'June 2026', 'all time' */
  label: string;
}

export interface Snapshot {
  generatedAt: number;
  version: string;
  sourceDirs: string[];
  entryCount: number;
  costMode: CostMode;
  unknownModels: string[];
  /**
   * The time range this snapshot's historical body was computed over. 'all'
   * (the default) means lifetime totals with the standard daily window — the
   * pre-range behavior. Live limits / account spend ignore this.
   */
  range: ResolvedRange;
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
  /**
   * Estimated cost of re-ingesting context immediately after compactions: the
   * input+cache-read cost of the first turn in each session following a
   * compaction marker. A floor — only the first post-compaction turn is counted.
   */
  compactionReread: { costUSD: number; turns: number };
  /**
   * Volume of tool_result output returned to the model (re-fed as input on the
   * next turn). `estTokens` is a chars/4 ESTIMATE — the transcripts carry no
   * per-result token count. Sized from user-side lines, never billed.
   */
  toolResults: { count: number; chars: number; estTokens: number };
  /**
   * Recorded-vs-calculated cost reconciliation. ALWAYS compares the `costUSD`
   * the CLI wrote against a fresh token-based calculation, independent of the
   * active cost mode — under 'auto'/'display' the snapshot's own cost IS the
   * recorded value, so comparing against it would report zero drift by
   * construction and say nothing.
   *
   * Only entries that carry a recorded cost can be compared; `coverage` says
   * how many did, so a small sample can't be mistaken for a clean bill.
   */
  reconcile: CostReconciliation;
  records: UsageRecords;
  recentEvents: FeedEvent[];
  /**
   * Lifetime + recent spend per account root, scope-INDEPENDENT (every
   * discovered login, like live limits) — powers the accounts dashboard.
   */
  accountSpend: AccountSpendMap;
}

/** Lifetime + recent spend for one account root (scope-independent). */
export interface AccountSpend {
  /** lifetime USD across all retained entries for this root */
  cost: number;
  /** lifetime input+output tokens */
  tokens: number;
  /** lifetime input+output+cache-read+cache-write tokens */
  allTokens: number;
  entries: number;
  sessions: number;
  /** first/last activity timestamps (epoch ms), or null when empty */
  firstTs: number | null;
  lastTs: number | null;
  /** USD spent today (local day) */
  today: number;
  /** USD spent over the rolling last 7 days */
  week: number;
  /** USD spent over the rolling last 30 days */
  month: number;
}

/** One bucket of recorded-vs-calculated cost. */
export interface ReconcileRow {
  /** day key or model id, depending on the series */
  key: string;
  /** sum of costUSD as written by the CLI */
  recorded: number;
  /** sum of ccmon's token-based calculation over the SAME entries */
  calculated: number;
  /** entries compared (i.e. those carrying a recorded cost) */
  entries: number;
}

export interface CostReconciliation {
  /** entries carrying a recorded costUSD — the comparable set */
  compared: number;
  /** entries in scope, comparable or not */
  total: number;
  /** compared / total, 0-1; a low value makes the drift below unrepresentative */
  coverage: number;
  /** totals over the compared set only */
  recorded: number;
  calculated: number;
  /** calculated − recorded (positive = ccmon prices it higher) */
  drift: number;
  /** drift as a share of recorded, 0 when nothing is comparable */
  driftPct: number;
  /** ascending by day, comparable entries only */
  byDay: ReconcileRow[];
  /** worst absolute drift first */
  byModel: ReconcileRow[];
}

/** source dir → lifetime/recent spend */
export type AccountSpendMap = Record<string, AccountSpend>;

// ---- AI usage advisor -------------------------------------------------------

/** One turn in an advisor conversation. */
export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Result of an advisor turn: the answer, or a verbose reason it failed. */
export type AdvisorResult = { ok: true; answer: string } | { ok: false; error: string };

/** Candidate models offered in Settings for the advisor. */
export const ADVISOR_MODELS = [
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

// ---- CSV export -------------------------------------------------------------

/** Which snapshot table to export as CSV. */
export type ExportKind = 'days' | 'sessions' | 'projects' | 'models';

/** Result of a CSV export: written path, user cancellation, or a failure. */
export type ExportResult =
  { ok: true; path: string; rows: number } | { ok: false; canceled?: boolean; error?: string };

/** One ranked contributor to a day's spend (project / model / session). */
export interface DayContributor {
  /** project path, model id, or session id depending on the list */
  key: string;
  /** display label (project basename, short model, or session project) */
  label: string;
  cost: number;
  /** share of the day's total cost, 0–100 */
  pct: number;
}

/**
 * On-demand breakdown of a single local day — "why was this day expensive".
 * Recomputed from the scoped entries when the user drills into a day, so it
 * never bloats the snapshot. Compared against the median active day.
 */
export interface DayBreakdown {
  date: string;
  cost: number;
  tokens: number;
  entries: number;
  sessions: number;
  /** median cost across active days in scope (robust baseline) */
  medianCost: number;
  /** how far above/below the median this day sits, in %, or null when no baseline */
  vsMedianPct: number | null;
  topProjects: DayContributor[];
  topModels: DayContributor[];
  topSessions: DayContributor[];
  toolTurns: number;
  toolInvocations: number;
  compactions: number;
  /** projects whose first-ever activity (in scope) landed on this day */
  newProjects: string[];
}

// ---- accounts & live limits (§5) --------------------------------------------

export interface AccountInfo {
  /** which CLI this account belongs to — see `shared/tools.ts` */
  tool: ToolId;
  plan: string | null;
  /** plan multiplier parsed from rateLimitTier, e.g. '5x' | '20x'; Claude only */
  tier: string | null;
  email: string | null;
  organization: string | null;
  hasCredentials: boolean;
  /**
   * Codex only: whether the CLI authenticates with a ChatGPT login or a bare
   * API key. Null for Claude, which has exactly one mode.
   */
  authMode: 'chatgpt' | 'apikey' | null;
  /**
   * Claude Code's transcript-retention window (`cleanupPeriodDays` in
   * `<root>/settings.json`, default 30). NULL for Codex, which has no
   * retention setting — never coerce that null to 0, which would report
   * "deletes everything immediately" instead of "no policy".
   */
  cleanupPeriodDays: number | null;
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

/**
 * Outcome of a user-initiated re-login (auth.ts). A silent refresh resolves
 * 'refreshed'; a dead refresh token opens the browser and resolves
 * 'awaiting-code' (the renderer then collects the pasted code); anything else
 * is 'error' with a verbose reason.
 */
export type LoginResult =
  { status: 'refreshed' } | { status: 'awaiting-code' } | { status: 'error'; error: string };

/** Outcome of submitting the pasted authorization code to finish a browser login. */
export interface LoginCodeResult {
  ok: boolean;
  error?: string;
}

// ---- DeepSeek balance (§5.7) -----------------------------------------------

/**
 * One currency's balance from DeepSeek's `/user/balance`. Amounts are in
 * `currency` — NOT USD — because that is what the provider bills in; every
 * derived figure ccmon computes from them (`burnUSDPerDay`, drift) is
 * converted to USD first so it stays comparable to snapshot money.
 */
export interface DeepseekBalance {
  /** 'CNY' | 'USD' per the API; treated as an open set */
  currency: string;
  total: number;
  /** promotional balance — expires, and is spent before the topped-up part */
  granted: number;
  toppedUp: number;
}

/** One persisted balance poll — the basis for measured burn and drift. */
export interface DeepseekSample {
  ts: number;
  /** primary balance total, in `currency` */
  total: number;
  currency: string;
}

/**
 * Reconciliation of the balance DeepSeek actually consumed against the cost
 * ccmon computed from local transcripts over the same span. A ratio far from
 * 0 means the pricing snapshot, the cost mode, or the assumption that all
 * DeepSeek spend flows through Claude Code is off.
 */
export interface DeepseekDrift {
  /** span the comparison covers (epoch ms, inclusive) */
  fromTs: number;
  toTs: number;
  /** balance actually consumed over the span, converted to USD */
  observedUSD: number;
  /** ccmon's transcript-derived DeepSeek cost over the same span */
  computedUSD: number;
  /** observed ÷ computed − 1 (positive = ccmon under-counts), null when computed ≈ 0 */
  ratio: number | null;
}

export type DeepseekResult =
  | {
      ok: true;
      fetchedAt: number;
      /** the API's own verdict on whether the balance can still fund calls */
      isAvailable: boolean;
      /** every currency the account holds, as returned */
      balances: DeepseekBalance[];
      /** the balance ccmon leads with — USD when present, else the first */
      primary: DeepseekBalance;
      /** thinned ascending samples for the balance sparkline */
      history?: DeepseekSample[];
      /** measured spend per day from the balance history, in USD */
      burnUSDPerDay?: number | null;
      /** days of balance left at the measured burn, null when burn ≈ 0 */
      runwayDays?: number | null;
      /** computed-vs-observed reconciliation, null without enough history */
      drift?: DeepseekDrift | null;
      /** retained pre-failure data — still shown, just aging */
      stale?: boolean;
      lastError?: { error: string; at: number } | null;
      nextRetryAt?: number | null;
    }
  | ({ ok: false } & LimitsFailure);

/** Whether a DeepSeek key is configured, and where it came from. */
export interface DeepseekAuth {
  connected: boolean;
  /** 'stored' → saved by the user; 'env' → detected this run, not persisted */
  source: 'stored' | 'env' | null;
  /** masked tail for display, e.g. '…a91f' — never the key itself */
  hint: string | null;
  /** false when the OS keyring was unavailable and the stored key is plaintext */
  encrypted: boolean;
  /** an unsaved env key is available to adopt (drives the "use detected key" offer) */
  envDetected: boolean;
}

/** Outcome of connecting or disconnecting a DeepSeek key. */
export interface DeepseekAuthResult {
  ok: boolean;
  error?: string;
}

// ---- multi-account setup wizard (§8) ---------------------------------------

/** A shell whose startup file can hold the `claude-*` account wrappers. */
export interface ShellTarget {
  /** the shell — drives which rc file and wrapper syntax we use */
  shell: 'zy' | 'zsh' | 'bash' | 'powershell';
  /** wrapper syntax family: POSIX `name() {…}` or PowerShell `function name {…}` */
  family: 'posix' | 'powershell';
  /** absolute path to the rc / profile file (e.g. ~/.zyrc, the PS $PROFILE) */
  rcPath: string;
  /** does that rc file already exist on disk? */
  exists: boolean;
  /** is this the user's actual login shell (per /etc/passwd, then $SHELL)? */
  detected: boolean;
  /** is the ccmon-managed source line already present in this rc? */
  linked: boolean;
  /** short human note for the UI ('login shell', 'would be created', …) */
  note: string;
}

/** OS + the shells that can hold the wrappers on it. */
export interface ShellDetection {
  /** Node's `process.platform` — 'linux' | 'darwin' | 'win32' | … */
  platform: string;
  /** the candidate shells for this OS, login/default shell flagged `detected` */
  shells: ShellTarget[];
}

/** One account wrapper to generate: a command name bound to a tool's home. */
export interface AccountSpec {
  /** which CLI this wrapper launches, and so which env var it exports */
  tool: ToolId;
  /** wrapper command, e.g. 'claude-work' or 'codex-work' */
  name: string;
  /** the tool's home dir, exported as its `homeEnvVar` (e.g. ~/.claude-work) */
  root: string;
  /**
   * Extra environment exported by this wrapper, on top of `CLAUDE_CONFIG_DIR`.
   * This is what makes an alternate-provider account expressible: Claude Code
   * pointed at DeepSeek is `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + the
   * model mapping, none of which is a config dir. A cross-resume INTO this
   * account re-exports the same map, so a resumed session keeps its provider.
   *
   * Values are written verbatim into a file only the user can read (0600) —
   * treat anything here as a secret at rest.
   */
  env?: Record<string, string>;
}

export interface SetupOptions {
  accounts: AccountSpec[];
  /** rc files to link the managed script from */
  rcPaths: string[];
  /** also install the claude-cross-resume helper to ~/.local/bin */
  installHelper: boolean;
  /** comment out pre-existing hand-written claude-* defs the managed file replaces */
  tidyExisting?: boolean;
}

/** A pre-existing definition of a managed wrapper found in a shell rc. */
export interface RcExisting {
  /** the wrapper name, e.g. 'claude-work' */
  name: string;
  /** 1-based line number in the rc */
  line: number;
  /** the line's text (trimmed for display) */
  text: string;
  /** a single-line `name() { … }` we can safely comment out; multi-line → false */
  canTidy: boolean;
}

/** Dry-run of a setup apply — exactly what would be written, nothing done. */
export interface SetupPlan {
  /**
   * The ccmon-owned wrapper files, one per tool that has accounts. A tool with
   * none contributes no entry, and its file is REMOVED on apply — deleting
   * your last account of a tool cleans up after itself rather than leaving a
   * stale file the rc keeps sourcing.
   */
  managed: Array<{ tool: ToolId; path: string; script: string }>;
  /** per chosen rc: link state, the block we'd append, and any clashing defs */
  rcEdits: Array<{
    rcPath: string;
    alreadyLinked: boolean;
    /** the block to write — empty when the file is already current */
    blockToAdd: string;
    /**
     * True when a ccmon block is already there but its contents are stale, so
     * apply will REPLACE it in place rather than append. Distinct from
     * `alreadyLinked`, which only says a block exists.
     */
    blockReplaces: boolean;
    existing: RcExisting[];
  }>;
  /**
   * Where each tool's cross-resume helper goes and whether it is already
   * current — one entry per tool that has accounts, so a Claude-only setup
   * never mentions codex-cross-resume.
   */
  helpers: Array<{ tool: ToolId; dest: string; installed: boolean }>;
  /** validation problems that block apply (bad name, no rc selected, …) */
  problems: string[];
  /** non-blocking advisories (shadowed hand-written wrappers, …) */
  warnings: string[];
}

/** Result of an applied setup — what changed and how to load it. */
export interface SetupReport {
  ok: boolean;
  wroteManaged: boolean;
  /** rc files we appended the source line to this run */
  linkedRc: string[];
  /** rc files where we commented out superseded hand-written defs */
  tidiedRc: string[];
  helperInstalled: boolean;
  /** e.g. 'run: source ~/.bashrc (or open a new terminal)' */
  reloadHint: string;
  errors: string[];
}

/**
 * A recent Claude Code session under an account root — the raw material for
 * cross-account resume (continuing a session on the other account when one
 * hits its limit). `id` is the transcript uuid; `cwd` is read from the
 * transcript so the resume can `cd` back to the original project.
 */
export interface RecentSession {
  /** session uuid (the *.jsonl basename) */
  id: string;
  /** original working directory from the transcript, or null if unreadable */
  cwd: string | null;
  /** project label (the cwd's leaf, or the encoded project-dir name) */
  project: string;
  /** transcript last-modified time (epoch ms) — newest first */
  mtime: number;
}
