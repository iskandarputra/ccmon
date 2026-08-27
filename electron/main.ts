/**
 * @file main.ts
 * @brief Electron main process — window, IPC, and service wiring (watcher, pricing, limits, currency).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  Notification,
  dialog,
  safeStorage,
  Tray,
  nativeImage,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { detectSourceRoots } from './services/adapters';
import type { SourceRoot } from './services/adapters/types';
import { toolFor, toolForRoot } from '../shared/tools';
import { loadConfig, CONFIG_PATH } from './services/config';
import { Settings } from './services/settings';
import { createPricingEngine, costForMode, type PricingEngine } from './services/pricing';
import { PricingArchive } from './services/pricing-archive';
import { UsageWatcher } from './services/watcher';
import { buildSnapshot, dayBreakdown, toFeedEvent } from './services/aggregate';
import {
  accountLabel,
  accountsFor,
  capAlerts,
  demoLimits,
  fetchLiveLimits,
} from './services/accounts';
import {
  beginBrowserLogin,
  completeBrowserLogin,
  readOauth,
  refresh as refreshLogin,
  type PendingLogin,
} from './services/auth';
import { askAdvisor, buildUsageContext } from './services/advisor';
import { snapshotToCsv } from './services/export';
import { recentSessions } from './services/cross-account';
import {
  applySetup,
  createAccountDir,
  detectShells,
  planSetup,
  renameAccountDir,
  resolveEnvSecrets,
  visibleAccountDirs,
  writeWrapperAccounts,
} from './services/account-setup';
import { LimitsHistory } from './services/limits-history';
import { CurrencyService } from './services/currency';
import { fetchBalance } from './services/deepseek';
import { DeepseekHistory } from './services/deepseek-history';
import { DeepseekKeyStore, envKey, looksLikeKey, type KeyCrypto } from './services/deepseek-key';
import { loadState, trackState } from './services/window-state';
import { recomputeSig as sigOf } from './services/recompute';
import { trayText } from './services/status-text';
import {
  dirsChanged,
  primaryDir as primaryOf,
  resolveSourceScope,
  visibleEntries as entriesForVisible,
} from './services/scope';
import { isDeepseekModel } from '../shared/providers';
import type {
  AccountSpec,
  AccountsMap,
  AppSettings,
  AdvisorMessage,
  AdvisorResult,
  CompactMarker,
  DayBreakdown,
  DeepseekAuth,
  DeepseekAuthResult,
  DeepseekResult,
  ExportKind,
  ExportResult,
  LimitsMap,
  ToolResultByDay,
  LimitsResult,
  LoginCodeResult,
  LoginResult,
  PricingMeta,
  SetupOptions,
  Snapshot,
  TimeRange,
  ToolId,
  UsageEntry,
} from '../shared/types';
import { resolveRange } from '../shared/range';
import { dayKeyFor } from '../shared/daykey';
import type { AppState, AppStatus, ScanProgress } from '../shared/ipc';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RECOMPUTE_DEBOUNCE_MS = 250;
// Cap how often the full snapshot recompute runs during a burst of appends. A
// recompute is a ~130ms full reduce at 50k entries (more at scale); the naive
// 250ms debounce lets continuous streaming pin ~35% of a core. The live feed
// updates on its own immediate path (usage:events), so coalescing the heavy
// snapshot to ~once/2s is invisible in practice and cuts that CPU ~5×.
const RECOMPUTE_MIN_INTERVAL_MS = 2000;
const PERIODIC_REFRESH_MS = 60000; // day rollover / block expiry without events
const LIMITS_REFRESH_MS = 60_000; // live plan-limits poll
const LIMITS_RETRY_MS = 60_000; // FIXED retry after a limits failure — no exponential growth
const CURRENCY_REFRESH_MS = 3_600_000; // hourly display-currency rates
// A prepaid balance moves far slower than a rate-limit window and the endpoint
// is not one to hammer — 5 min is plenty to keep runway honest.
const DEEPSEEK_REFRESH_MS = 300_000;
const DEEPSEEK_RETRY_MS = 300_000; // FIXED retry after a balance failure

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Windows routes toasts through the Application User Model ID and silently
// drops them when it does not match a registered shortcut. Without this the
// near-cap alert and the first close-to-tray hint never appear — and that hint
// is the ONLY feedback a window vanishing to the tray gives. Must be set before
// any Notification is constructed; a no-op on macOS/Linux.
if (process.platform === 'win32') app.setAppUserModelId('dev.iskandar.ccmon');

interface MainState {
  win: BrowserWindow | null;
  /** ambient tray indicator; null when the platform has no usable tray */
  tray: Tray | null;
  /** true once a real quit is underway — lets the close handler stop hiding */
  quitting: boolean;
  watcher: UsageWatcher | null;
  settings: Settings | null;
  pricing: PricingEngine | null;
  pricingMeta: PricingMeta | null;
  entries: UsageEntry[];
  sorted: boolean;
  /** bumped whenever `entries` is replaced or re-sorted — invalidates scopedData's cache */
  dataEpoch: number;
  snapshot: Snapshot | null;
  status: AppStatus;
  progress: ScanProgress;
  /**
   * Every discovered source root, hidden ones included, WITH its adapter.
   *
   * The tags are the point. `detectSourceRoots` works out which format owns
   * each dir, and main used to keep only `allSourceDirs` — so the watcher
   * received bare strings, fell back to the Claude adapter for all of them,
   * and read every Codex rollout with the wrong parser. The app held zero
   * Codex entries while the CLI, which passes tagged roots, held them all.
   */
  allSourceRoots: SourceRoot[];
  /** every discovered source dir, hidden ones included — derived from the above */
  allSourceDirs: string[];
  /** the dirs ccmon actually shows and polls — `allSourceDirs` minus hidden */
  sourceDirs: string[];
  recomputeTimer: NodeJS.Timeout | null;
  /** epoch ms of the last real (non-elided) recompute — rate-limits bursts */
  lastRecomputeAt: number;
  /** signature of the inputs behind the current snapshot — elides no-op recomputes */
  lastRecomputeSig: string | null;
  accounts: AccountsMap;
  limits: LimitsMap;
  limitsBusy: boolean;
  /** per-dir failure streak + earliest next automatic attempt */
  limitsBackoff: Map<string, { failures: number; nextAttemptAt: number }>;
  /** persisted poll samples → sparkline history + time-to-cap forecasts */
  limitsHistory: LimitsHistory | null;
  /** hourly USD exchange rates for display conversion */
  currency: CurrencyService | null;
  /** the DeepSeek API key (encrypted at rest), or an env-detected one */
  deepseekKey: DeepseekKeyStore | null;
  /** persisted balance polls → sparkline, measured burn, runway, drift */
  deepseekHistory: DeepseekHistory | null;
  /** latest DeepSeek balance result, null until the first poll (or no key) */
  deepseek: DeepseekResult | null;
  deepseekBusy: boolean;
  /** failure streak + earliest next automatic attempt for the balance poll */
  deepseekBackoff: { failures: number; nextAttemptAt: number } | null;
  /** in-flight browser logins (PKCE state) keyed by source dir */
  pendingLogins: Map<string, PendingLogin>;
  /** `<dir>:<window>` → the resetsAt we last alerted on (re-alert only after a reset) */
  capNotified: Map<string, number>;
  /** global analytics time range driving the snapshot's historical body */
  range: TimeRange;
}

const state: MainState = {
  win: null,
  tray: null,
  quitting: false,
  watcher: null,
  settings: null, // Settings instance, created on ready
  pricing: null, //  pricing engine, created on ready
  pricingMeta: null,
  entries: [],
  sorted: true,
  dataEpoch: 0,
  snapshot: null,
  status: 'scanning',
  progress: { scanned: 0, total: 0, entries: 0 },
  allSourceRoots: [],
  allSourceDirs: [],
  sourceDirs: [],
  recomputeTimer: null,
  lastRecomputeAt: 0,
  lastRecomputeSig: null,
  accounts: {},
  limits: {},
  limitsBusy: false,
  limitsBackoff: new Map(),
  limitsHistory: null,
  currency: null,
  deepseekKey: null,
  deepseekHistory: null,
  deepseek: null,
  deepseekBusy: false,
  deepseekBackoff: null,
  pendingLogins: new Map(),
  capNotified: new Map(),
  range: { preset: 'all' },
};

function send(channel: string, payload: unknown): void {
  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send(channel, payload);
  }
}

/** The main account's project dir: literal ~/.claude when present, else first. */
const primaryDir = (): string | null => primaryOf(state.sourceDirs);

/**
 * Recompute the visible dir list from the detected one and the hide prefs.
 * `state.sourceDirs` is what the rest of the app sees — grid, scope picker,
 * limits poll, snapshot — while `allSourceDirs` keeps the full set, because
 * the shell-wrapper controls must still be able to name a hidden account
 * (hiding is a ccmon view preference; it must not silently rewrite the user's
 * shell). Returns true when the visible list actually changed.
 */
function applyVisibility(): boolean {
  const prefs = state.settings?.get().accountWrapperPrefs ?? {};
  const next = visibleAccountDirs(state.allSourceDirs, prefs);
  // NUL separator, not a space: a project path may contain spaces but never
  // a NUL, so this can't report "unchanged" for two different lists.
  const changed = dirsChanged(next, state.sourceDirs);
  state.sourceDirs = next;
  return changed;
}

/** Re-detect roots from disk and re-apply the hide prefs on top. */
function refreshSourceDirs(): void {
  const cfg = loadConfig();
  state.allSourceRoots = detectSourceRoots({
    claude: cfg.claudeDirs || [],
    codex: cfg.codexDirs || [],
  });
  state.allSourceDirs = state.allSourceRoots.map((r) => r.dir);
  applyVisibility();
  state.accounts = accountsFor(state.sourceDirs);
}

/**
 * Active source scope as a Set of project-dir paths, or null for "all".
 * No saved choice (sources: null) defaults to the PRIMARY account only —
 * extra roots like ~/.claude-work are opt-in. Stale selections (renamed or
 * removed dirs) fall back to the default so the app never filters itself
 * down to an empty dataset.
 *
 * With an account hidden, "all" can no longer mean "don't filter" — null
 * would let the hidden account's entries back into the snapshot through the
 * side door — so it resolves to the explicit visible set instead.
 */
function sourceScope(): Set<string> | null {
  return resolveSourceScope({
    visible: state.sourceDirs,
    all: state.allSourceDirs,
    selected: state.settings ? state.settings.get().sources : null,
  });
}

/** Entries from visible accounts only — hidden ones are out of the app entirely. */
const visibleEntries = (): UsageEntry[] =>
  entriesForVisible(state.entries, state.sourceDirs, state.allSourceDirs);

interface ScopedData {
  entries: UsageEntry[];
  compactions: CompactMarker[];
  toolResults: ToolResultByDay;
}

/** Last scopedData() result, reused while its inputs are unchanged. */
let scopedCache: { sig: string; value: ScopedData } | null = null;

/**
 * Entries + markers under the current data scope (shared by the recompute and
 * the on-demand day drill-down so both see the same slice).
 *
 * Memoized: the periodic tick re-enters recompute every minute, and with a
 * sub-scope active (multi-account, primary-only default) the naive path
 * re-filtered the whole entry list plus every tool-result marker each time —
 * tens of thousands of throwaway allocations per minute. The cache key folds
 * everything that can change the slice: the data epoch (entries replaced or
 * re-sorted), the scope set, and the marker counts (append-only, no reorder).
 * In-place dedupe merges never touch `source`, so scope membership is stable
 * across them and the entry count alone tracks appends.
 */
function scopedData(): ScopedData {
  const scope = sourceScope();
  const watcher = state.watcher;
  const allC = watcher ? watcher.compactions : [];
  const trCount = watcher ? watcher.toolResultCount : 0;
  const scopeSig = scope ? [...scope].sort().join(',') : '*';
  const sig = `${state.dataEpoch}|${scopeSig}|${state.entries.length}|${allC.length}|${trCount}`;
  if (scopedCache && scopedCache.sig === sig) return scopedCache.value;
  const entries = scope ? state.entries.filter((e) => scope.has(e.source ?? '')) : state.entries;
  const compactions = scope ? allC.filter((c) => scope.has(c.source ?? '')) : allC;
  const toolResults: ToolResultByDay =
    watcher?.toolResultsFor(scope) ?? new Map<string, { count: number; chars: number }>();
  const value: ScopedData = { entries, compactions, toolResults };
  scopedCache = { sig, value };
  return value;
}

/**
 * Cheap signature of everything the snapshot derives from, for eliding no-op
 * recomputes. Entry COUNT alone can't catch in-place merge upgrades, so the
 * data path always forces (see `recompute(true)`); this guards only the
 * periodic time-tick. While a block is active the minute bucket is included so
 * live burn/projection still refresh every minute; idle (no active block) it is
 * not, so an away-from-keyboard app stops re-reducing for nothing. A brand-new
 * block can only form from NEW entries, which force a rebuild anyway.
 */
function recomputeSig(now: number): string {
  return sigOf({
    entries: state.entries,
    settings: state.settings?.get() ?? null,
    pricingFetchedAt: state.pricingMeta?.fetchedAt ?? null,
    pricingSource: state.pricingMeta?.source ?? null,
    resetTs: state.watcher?.resetTs ?? null,
    blockActive: !!state.snapshot?.block,
    range: state.range,
    now,
  });
}

function recompute(force = false): void {
  if (state.recomputeTimer) clearTimeout(state.recomputeTimer);
  state.recomputeTimer = null;
  if (!state.sorted) {
    state.entries.sort((a, b) => a.ts - b.ts);
    state.sorted = true;
    state.dataEpoch++; // order changed without a length change — invalidate the scope cache
  }
  const now = Date.now();
  const sig = recomputeSig(now);
  // periodic ticks that change nothing material skip the full reduce; the data
  // path (new/merged entries, settings, pricing, scope) always passes force
  if (!force && state.snapshot && sig === state.lastRecomputeSig) return;
  state.lastRecomputeSig = sig;
  state.lastRecomputeAt = now; // only real (non-elided) reduces count toward the rate limit
  const { entries, compactions, toolResults } = scopedData();
  state.snapshot = buildSnapshot(entries, {
    now,
    sourceDirs: state.sourceDirs,
    version: app.getVersion(),
    pricing: state.pricing,
    settings: state.settings ? state.settings.get() : {},
    resetTs: state.watcher ? state.watcher.resetTs : null,
    compactions,
    toolResults,
    // per-account spend is scope-INDEPENDENT (every visible login), like live
    // limits — but a hidden account is out of the app, not merely out of scope
    accountEntries: visibleEntries(),
    // global analytics range scopes the historical body (not account spend)
    range: resolveRange(state.range, now, state.settings?.get().timezone || null),
  });
  send('usage:snapshot', state.snapshot);
  refreshTray();
}

function pushPricingMeta(): void {
  if (!state.pricing) return;
  state.pricingMeta = state.pricing.meta();
  send('pricing:meta', state.pricingMeta);
}

function scheduleRecompute(): void {
  if (state.recomputeTimer) return;
  // the debounced path is always a real input change (entries/settings/
  // pricing/scope) — force past the no-op elision guard. Trailing-debounce by
  // 250ms for responsiveness after a quiet spell, but never fire more than once
  // per RECOMPUTE_MIN_INTERVAL_MS so a burst of appends can't pin a core.
  const sinceLast = Date.now() - state.lastRecomputeAt;
  const delay = Math.max(RECOMPUTE_DEBOUNCE_MS, RECOMPUTE_MIN_INTERVAL_MS - sinceLast);
  state.recomputeTimer = setTimeout(() => recompute(true), delay);
}

/**
 * Refresh live plan limits for accounts in the current scope — always on;
 * the real numbers are the point. Read-only against the stored Claude Code
 * login; accounts without any stored login are simply omitted.
 *
 * Failure handling is deliberately graceful AND loud:
 *  - the last good result stays on screen, flagged `stale` with the verbose
 *    failure reason and the scheduled retry time
 *  - failing dirs retry on a FIXED 1-minute cadence (no exponential
 *    growth); only an explicit server Retry-After longer than that can
 *    extend a wait. `force` (manual refresh / scope change) fires
 *    immediately and never escalates the schedule
 *  - every failure and recovery is logged with full context
 */
/** Short account label from a source dir ('~/.claude-work/projects' → 'work'). */

/**
 * Opt-in OS notification when an account crosses ~90% of a live window. Fires
 * at most once per window per reset cycle (keyed on resetsAt) so it never spams
 * the 60s poll; a fresh window (new resetsAt) re-arms the alert. Clicking it
 * focuses the app. No-op unless the setting is on and the OS supports it.
 */
function maybeNotifyCap(dir: string, r: LimitsResult): void {
  if (process.env.CCMON_DEMO_LIMITS) return;
  if (!state.settings?.get().notifyNearCap || !Notification.isSupported()) return;
  // `capAlerts` owns the WHICH (threshold, per-reset-cycle dedupe) and is unit
  // tested; this function owns only the Electron effect.
  for (const alert of capAlerts(dir, r, state.capNotified)) {
    state.capNotified.set(alert.key, alert.resetsAt);
    const resetNote = alert.resetsAt
      ? ` · resets ${new Date(alert.resetsAt).toLocaleTimeString()}`
      : '';
    const note = new Notification({
      title: `ccmon · ${accountLabel(dir)} near cap`,
      body: `${alert.window} window at ${Math.round(alert.pct)}%${resetNote}`,
    });
    note.on('click', () => {
      if (!state.win) return;
      if (state.win.isMinimized()) state.win.restore();
      state.win.focus();
    });
    note.show();
    console.log(
      `[ccmon] cap alert: ${accountLabel(dir)} ${alert.window} ${Math.round(alert.pct)}%`,
    );
  }
}

async function refreshLimits(force = false): Promise<void> {
  if (state.limitsBusy) return;
  state.limitsBusy = true;
  try {
    // Live limits are polled for EVERY account, independent of the data
    // scope. The accounts dashboard and cross-account headroom compare all
    // logins at once, and the account about to cap may not be the one whose
    // usage history is currently scoped. Scope governs which usage the
    // SNAPSHOT shows; it never narrows which logins we check.
    // …but only for tools that HAVE a limits endpoint. OpenAI publishes none
    // reachable with a Codex credential, so polling a Codex home would report
    // "no stored login" — a Claude-shaped failure for an account that simply
    // has no such API. The card says "no usage limits published" instead.
    const dirs = state.sourceDirs.filter((d) => toolFor(d).id === 'claude');
    const now = Date.now();
    const results = await Promise.all(
      dirs.map(async (d) => {
        const bo = state.limitsBackoff.get(d);
        if (!force && bo && now < bo.nextAttemptAt) return null; // backing off — keep current entry
        // promo recordings (record.ts --demo) swap in synthetic limits so the
        // accounts dashboard renders without a real login; off in production.
        return process.env.CCMON_DEMO_LIMITS ? demoLimits(d, now) : fetchLiveLimits(d);
      }),
    );
    const limits: LimitsMap = {};
    dirs.forEach((d, i) => {
      const r = results[i];
      const prev = state.limits[d];
      if (r === null) {
        if (prev) limits[d] = prev;
        return;
      }
      if (r.ok) {
        const wasFailing = state.limitsBackoff.get(d);
        if (wasFailing) {
          console.log(
            `[ccmon] limits ${d}: recovered after ${wasFailing.failures} failed attempt${wasFailing.failures === 1 ? '' : 's'}`,
          );
        }
        state.limitsBackoff.delete(d);
        state.limitsHistory?.record(d, r);
        maybeNotifyCap(d, r);
        limits[d] = {
          ...r,
          history: state.limitsHistory?.uiSamples(d) ?? [],
          forecast: state.limitsHistory?.forecast(d) ?? null,
          caps: state.limitsHistory?.caps(d) ?? null,
        };
        return;
      }
      // accounts with no stored login are omitted entirely, as before
      if (r.error.startsWith('no stored login')) return;

      const prevBo = state.limitsBackoff.get(d);
      const failures = (prevBo?.failures ?? 0) + 1;
      // retry is FIXED at 1 minute — failures never widen the wait; only an
      // explicit server Retry-After longer than that can extend it. A failed
      // MANUAL retry keeps the existing schedule rather than resetting it.
      const delay = Math.max(LIMITS_RETRY_MS, r.retryAfterMs ?? 0);
      const nextAttemptAt =
        force && prevBo
          ? Math.max(prevBo.nextAttemptAt, r.retryAfterMs ? Date.now() + r.retryAfterMs : 0)
          : Date.now() + delay;
      state.limitsBackoff.set(d, { failures, nextAttemptAt });
      console.warn(
        `[ccmon] limits ${d}: ${r.error} — ${force ? 'manual attempt' : `attempt ${failures}`}, ` +
          `next automatic retry in ${Math.max(0, Math.round((nextAttemptAt - Date.now()) / 1000))}s` +
          (prev?.ok
            ? `, keeping data fetched ${new Date(prev.fetchedAt).toLocaleTimeString()}`
            : ''),
      );
      if (prev?.ok) {
        // serve the last good numbers, clearly marked stale + why
        limits[d] = {
          ...prev,
          stale: true,
          lastError: { error: r.error, at: r.at ?? Date.now() },
          nextRetryAt: nextAttemptAt,
        };
      } else {
        limits[d] = { ...r, nextRetryAt: nextAttemptAt };
      }
    });
    state.limits = limits;
    send('limits:data', limits);
    refreshTray();
  } finally {
    state.limitsBusy = false;
  }
}

/** Refresh display-currency rates; failures keep the last table (verbose). */
async function refreshCurrency(): Promise<void> {
  if (!state.currency) return;
  const info = await state.currency.refresh();
  if (info.lastError) console.warn('[ccmon] currency refresh failed:', info.lastError);
  send('currency:data', info);
}

// ---- DeepSeek balance (§5.7) --------------------------------------------
// DeepSeek is API-key billing: there is no plan, no quota endpoint, and no
// usage history — just a prepaid balance. So the interesting numbers are the
// ones ccmon measures itself by watching that balance fall.

/**
 * Native-currency amount → USD via the hourly rate table (`units per USD`),
 * or null when no rate is known. A DeepSeek balance is commonly denominated
 * in CNY, and every derived figure has to be USD to sit alongside snapshot
 * money (docs/v2-spec.md §5.4: everything internal stays USD).
 */
function deepseekToUSD(amount: number, currency: string): number | null {
  if (currency === 'USD') return amount;
  const rate = state.currency?.get().rates?.[currency];
  return typeof rate === 'number' && rate > 0 ? amount / rate : null;
}

/**
 * Transcript-derived DeepSeek cost over a time span, in USD.
 *
 * Deliberately UNSCOPED: a DeepSeek key bills one account regardless of which
 * config root the transcript landed in, so scoping this to the viewed
 * account(s) would compare a subset of spend against the whole balance drop
 * and manufacture drift. Walks `entries` backwards with an early break — the
 * span is hours, not the whole history, so this stays cheap enough to run on
 * the balance poll rather than needing its own aggregation pass.
 */
function deepseekCostBetween(fromTs: number, toTs: number): number {
  const pricing = state.pricing;
  if (!pricing) return 0;
  const mode = state.settings ? state.settings.get().costMode : 'auto';
  let total = 0;
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    // the early break is only sound while the array is in ts order; an
    // unsorted tail (pending recompute) falls back to a full walk
    if (e.ts < fromTs && state.sorted) break;
    if (e.ts < fromTs || e.ts > toTs) continue;
    if (!isDeepseekModel(e.model)) continue;
    total += costForMode(e, mode, pricing);
  }
  return total;
}

/** Attach the measured history/burn/runway/drift to a fresh ok result. */
function withDeepseekDerived(r: DeepseekResult): DeepseekResult {
  if (!r.ok || !state.deepseekHistory) return r;
  const derived = state.deepseekHistory.derive(r.primary, {
    toUSD: deepseekToUSD,
    computedUSD: deepseekCostBetween,
  });
  return { ...r, ...derived };
}

/**
 * Poll the DeepSeek balance. Same contract as the limits poll: keep the last
 * good numbers on screen (flagged `stale` with the reason and the next retry)
 * and retry on a FIXED cadence. No-ops without a configured key.
 */
async function refreshDeepseek(force = false): Promise<void> {
  if (state.deepseekBusy) return;
  const key = state.deepseekKey?.key();
  if (!key) {
    // a disconnect mid-session should clear the card, not freeze the last balance
    if (state.deepseek) {
      state.deepseek = null;
      send('deepseek:data', null);
    }
    return;
  }
  const bo = state.deepseekBackoff;
  if (!force && bo && Date.now() < bo.nextAttemptAt) return;

  state.deepseekBusy = true;
  try {
    const r = await fetchBalance(key);
    const prev = state.deepseek;
    if (r.ok) {
      if (bo) {
        console.log(
          `[ccmon] deepseek: recovered after ${bo.failures} failed attempt${bo.failures === 1 ? '' : 's'}`,
        );
      }
      state.deepseekBackoff = null;
      state.deepseekHistory?.record(r.primary);
      state.deepseek = withDeepseekDerived(r);
    } else {
      const failures = (bo?.failures ?? 0) + 1;
      const delay = Math.max(DEEPSEEK_RETRY_MS, r.retryAfterMs ?? 0);
      const nextAttemptAt =
        force && bo
          ? Math.max(bo.nextAttemptAt, r.retryAfterMs ? Date.now() + r.retryAfterMs : 0)
          : Date.now() + delay;
      state.deepseekBackoff = { failures, nextAttemptAt };
      console.warn(
        `[ccmon] deepseek: ${r.error} — ${force ? 'manual attempt' : `attempt ${failures}`}, ` +
          `next automatic retry in ${Math.max(0, Math.round((nextAttemptAt - Date.now()) / 1000))}s` +
          (prev?.ok
            ? `, keeping balance fetched ${new Date(prev.fetchedAt).toLocaleTimeString()}`
            : ''),
      );
      state.deepseek = prev?.ok
        ? {
            ...prev,
            stale: true,
            lastError: { error: r.error, at: r.at ?? Date.now() },
            nextRetryAt: nextAttemptAt,
          }
        : { ...r, nextRetryAt: nextAttemptAt };
    }
    send('deepseek:data', state.deepseek);
  } finally {
    state.deepseekBusy = false;
  }
}

/** Push the non-secret connection state (masked tail only — never the key). */
function pushDeepseekAuth(): DeepseekAuth {
  const auth = state.deepseekKey?.auth() ?? {
    connected: false,
    source: null,
    hint: null,
    encrypted: false,
    envDetected: false,
  };
  send('deepseek:auth', auth);
  return auth;
}

function startWatcher(): void {
  refreshSourceDirs();
  // watch EVERY discovered dir, hidden included: hiding is a view preference,
  // so unhiding has to bring the account back live rather than needing a
  // relaunch to start watching it again
  const watcher = new UsageWatcher({
    // TAGGED roots, never bare dirs: a bare string makes the watcher guess the
    // adapter, and guessing wrong reads a whole format with the wrong parser.
    dirs: state.allSourceRoots,
    timezone: state.settings?.get().timezone || null,
  });
  state.watcher = watcher;

  watcher.on('progress', (p) => {
    state.progress = p;
    send('usage:progress', p);
  });

  watcher.on('ready', ({ entries, files, ms }) => {
    state.entries = entries;
    state.sorted = true;
    state.dataEpoch++; // fresh entry array — a same-length rescan must not reuse the old slice
    state.status = 'ready';
    console.log(`[ccmon] indexed ${entries.length} entries from ${files} transcripts in ${ms}ms`);
    recompute();
  });

  watcher.on('entries', ({ entries }) => {
    // merged-only batches (entries: []) mutated already-indexed objects in
    // place — nothing to push or feed, but the snapshot must recompute
    const tail = state.entries[state.entries.length - 1];
    for (const e of entries) state.entries.push(e);
    if (tail && entries.some((e) => e.ts < tail.ts)) state.sorted = false;
    const scope = sourceScope();
    const visible = scope ? entries.filter((e) => scope.has(e.source ?? '')) : entries;
    if (visible.length && state.pricing) {
      const pricing = state.pricing;
      const mode = state.settings ? state.settings.get().costMode : 'auto';
      send(
        'usage:events',
        visible.slice(-25).map((e) => toFeedEvent(e, costForMode(e, mode, pricing))),
      );
    }
    scheduleRecompute();
  });

  watcher.on('reset', ({ reason }) => {
    console.log(`[ccmon] rescan: ${reason}`);
    state.entries = [];
    state.dataEpoch++; // drop the old slice along with the entries it referenced
    state.snapshot = null;
    state.status = 'scanning';
    state.progress = { scanned: 0, total: 0, entries: 0 };
    send('usage:reset', { reason });
  });

  watcher.on('error', (err) => console.error('[ccmon] watcher error:', err.stack || err.message));

  watcher.start().catch((err) => {
    console.error('[ccmon] initial scan failed:', err);
    state.status = 'error';
  });
}

function createWindow(): void {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const saved = loadState(stateFile, { width: 1280, height: 832 });

  const win = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    backgroundColor: '#131110',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Let Chromium throttle the renderer (animations, timers) while the window
      // is hidden/minimized — there's nothing to see. Data collection is
      // unaffected: the main process owns the pollers and pushes a fresh
      // snapshot every 60s, so the view is current the moment it's shown again.
      backgroundThrottling: true,
    },
  });

  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Close → hide, only when the user opted in AND there is a tray to restore
  // from. Without that second condition the app would become unreachable on a
  // desktop with no tray host. `state.quitting` distinguishes a real quit
  // (tray menu, Cmd-Q, SIGTERM) from a close, so Quit is never swallowed.
  win.on('close', (e) => {
    if (state.quitting) return;
    if (!state.settings?.get().closeToTray) return;
    if (!state.tray || state.tray.isDestroyed()) return;
    e.preventDefault();
    win.hide();
    notifyClosedToTray();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The renderer is a fixed local document and must never become a browser.
  // `setWindowOpenHandler` only covers NEW windows; a top-level navigation in
  // the existing one (a stray anchor, a redirect, injected markup) would swap
  // the app out for a remote page that still has the preload bridge attached.
  // Anything not the page we loaded is denied and, if it looks like a link the
  // user meant to follow, handed to the real browser instead.
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return; // in-page reload
    e.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
  trackState(win, stateFile);

  // Load failures surface through the window's own events (and a blank
  // window), not through these promises — but they must still be handled, or a
  // missing renderer bundle becomes an unhandled rejection instead of a log.
  const loaded = DEV_URL
    ? win.loadURL(DEV_URL)
    : win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  loaded.catch((err: unknown) => console.error('[ccmon] renderer failed to load:', err));
  if (DEV_URL) win.webContents.openDevTools({ mode: 'detach' });

  state.win = win;
  win.on('closed', () => {
    state.win = null;
  });
}

// ---- tray ---------------------------------------------------------------

/** Bring the window back, creating it if it was closed. */
function showWindow(): void {
  if (!state.win || state.win.isDestroyed()) {
    createWindow();
    return;
  }
  if (state.win.isMinimized()) state.win.restore();
  if (!state.win.isVisible()) state.win.show();
  state.win.focus();
}

/**
 * Tell the user, ONCE per run, where the window went. A window that vanishes
 * with no feedback reads as a crash; this is the one moment the behaviour needs
 * explaining, and repeating it every close would be nagging.
 */
let closedToTrayHintShown = false;
function notifyClosedToTray(): void {
  if (closedToTrayHintShown || !Notification.isSupported()) return;
  closedToTrayHintShown = true;
  new Notification({
    title: 'ccmon is still running',
    body: 'Closing the window hides it to the tray. Use the tray icon to reopen, or its Quit item to exit.',
  }).show();
}

/**
 * Create the tray icon, or do nothing if the platform has no usable tray (some
 * minimal Linux desktops ship no StatusNotifier host). A missing tray must never
 * be fatal — it is an ambient extra, not a requirement.
 */
function createTray(): void {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  try {
    // The source icon is 1024px; a tray wants ~16-22px, and passing the full
    // image gives an enormous or blank indicator depending on the platform.
    // The right size differs per OS: the Windows notification area draws at
    // 16px and the macOS menu bar at 16pt, so 22 there is downscaled by the
    // shell and comes out fuzzy. Linux panels are the ones that want ~22.
    const px = process.platform === 'linux' ? 22 : 16;
    const image = nativeImage
      .createFromPath(iconPath)
      .resize({ width: px, height: px, quality: 'best' });
    if (image.isEmpty()) {
      console.warn(`[ccmon] tray disabled: could not load ${iconPath}`);
      return;
    }
    state.tray = new Tray(image);
    state.tray.on('click', showWindow); // Windows/macOS
    state.tray.on('double-click', showWindow);
    refreshTray();
    console.log('[ccmon] tray ready');
  } catch (err) {
    // Logged, never thrown: a desktop with no StatusNotifier host is a normal
    // environment, and the app is fully usable without an indicator.
    console.warn(`[ccmon] tray unavailable: ${(err as Error).message}`);
  }
}

/**
 * Push the current numbers into the tray. Cheap and idempotent, so it can be
 * called from every path that changes what the tray shows (recompute, limits
 * poll) without any coordination.
 *
 * On Linux the menu is the ONLY readable surface — `setTitle` is macOS-only and
 * tooltips are unreliable across desktops — so the numbers go in as disabled
 * menu rows rather than living only in the tooltip.
 */
function refreshTray(): void {
  const tray = state.tray;
  if (!tray || tray.isDestroyed()) return;
  const { tooltip, lines, title } = trayText(
    state.snapshot,
    state.limits,
    accountLabel,
    Date.now(),
    !!state.settings?.get().privacyMode,
  );

  tray.setToolTip(tooltip);
  if (process.platform === 'darwin') tray.setTitle(title);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...lines.map((label) => ({ label, enabled: false })),
      { type: 'separator' as const },
      { label: 'Open ccmon', click: showWindow },
      { label: 'Refresh now', click: () => void refreshLimits(true) },
      { type: 'separator' as const },
      {
        label: 'Quit',
        click: () => {
          state.quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('app:getState', (): AppState => ({
  version: app.getVersion(),
  status: state.status,
  progress: state.progress,
  sourceDirs: state.sourceDirs,
  allSourceDirs: state.allSourceDirs,
  snapshot: state.snapshot,
  configPath: CONFIG_PATH,
  aliases: (() => {
    const cfg = loadConfig();
    return { models: cfg.modelAliases || {}, projects: cfg.projectAliases || {} };
  })(),
  settings: state.settings ? state.settings.get() : null,
  pricingMeta: state.pricingMeta,
  accounts: state.accounts,
  limits: state.limits,
  currency: state.currency ? state.currency.get() : null,
  deepseek: state.deepseek,
  deepseekAuth: state.deepseekKey
    ? state.deepseekKey.auth()
    : { connected: false, source: null, hint: null, encrypted: false, envDetected: false },
}));

ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => {
  if (!state.settings) return null;
  const before = state.settings.get();
  const next = state.settings.patch(partial || {});
  send('settings:changed', next);
  const sourcesChanged =
    JSON.stringify(before.sources ?? null) !== JSON.stringify(next.sources ?? null);
  // Hiding/unhiding an account changes which dirs exist as far as the rest of
  // the app is concerned, so the visible list, the account map and the live
  // limits all have to follow — not just the snapshot.
  const visibilityChanged = applyVisibility();
  if (visibilityChanged) {
    state.accounts = accountsFor(state.sourceDirs);
    send('accounts:data', {
      sourceDirs: state.sourceDirs,
      allSourceDirs: state.allSourceDirs,
      accounts: state.accounts,
    });
    void refreshLimits(true);
  }
  // A zone change re-buckets which day every message counts against. Entries
  // carry their dateKey (so pricing/aggregation never re-derive it per pass), so
  // re-stamp them in ONE pass rather than rescanning ~100k lines from disk.
  // privacy is display-only, so no recompute — but the tray renders money and
  // must follow immediately or the toggle appears not to work
  if (before.privacyMode !== next.privacyMode) refreshTray();
  const zoneChanged = (before.timezone || '') !== (next.timezone || '');
  if (zoneChanged) {
    const zone = next.timezone || null;
    for (const e of state.entries) e.dateKey = dayKeyFor(e.ts, zone);
    state.watcher?.setTimezone(zone); // lines parsed from here on match
    state.dataEpoch += 1; //            invalidate scopedData's memo
    console.log(
      `[ccmon] timezone → ${next.timezone || 'system'}, re-stamped ${state.entries.length} entries`,
    );
  }
  // Analytics semantics changed → rebuild the snapshot from the same entries.
  if (
    before.costMode !== next.costMode ||
    before.startOfWeek !== next.startOfWeek ||
    before.tokenLimit !== next.tokenLimit ||
    (before.blockHours ?? null) !== (next.blockHours ?? null) ||
    zoneChanged ||
    sourcesChanged ||
    visibilityChanged
  ) {
    scheduleRecompute();
  }
  // Live limits are account-wide, not scoped — a scope change only re-buckets
  // the snapshot, so there's no need to re-poll the usage endpoint here.
  return next;
});

ipcMain.handle('limits:refresh', async () => {
  await refreshLimits(true); // user asked — bypass any backoff
  return state.limits;
});

// ---- user-initiated re-login (auth.ts) — NEVER the background poller. Tries a
// silent refresh-token grant; only a dead refresh token opens the browser. Both
// paths persist the rotated tokens back so Claude Code stays logged in. -------
ipcMain.handle('auth:login', async (_e, projectDir: string): Promise<LoginResult> => {
  if (!state.sourceDirs.includes(projectDir)) return { status: 'error', error: 'unknown account' };
  const r = await refreshLogin(projectDir);
  if (r.ok) {
    state.pendingLogins.delete(projectDir);
    state.accounts = accountsFor(state.sourceDirs); // a first-time login flips hasCredentials
    console.log(
      `[ccmon] auth ${projectDir}: refreshed, expires ${new Date(r.expiresAt).toLocaleString()}`,
    );
    await refreshLimits(true);
    return { status: 'refreshed' };
  }
  if (!r.needsBrowser) {
    console.warn(`[ccmon] auth ${projectDir}: ${r.error}`);
    return { status: 'error', error: r.error };
  }
  // refresh token is dead → hand off to the browser PKCE flow
  const { url, pending } = beginBrowserLogin(projectDir);
  state.pendingLogins.set(projectDir, pending);
  void shell.openExternal(url);
  console.log(`[ccmon] auth ${projectDir}: opened browser login`);
  return { status: 'awaiting-code' };
});

ipcMain.handle(
  'auth:submitCode',
  async (_e, projectDir: string, code: string): Promise<LoginCodeResult> => {
    const pending = state.pendingLogins.get(projectDir);
    if (!pending) return { ok: false, error: 'no login in progress — click Log in again' };
    const r = await completeBrowserLogin(projectDir, pending, code);
    if (r.ok) {
      state.pendingLogins.delete(projectDir);
      state.accounts = accountsFor(state.sourceDirs); // a first-time login flips hasCredentials
      console.log(`[ccmon] auth ${projectDir}: browser login complete`);
      await refreshLimits(true);
      return { ok: true };
    }
    console.warn(`[ccmon] auth ${projectDir}: ${r.error}`);
    return { ok: false, error: r.error };
  },
);

// AI usage advisor — reuses a chosen account's Claude Code login (the renderer
// picks one with headroom; defaults to primary) read-only, never refreshed
// here, and sends ONLY snapshot aggregates, no transcripts.
ipcMain.handle(
  'advisor:ask',
  async (
    _e,
    question: string,
    history: AdvisorMessage[],
    reqDir?: string,
  ): Promise<AdvisorResult> => {
    if (typeof question !== 'string' || !question.trim()) {
      return { ok: false, error: 'empty question' };
    }
    if (!state.snapshot) return { ok: false, error: 'no usage data yet — let the scan finish' };
    // honour an explicit account choice (must be a known source dir), else
    // fall back to the primary account
    const dir =
      typeof reqDir === 'string' && state.sourceDirs.includes(reqDir) ? reqDir : primaryDir();
    const creds = dir ? readOauth(dir) : null;
    if (!creds?.accessToken) {
      return {
        ok: false,
        error: 'no Claude Code login found — sign in on the accounts view first',
      };
    }
    if (creds.expiresAt && creds.expiresAt < Date.now() + 60_000) {
      return { ok: false, error: 'the Claude Code login is expired — use "Log in" to refresh it' };
    }
    const context = buildUsageContext(state.snapshot, state.limits, state.accounts);
    return askAdvisor({
      token: creds.accessToken,
      model: state.settings ? state.settings.get().aiModel : 'claude-sonnet-4-6',
      question: question.slice(0, 2000),
      history: Array.isArray(history) ? history.slice(-12) : [],
      context,
    });
  },
);

ipcMain.handle('currency:refresh', async () => {
  await refreshCurrency();
  return state.currency ? state.currency.get() : null;
});

// ---- DeepSeek balance: connect / disconnect / refresh --------------------
// The key crosses this bridge exactly once, inbound, and is never echoed
// back — `deepseek:auth` carries a masked 4-char tail and nothing more.

ipcMain.handle('deepseek:getAuth', (): DeepseekAuth => pushDeepseekAuth());

ipcMain.handle('deepseek:connect', async (_e, key?: string): Promise<DeepseekAuthResult> => {
  if (!state.deepseekKey) return { ok: false, error: 'key store unavailable' };
  // no key argument = "adopt the one you detected in my environment"; main
  // reads it here so a detected key never crosses the bridge just to be saved
  const value = (typeof key === 'string' ? key.trim() : '') || envKey() || '';
  if (!value) return { ok: false, error: 'paste a DeepSeek API key first' };
  if (!looksLikeKey(value)) {
    return { ok: false, error: 'that does not look like an API key — check for a truncated paste' };
  }
  // Verify BEFORE persisting: a key that can't read a balance is worthless to
  // ccmon, and storing it would leave a broken connection that only surfaces
  // five minutes later on the first poll.
  const probe = await fetchBalance(value);
  if (!probe.ok) return { ok: false, error: probe.error };
  try {
    state.deepseekKey.save(value);
  } catch (err) {
    return { ok: false, error: `could not save the key: ${(err as Error).message}` };
  }
  state.deepseekBackoff = null;
  state.deepseekHistory?.record(probe.primary);
  state.deepseek = withDeepseekDerived(probe);
  const auth = pushDeepseekAuth();
  send('deepseek:data', state.deepseek);
  console.log(
    `[ccmon] deepseek: connected ${auth.hint}${auth.encrypted ? '' : ' (unencrypted — no OS keyring)'}`,
  );
  return { ok: true };
});

ipcMain.handle('deepseek:disconnect', (): DeepseekAuthResult => {
  if (!state.deepseekKey) return { ok: false, error: 'key store unavailable' };
  state.deepseekKey.clear();
  // the balance history is account data — a disconnect should not leave the
  // next key's runway computed against a stranger's balance curve
  state.deepseekHistory?.clear();
  state.deepseek = null;
  state.deepseekBackoff = null;
  const auth = pushDeepseekAuth();
  send('deepseek:data', null);
  console.log('[ccmon] deepseek: disconnected');
  // an env key that was being overridden takes over again — poll it now so
  // the card doesn't sit empty until the next tick
  if (auth.connected) void refreshDeepseek(true);
  return { ok: true };
});

ipcMain.handle('deepseek:refresh', async (): Promise<DeepseekResult | null> => {
  await refreshDeepseek(true); // user asked — bypass any backoff
  return state.deepseek;
});

// global analytics time range — re-scopes the snapshot's historical body. A
// user action, so force a recompute and push the re-scoped snapshot.
ipcMain.handle('usage:setRange', (_e, range: TimeRange) => {
  const preset = range?.preset;
  const valid = ['today', '7d', '30d', '90d', 'month', 'lastMonth', 'all', 'custom'];
  if (!preset || !valid.includes(preset)) return;
  state.range = {
    preset,
    customStart: typeof range.customStart === 'string' ? range.customStart : null,
    customEnd: typeof range.customEnd === 'string' ? range.customEnd : null,
  };
  recompute(true);
});

// on-demand "why was this day expensive" — recomputed from the scoped entries
// so it never bloats the snapshot, and tracks the same scope the views show
ipcMain.handle('insights:dayBreakdown', (_e, dateKey: string): DayBreakdown | null => {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const { entries, compactions } = scopedData();
  return dayBreakdown(entries, dateKey, {
    timezone: state.settings?.get().timezone || null,
    pricing: state.pricing,
    costMode: state.settings ? state.settings.get().costMode : 'auto',
    compactions,
  });
});

// export a snapshot table to CSV via a native save dialog
ipcMain.handle('export:csv', async (_e, kind: ExportKind): Promise<ExportResult> => {
  const valid: ExportKind[] = ['days', 'sessions', 'projects', 'models'];
  if (!valid.includes(kind)) return { ok: false, error: 'unknown export kind' };
  if (!state.snapshot) return { ok: false, error: 'no data to export yet' };
  const { csv, rows } = snapshotToCsv(state.snapshot, kind);
  const stamp = new Date().toISOString().slice(0, 10);
  const opts = {
    title: `Export ${kind} as CSV`,
    defaultPath: `ccmon-${kind}-${stamp}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  };
  const res = state.win
    ? await dialog.showSaveDialog(state.win, opts)
    : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, csv, 'utf8');
    console.log(`[ccmon] exported ${rows} ${kind} rows → ${res.filePath}`);
    return { ok: true, path: res.filePath, rows };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('sessions:recent', (_e, projectDir: string, limit?: number) => {
  // only read roots we already discovered — never an arbitrary path from the UI
  if (!state.sourceDirs.includes(projectDir)) return [];
  return recentSessions(projectDir, typeof limit === 'number' ? limit : undefined);
});

// ---- multi-account setup wizard (writes shell rc — gated by an explicit
// apply in the UI, which always previews the exact diff first) -------------
/**
 * Resolve `${ccmon:…}` env references in wrapper specs. `reveal` decides what
 * a known secret becomes: the real value when we are about to WRITE it, and a
 * masked stand-in when the result is only going to be rendered — `planSetup`'s
 * script is shown on screen, and a preview that prints your API key defeats
 * the point of storing it encrypted. Unknown names resolve to null, which
 * `validateAccounts` turns into a blocking problem.
 */
function withSecrets(accounts: AccountSpec[], reveal: boolean): AccountSpec[] {
  return resolveEnvSecrets(accounts, (name) => {
    if (name !== 'deepseek-key') return null;
    const key = state.deepseekKey?.key() ?? null;
    if (!key) return null;
    return reveal ? key : `${'•'.repeat(8)}${key.slice(-4)}`;
  });
}

ipcMain.handle('setup:detectShells', () => detectShells());
ipcMain.handle('setup:preview', (_e, opts: SetupOptions) =>
  planSetup({ ...opts, accounts: withSecrets(opts.accounts, false) }),
);
ipcMain.handle('setup:apply', (_e, opts: SetupOptions) =>
  applySetup({ ...opts, accounts: withSecrets(opts.accounts, true) }),
);
ipcMain.handle('setup:createAccount', (_e, suffix: string, tool: ToolId = 'claude') => {
  const res = createAccountDir(suffix, tool);
  if (res.ok) {
    // re-detect so the new root shows up immediately (live file-watching of it
    // still needs a relaunch; a brand-new account has nothing to watch yet)
    refreshSourceDirs();
    void refreshLimits(true);
  }
  return res;
});
ipcMain.handle('setup:renameAccount', (_e, root: string, suffix: string) => {
  // Every data dir of this tool, not just `projects`: a Codex home carries
  // `sessions` AND `archived_sessions`, and migrating only one would leave the
  // other named by its pre-rename path in the saved scope.
  const dataDirs = toolForRoot(root).dataDirs;
  const oldDirs = dataDirs.map((d) => path.join(root, d));
  const res = renameAccountDir(root, suffix);
  if (res.ok) {
    // same as setup:createAccount — re-detect so the renamed root shows up
    // immediately; live file-watching of it still needs a relaunch
    refreshSourceDirs();
    void refreshLimits(true);

    const renamed = new Map(oldDirs.map((old, i) => [old, path.join(res.root, dataDirs[i])]));
    for (const [old, next] of renamed) state.limitsHistory?.renameDir(old, next);

    // a saved scope (settings.sources) can still name a pre-rename dir —
    // migrate it so the renamed account doesn't silently drop out of the
    // overview/insights views after a restart
    const settings = state.settings;
    const sources = settings?.get().sources;
    if (settings && Array.isArray(sources) && sources.some((d) => renamed.has(d))) {
      const next = settings.patch({ sources: sources.map((d) => renamed.get(d) ?? d) });
      send('settings:changed', next);
    }
  }
  return res;
});
ipcMain.handle('setup:updateWrapperAccounts', (_e, accounts: AccountSpec[]) =>
  writeWrapperAccounts(withSecrets(accounts, true)),
);

ipcMain.handle('pricing:refresh', async () => {
  if (!state.pricing) return null;
  await state.pricing.refresh(); // never rejects; failures land in meta().lastError
  pushPricingMeta();
  if (state.pricingMeta?.lastError) {
    console.warn('[ccmon] pricing refresh failed:', state.pricingMeta.lastError);
  }
  scheduleRecompute();
  return state.pricingMeta;
});

ipcMain.handle('usage:rescan', () => {
  state.watcher?.requestRescan('manual rescan');
  return true;
});

ipcMain.handle('app:openDataDir', () => {
  if (state.sourceDirs[0]) void shell.openPath(state.sourceDirs[0]);
});

ipcMain.on('app:openUrl', (_e, url: string) => {
  if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url);
});

ipcMain.on('window:minimize', () => state.win?.minimize());
ipcMain.on('window:maximize', () => {
  const w = state.win;
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.on('window:close', () => state.win?.close());

// ---- lifecycle ----------------------------------------------------------

app.on('second-instance', () => {
  if (state.win) {
    if (state.win.isMinimized()) state.win.restore();
    state.win.focus();
  }
});

void app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  state.settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  state.limitsHistory = new LimitsHistory(
    path.join(app.getPath('userData'), 'limits-history.json'),
  );
  state.currency = new CurrencyService(app.getPath('userData'));
  // safeStorage is only usable after `ready`; wrapping it here is what keeps
  // the key store itself a pure-Node service (electron/services never imports
  // Electron — see docs/v2-spec.md §7)
  const keyCrypto: KeyCrypto = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf),
  };
  state.deepseekKey = new DeepseekKeyStore(
    path.join(app.getPath('userData'), 'deepseek-key.json'),
    keyCrypto,
  );
  state.deepseekHistory = new DeepseekHistory(
    path.join(app.getPath('userData'), 'deepseek-history.json'),
  );
  createWindow();
  createTray();

  const cfg = loadConfig();
  state.pricing = await createPricingEngine({
    cacheDir: app.getPath('userData'),
    offline: state.settings.get().pricingOffline,
    overrides: cfg.pricing || {},
    archive: new PricingArchive(app.getPath('userData')),
  });
  pushPricingMeta();
  // The engine resolves from bundled data instantly and refreshes from the
  // network in the background — pick up the refreshed meta a bit later.
  setTimeout(pushPricingMeta, 20000);

  startWatcher();
  void refreshLimits();
  // the balance is quoted in the account's own currency (often CNY), so the
  // rate table has to land before burn/runway can be expressed in USD
  void refreshCurrency().then(() => refreshDeepseek());

  setInterval(() => {
    if (state.status === 'ready') recompute();
  }, PERIODIC_REFRESH_MS);
  setInterval(() => void refreshLimits(), LIMITS_REFRESH_MS);
  setInterval(() => void refreshCurrency(), CURRENCY_REFRESH_MS);
  setInterval(() => void refreshDeepseek(), DEEPSEEK_REFRESH_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// With closeToTray on, the window is HIDDEN rather than destroyed, so this
// never fires in that mode — it stays the quit path for the default behaviour
// and for the case where the tray vanished and the close went through.
app.on('window-all-closed', () => {
  // macOS keeps the app alive with no window — Cmd-W is "close this window",
  // not "quit", and the dock icon (plus the `activate` handler above, which
  // would otherwise be dead code) is how you get it back. Quitting here would
  // also throw away the tray and the pollers on a plain window close.
  if (process.platform === 'darwin') return;
  state.quitting = true;
  app.quit();
});

// `before-quit` covers the quit paths that don't go through the tray menu —
// Cmd-Q, the dock, a session logout, SIGTERM — so the close handler yields.
app.on('before-quit', () => {
  state.quitting = true;
});
