/**
 * @file useUsageStore.ts
 * @brief Single zustand store mirroring main-process state into the renderer.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { create } from 'zustand';
import type {
  AccountsMap,
  AppSettings,
  CurrencyRates,
  FeedEvent,
  LimitsMap,
  PricingMeta,
  Snapshot,
} from '../../shared/types';
import type { ScanProgress } from '../../shared/ipc';

const FEED_LIMIT = 80;

export type ViewId =
  | 'overview'
  | 'activity'
  | 'insights'
  | 'spatial'
  | 'sessions'
  | 'blocks'
  | 'models'
  | 'projects'
  | 'settings';

export type StoreStatus = 'connecting' | 'scanning' | 'ready' | 'error';

export interface UsageState {
  status: StoreStatus;
  progress: ScanProgress;
  snapshot: Snapshot | null;
  feed: FeedEvent[];
  lastEventTs: number | null;
  version: string;
  sourceDirs: string[];
  view: ViewId;
  /** loaded from main on boot */
  settings: AppSettings | null;
  /** {source, fetchedAt, modelCount} from main */
  pricingMeta: PricingMeta | null;
  /** source dir → {plan, email, organization, hasCredentials} */
  accounts: AccountsMap;
  /** source dir → live plan-limit result */
  limits: LimitsMap;
  /** hourly USD exchange rates for display conversion */
  currency: CurrencyRates | null;

  setView: (view: ViewId) => void;
  setSettings: (settings: AppSettings | null) => void;
  setProgress: (progress: ScanProgress) => void;
  setLimits: (limits: LimitsMap | null | undefined) => void;
  setSnapshot: (snapshot: Snapshot) => void;
  pushEvents: (events: FeedEvent[]) => void;
  reset: () => void;
}

/**
 * Single renderer-side store. The main process owns the data; this store
 * mirrors the latest snapshot plus a live-feed ring buffer, the active view,
 * and persisted app settings.
 */
export const useUsageStore = create<UsageState>((set) => ({
  status: 'connecting',
  progress: { scanned: 0, total: 0, entries: 0 },
  snapshot: null,
  feed: [],
  lastEventTs: null,
  version: '',
  sourceDirs: [],
  view: 'overview',
  settings: null,
  pricingMeta: null,
  accounts: {},
  limits: {},
  currency: null,

  setView: (view) => set({ view }),
  setSettings: (settings) => set({ settings }),
  setProgress: (progress) => set({ progress }),
  setLimits: (limits) => set({ limits: limits || {} }),

  setSnapshot: (snapshot) =>
    set((st) => ({
      snapshot,
      status: 'ready',
      // Seed the feed from the snapshot's recent entries on first load.
      feed: st.feed.length
        ? st.feed
        : (snapshot.recentEvents || []).slice().reverse(),
      lastEventTs: Math.max(st.lastEventTs || 0, snapshot.totals.lastTs || 0) || null,
    })),

  pushEvents: (events) =>
    set((st) => ({
      feed: [...events.slice().reverse(), ...st.feed].slice(0, FEED_LIMIT),
      lastEventTs:
        Math.max(st.lastEventTs || 0, ...events.map((e) => e.ts)) || null,
    })),

  reset: () =>
    set({
      status: 'scanning',
      snapshot: null,
      feed: [],
      progress: { scanned: 0, total: 0, entries: 0 },
    }),
}));
