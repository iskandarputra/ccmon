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

  onSnapshot(cb: (snapshot: Snapshot) => void): Unsubscribe;
  onEvents(cb: (events: FeedEvent[]) => void): Unsubscribe;
  onProgress(cb: (progress: ScanProgress) => void): Unsubscribe;
  onReset(cb: (payload: { reason: string }) => void): Unsubscribe;
  onSettings(cb: (settings: AppSettings) => void): Unsubscribe;
  onPricingMeta(cb: (meta: PricingMeta) => void): Unsubscribe;
  onLimits(cb: (limits: LimitsMap) => void): Unsubscribe;
  onCurrency(cb: (rates: CurrencyRates) => void): Unsubscribe;

  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
