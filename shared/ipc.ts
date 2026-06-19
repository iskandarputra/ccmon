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
  AccountsMap,
  AdvisorMessage,
  AdvisorResult,
  AppSettings,
  CurrencyRates,
  DayBreakdown,
  ExportKind,
  ExportResult,
  FeedEvent,
  LimitsMap,
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
} from './types';

export interface ScanProgress {
  scanned: number;
  total: number;
  entries: number;
}

export type AppStatus = 'scanning' | 'ready' | 'error';

/** Payload of the app:getState invoke. */
export interface AppState {
  version: string;
  status: AppStatus;
  progress: ScanProgress;
  sourceDirs: string[];
  snapshot: Snapshot | null;
  configPath: string;
  settings: AppSettings | null;
  pricingMeta: PricingMeta | null;
  accounts: AccountsMap;
  limits: LimitsMap;
  currency: CurrencyRates | null;
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
  /** Create a sibling config dir `~/.claude-<suffix>` for a new account. */
  createAccount(suffix: string): Promise<{ ok: boolean; root: string; error?: string }>;

  onSnapshot(cb: (snapshot: Snapshot) => void): Unsubscribe;
  onEvents(cb: (events: FeedEvent[]) => void): Unsubscribe;
  onProgress(cb: (progress: ScanProgress) => void): Unsubscribe;
  onReset(cb: (payload: { reason: string }) => void): Unsubscribe;
  onSettings(cb: (settings: AppSettings) => void): Unsubscribe;
  onPricingMeta(cb: (meta: PricingMeta) => void): Unsubscribe;
  onLimits(cb: (limits: LimitsMap) => void): Unsubscribe;
  onCurrency(cb: (rates: CurrencyRates) => void): Unsubscribe;

  openUrl(url: string): void;

  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
