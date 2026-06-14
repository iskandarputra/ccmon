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
  AppSettings,
  CurrencyRates,
  FeedEvent,
  LimitsMap,
  PricingMeta,
  RecentSession,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellDetection,
  Snapshot,
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

  /** Most recent resumable sessions under an account's `<root>/projects` dir. */
  listRecentSessions(projectDir: string, limit?: number): Promise<RecentSession[]>;

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
