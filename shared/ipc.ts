/**
 * @file ipc.ts
 * @brief Preload-bridge surface (CcmonApi) and IPC payload types.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * IPC bridge contract between electron/preload.ts (implementation) and the
 * renderer (consumer via window.ccmon). Channel payload types live here so
 * both sides stay in lockstep.
 */

import type {
  AccountSpec,
  AccountsMap,
  AdvisorMessage,
  AdvisorResult,
  AppSettings,
  CurrencyRates,
  DayBreakdown,
  DeepseekAuth,
  DeepseekAuthResult,
  DeepseekResult,
  ExportKind,
  ExportResult,
  FeedEvent,
  LimitsMap,
  LimitsMarker,
  LoginCodeResult,
  LoginResult,
  PricingMeta,
  RecentSession,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellDetection,
  Snapshot,
  TimeRange,
  ToolId,
} from './types';

export interface ScanProgress {
  scanned: number;
  total: number;
  entries: number;
}

export type AppStatus = 'scanning' | 'ready' | 'error';

/** Pushed when the visible account set changes (hide/unhide, create, rename). */
export interface AccountsPayload {
  sourceDirs: string[];
  allSourceDirs: string[];
  accounts: AccountsMap;
}

/** Payload of the app:getState invoke. */
export interface AppState {
  version: string;
  status: AppStatus;
  progress: ScanProgress;
  /** the accounts ccmon shows — discovered dirs minus hidden ones */
  sourceDirs: string[];
  /** every discovered dir, hidden included (the shell-wrapper controls need it) */
  allSourceDirs: string[];
  snapshot: Snapshot | null;
  configPath: string;
  /**
   * Display-only alias maps from `~/.config/ccmon/config.json`. Delivered with
   * app state rather than the snapshot: they are hand-edited config, read once
   * at startup like `claudeDirs`, and re-sending them on every recompute would
   * be pure overhead.
   */
  aliases: { models: Record<string, string>; projects: Record<string, string> };
  settings: AppSettings | null;
  pricingMeta: PricingMeta | null;
  accounts: AccountsMap;
  limits: LimitsMap;
  /**
   * Rate limits a tool recorded in its OWN transcript, per source dir — kept
   * separate from `limits` on purpose.
   *
   * `LimitsResult` describes a successful poll of an authenticated endpoint,
   * with Claude's session/week/weekOpus windows. Codex's are duration-labelled
   * (5h / weekly / monthly depending on plan) and were never fetched — they
   * were read out of a rollout. Squeezing one into the other would either
   * mislabel a monthly window as "session" or claim a fetch that never
   * happened, so they travel side by side and the card renders whichever the
   * account has.
   */
  toolLimits: Record<string, LimitsMarker>;
  currency: CurrencyRates | null;
  /** latest DeepSeek balance, null without a key or before the first poll */
  deepseek: DeepseekResult | null;
  deepseekAuth: DeepseekAuth;
}

export type Unsubscribe = () => void;

/** The API surface exposed on window.ccmon by the preload script. */
export interface CcmonApi {
  getState(): Promise<AppState>;
  rescan(): Promise<boolean>;
  openDataDir(): Promise<void>;
  setSettings(partial: Partial<AppSettings>): Promise<AppSettings | null>;
  refreshPricing(): Promise<PricingMeta | null>;
  refreshLimits(): Promise<LimitsMap>;
  refreshCurrency(): Promise<CurrencyRates | null>;

  /**
   * Set the global analytics time range. Re-scopes the historical body of the
   * snapshot (totals, daily/weekly/monthly, models, projects, sessions, cache,
   * what-if, tools, insights) and pushes a fresh `usage:snapshot`. Live plan
   * limits and per-account spend are not range-scoped.
   */
  setRange(range: TimeRange): Promise<void>;

  /**
   * Re-authenticate one account when its login has expired. Tries a silent
   * refresh of the stored token first; if that token is dead it opens the
   * system browser to the OAuth page and resolves 'awaiting-code', after which
   * the renderer calls {@link submitLoginCode} with the pasted code.
   */
  login(projectDir: string): Promise<LoginResult>;
  /** Finish a browser login by submitting the pasted `code#state` string. */
  submitLoginCode(projectDir: string, code: string): Promise<LoginCodeResult>;

  // ---- DeepSeek balance ----------------------------------------------------
  /**
   * Whether a DeepSeek API key is configured and where it came from. The key
   * itself NEVER crosses this bridge outbound — only a masked 4-char tail.
   */
  deepseekAuth(): Promise<DeepseekAuth>;
  /**
   * Save a DeepSeek API key. Verified against the balance endpoint before it
   * is persisted, so an invalid key is rejected here rather than failing
   * silently on the next poll. Stored encrypted via the OS keyring when one is
   * available (`DeepseekAuth.encrypted` reports whether it was).
   *
   * Omit `key` to adopt the key detected in the environment
   * (`DeepseekAuth.envDetected`) — main reads it directly, so a detected key
   * never has to cross this bridge just to be saved.
   */
  connectDeepseek(key?: string): Promise<DeepseekAuthResult>;
  /** Forget the stored key and its balance history. */
  disconnectDeepseek(): Promise<DeepseekAuthResult>;
  /** Poll the balance now, bypassing any retry backoff. */
  refreshDeepseek(): Promise<DeepseekResult | null>;

  /** Most recent resumable sessions under an account's `<root>/projects` dir. */
  listRecentSessions(projectDir: string, limit?: number): Promise<RecentSession[]>;

  /** On-demand "why was this day expensive" breakdown for a local YYYY-MM-DD day. */
  dayBreakdown(dateKey: string): Promise<DayBreakdown | null>;

  /** Export a snapshot table to CSV via a native save dialog. */
  exportCsv(kind: ExportKind): Promise<ExportResult>;

  /**
   * Ask the AI usage advisor a question. Sends only snapshot aggregates (never
   * transcripts), reusing the Claude Code login. `history` is the prior turns.
   * `dir` selects which account's login to spend the request on (a
   * `<root>/projects` path); omit to use the primary account. Picking an
   * account with headroom avoids 429s when the primary is at its cap.
   */
  askAdvisor(question: string, history: AdvisorMessage[], dir?: string): Promise<AdvisorResult>;

  // ---- multi-account setup wizard -----------------------------------------
  /** OS + shells whose rc could hold the wrappers, login/default shell flagged. */
  detectShells(): Promise<ShellDetection>;
  /** Dry-run a setup: exactly what would be written, nothing done. */
  previewSetup(opts: SetupOptions): Promise<SetupPlan>;
  /** Apply a setup (writes the managed file + rc link + optional helper). */
  applySetup(opts: SetupOptions): Promise<SetupReport>;
  /**
   * Create a sibling home `~/.<tool>-<suffix>` for a new account, seeded with
   * the subdir that makes it discoverable.
   */
  createAccount(
    suffix: string,
    tool: ToolId,
  ): Promise<{ ok: boolean; root: string; error?: string }>;
  /**
   * Rename an account's home on disk to `~/.<tool>-<suffix>`; the tool is
   * inferred from `root`. Refuses each tool's default home. Requires an app
   * relaunch afterward for live file-watching to pick up the new path.
   */
  renameAccount(
    root: string,
    suffix: string,
  ): Promise<{ ok: boolean; root: string; error?: string }>;
  /**
   * Rewrite just the managed wrapper file to this exact account list — used
   * by the Accounts view's rename / remove-from-shell controls. Never
   * touches rc files or the cross-resume helper.
   */
  updateWrapperAccounts(accounts: AccountSpec[]): Promise<{ ok: boolean; errors: string[] }>;

  onSnapshot(cb: (snapshot: Snapshot) => void): Unsubscribe;
  onEvents(cb: (events: FeedEvent[]) => void): Unsubscribe;
  onProgress(cb: (progress: ScanProgress) => void): Unsubscribe;
  onReset(cb: (payload: { reason: string }) => void): Unsubscribe;
  onSettings(cb: (settings: AppSettings) => void): Unsubscribe;
  onPricingMeta(cb: (meta: PricingMeta) => void): Unsubscribe;
  onLimits(cb: (limits: LimitsMap) => void): Unsubscribe;
  /**
   * Rate limits a tool recorded in its own transcript. Pushed on the snapshot
   * path, because they ride on a usage line and so change exactly when entries
   * do — `app:getState` alone is not enough, the renderer calls it once while
   * the first scan is still running.
   */
  onToolLimits(cb: (limits: Record<string, LimitsMarker>) => void): Unsubscribe;
  onCurrency(cb: (rates: CurrencyRates) => void): Unsubscribe;
  onDeepseek(cb: (result: DeepseekResult | null) => void): Unsubscribe;
  onDeepseekAuth(cb: (auth: DeepseekAuth) => void): Unsubscribe;
  onAccounts(cb: (payload: AccountsPayload) => void): Unsubscribe;

  openUrl(url: string): void;

  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
