/**
 * @file main.ts
 * @brief Electron main process — window, IPC, and service wiring (watcher, pricing, limits, currency).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { app, BrowserWindow, ipcMain, shell, Menu, Notification, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { detectProjectDirs } from './services/paths';
import { localDateKey } from './services/parser';
import { loadConfig, CONFIG_PATH } from './services/config';
import { Settings } from './services/settings';
import { createPricingEngine, costForMode, type PricingEngine } from './services/pricing';
import { PricingArchive } from './services/pricing-archive';
import { UsageWatcher } from './services/watcher';
import { buildSnapshot, dayBreakdown, toFeedEvent } from './services/aggregate';
import { accountsFor, demoLimits, fetchLiveLimits } from './services/accounts';
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
import { applySetup, createAccountDir, detectShells, planSetup } from './services/account-setup';
import { LimitsHistory } from './services/limits-history';
import { CurrencyService } from './services/currency';
import { loadState, trackState } from './services/window-state';
import type {
  AccountsMap,
  AppSettings,
  AdvisorMessage,
  AdvisorResult,
  CompactMarker,
  DayBreakdown,
  ExportKind,
  ExportResult,
  LimitsMap,
  ToolResultMarker,
  LimitsResult,
  LimitWindow,
  LoginCodeResult,
  LoginResult,
  PricingMeta,
  SetupOptions,
  Snapshot,
  TimeRange,
  UsageEntry,
} from '../shared/types';
import { resolveRange } from '../shared/range';
import type { AppState, AppStatus, ScanProgress } from '../shared/ipc';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RECOMPUTE_DEBOUNCE_MS = 250;
const PERIODIC_REFRESH_MS = 60000; // day rollover / block expiry without events
const LIMITS_REFRESH_MS = 60_000; // live plan-limits poll
const LIMITS_RETRY_MS = 60_000; // FIXED retry after a limits failure — no exponential growth
const CURRENCY_REFRESH_MS = 3_600_000; // hourly display-currency rates
const CAP_ALERT_PCT = 90; // opt-in OS notification threshold for a live window

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

interface MainState {
  win: BrowserWindow | null;
  watcher: UsageWatcher | null;
  settings: Settings | null;
  pricing: PricingEngine | null;
  pricingMeta: PricingMeta | null;
  entries: UsageEntry[];
  sorted: boolean;
  snapshot: Snapshot | null;
  status: AppStatus;
  progress: ScanProgress;
  sourceDirs: string[];
  recomputeTimer: NodeJS.Timeout | null;
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
  /** in-flight browser logins (PKCE state) keyed by source dir */
  pendingLogins: Map<string, PendingLogin>;
  /** `<dir>:<window>` → the resetsAt we last alerted on (re-alert only after a reset) */
  capNotified: Map<string, number>;
  /** global analytics time range driving the snapshot's historical body */
  range: TimeRange;
}

const state: MainState = {
  win: null,
  watcher: null,
  settings: null, // Settings instance, created on ready
  pricing: null, //  pricing engine, created on ready
  pricingMeta: null,
  entries: [],
  sorted: true,
  snapshot: null,
  status: 'scanning',
  progress: { scanned: 0, total: 0, entries: 0 },
  sourceDirs: [],
  recomputeTimer: null,
  lastRecomputeSig: null,
  accounts: {},
  limits: {},
  limitsBusy: false,
  limitsBackoff: new Map(),
  limitsHistory: null,
  currency: null,
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
function primaryDir(): string | null {
  return (
    state.sourceDirs.find((d) => /[\\/]\.claude[\\/]projects$/.test(d)) ||
    state.sourceDirs[0] ||
    null
  );
}

/**
 * Active source scope as a Set of project-dir paths, or null for "all".
 * No saved choice (sources: null) defaults to the PRIMARY account only —
 * extra roots like ~/.claude-work are opt-in. Stale selections (renamed or
 * removed dirs) fall back to the default so the app never filters itself
 * down to an empty dataset.
 */
function sourceScope(): Set<string> | null {
  const sel = state.settings ? state.settings.get().sources : null;
  if (Array.isArray(sel) && sel.length) {
    const live = sel.filter((d) => state.sourceDirs.includes(d));
    if (live.length === state.sourceDirs.length) return null; // explicit all
    if (live.length) return new Set(live);
  }
  if (state.sourceDirs.length > 1) {
    const p = primaryDir();
    if (p) return new Set([p]);
  }
  return null;
}

/** Entries + markers under the current data scope (shared by the recompute and
 *  the on-demand day drill-down so both see the same slice). */
function scopedData(): {
  entries: UsageEntry[];
  compactions: CompactMarker[];
  toolResults: ToolResultMarker[];
} {
  const scope = sourceScope();
  const entries = scope ? state.entries.filter((e) => scope.has(e.source ?? '')) : state.entries;
  const allC = state.watcher ? state.watcher.compactions : [];
  const compactions = scope ? allC.filter((c) => scope.has(c.source ?? '')) : allC;
  const allT = state.watcher ? state.watcher.toolResults : [];
  const toolResults = scope ? allT.filter((t) => scope.has(t.source ?? '')) : allT;
  return { entries, compactions, toolResults };
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
  const s = state.settings?.get();
  const last = state.entries[state.entries.length - 1];
  const active = !!state.snapshot?.block;
  return [
    state.entries.length,
    last?.key ?? '',
    s ? `${s.costMode}|${s.startOfWeek}|${s.tokenLimit}|${(s.sources || []).join(',')}` : '',
    state.pricingMeta?.fetchedAt ?? 0,
    state.pricingMeta?.source ?? '',
    state.watcher?.resetTs ?? 0,
    localDateKey(now),
    active ? Math.floor(now / 60_000) : 'idle',
    `${state.range.preset}|${state.range.customStart ?? ''}|${state.range.customEnd ?? ''}`,
  ].join('§');
}

function recompute(force = false): void {
  if (state.recomputeTimer) clearTimeout(state.recomputeTimer);
  state.recomputeTimer = null;
  if (!state.sorted) {
    state.entries.sort((a, b) => a.ts - b.ts);
    state.sorted = true;
  }
  const now = Date.now();
  const sig = recomputeSig(now);
  // periodic ticks that change nothing material skip the full reduce; the data
  // path (new/merged entries, settings, pricing, scope) always passes force
  if (!force && state.snapshot && sig === state.lastRecomputeSig) return;
  state.lastRecomputeSig = sig;
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
    // per-account spend is scope-INDEPENDENT (every login), like live limits
    accountEntries: state.entries,
    // global analytics range scopes the historical body (not account spend)
    range: resolveRange(state.range, now),
  });
  send('usage:snapshot', state.snapshot);
}

function pushPricingMeta(): void {
  if (!state.pricing) return;
  state.pricingMeta = state.pricing.meta();
  send('pricing:meta', state.pricingMeta);
}

function scheduleRecompute(): void {
  if (!state.recomputeTimer) {
    // the debounced path is always a real input change (entries/settings/
    // pricing/scope) — force past the no-op elision guard
    state.recomputeTimer = setTimeout(() => recompute(true), RECOMPUTE_DEBOUNCE_MS);
  }
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
function accountLabel(dir: string): string {
  const root = path.basename(path.dirname(dir));
  if (root === '.claude') return 'default';
  return root.replace(/^\.claude-?/, '') || root;
}

/**
 * Opt-in OS notification when an account crosses ~90% of a live window. Fires
 * at most once per window per reset cycle (keyed on resetsAt) so it never spams
 * the 60s poll; a fresh window (new resetsAt) re-arms the alert. Clicking it
 * focuses the app. No-op unless the setting is on and the OS supports it.
 */
function maybeNotifyCap(dir: string, r: LimitsResult): void {
  if (!r.ok || process.env.CCMON_DEMO_LIMITS) return;
  if (!state.settings?.get().notifyNearCap || !Notification.isSupported()) return;
  const windows: Array<{ name: string; win: LimitWindow | null | undefined }> = [
    { name: 'session', win: r.session },
    { name: 'week', win: r.week },
  ];
  for (const { name, win } of windows) {
    if (win?.pct == null || win.pct < CAP_ALERT_PCT) continue;
    const key = `${dir}:${name}`;
    const resetsAt = win.resetsAt ?? 0;
    if (state.capNotified.get(key) === resetsAt) continue; // already alerted this cycle
    state.capNotified.set(key, resetsAt);
    const resetNote = win.resetsAt ? ` · resets ${new Date(win.resetsAt).toLocaleTimeString()}` : '';
    const note = new Notification({
      title: `ccmon · ${accountLabel(dir)} near cap`,
      body: `${name} window at ${Math.round(win.pct)}%${resetNote}`,
    });
    note.on('click', () => {
      if (!state.win) return;
      if (state.win.isMinimized()) state.win.restore();
      state.win.focus();
    });
    note.show();
    console.log(`[ccmon] cap alert: ${accountLabel(dir)} ${name} ${Math.round(win.pct)}%`);
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
    const dirs = state.sourceDirs;
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
          (prev?.ok ? `, keeping data fetched ${new Date(prev.fetchedAt).toLocaleTimeString()}` : ''),
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

function startWatcher(): void {
  const cfg = loadConfig();
  state.sourceDirs = detectProjectDirs(cfg.claudeDirs || []);
  state.accounts = accountsFor(state.sourceDirs);
  const watcher = new UsageWatcher({ dirs: state.sourceDirs });
  state.watcher = watcher;

  watcher.on('progress', (p) => {
    state.progress = p;
    send('usage:progress', p);
  });

  watcher.on('ready', ({ entries, files, ms }) => {
    state.entries = entries;
    state.sorted = true;
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
      backgroundThrottling: false,
    },
  });

  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  trackState(win, stateFile);

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  state.win = win;
  win.on('closed', () => {
    state.win = null;
  });
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('app:getState', (): AppState => ({
  version: app.getVersion(),
  status: state.status,
  progress: state.progress,
  sourceDirs: state.sourceDirs,
  snapshot: state.snapshot,
  configPath: CONFIG_PATH,
  settings: state.settings ? state.settings.get() : null,
  pricingMeta: state.pricingMeta,
  accounts: state.accounts,
  limits: state.limits,
  currency: state.currency ? state.currency.get() : null,
}));

ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => {
  if (!state.settings) return null;
  const before = state.settings.get();
  const next = state.settings.patch(partial || {});
  send('settings:changed', next);
  const sourcesChanged =
    JSON.stringify(before.sources ?? null) !== JSON.stringify(next.sources ?? null);
  // Analytics semantics changed → rebuild the snapshot from the same entries.
  if (
    before.costMode !== next.costMode ||
    before.startOfWeek !== next.startOfWeek ||
    before.tokenLimit !== next.tokenLimit ||
    sourcesChanged
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
    console.log(`[ccmon] auth ${projectDir}: refreshed, expires ${new Date(r.expiresAt).toLocaleString()}`);
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
  async (_e, question: string, history: AdvisorMessage[], reqDir?: string): Promise<AdvisorResult> => {
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
      return { ok: false, error: 'no Claude Code login found — sign in on the accounts view first' };
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
ipcMain.handle('setup:detectShells', () => detectShells());
ipcMain.handle('setup:preview', (_e, opts: SetupOptions) => planSetup(opts));
ipcMain.handle('setup:apply', (_e, opts: SetupOptions) => applySetup(opts));
ipcMain.handle('setup:createAccount', (_e, suffix: string) => {
  const res = createAccountDir(suffix);
  if (res.ok) {
    // re-detect so the new root shows up immediately (live file-watching of it
    // still needs a relaunch; a brand-new account has nothing to watch yet)
    const cfg = loadConfig();
    state.sourceDirs = detectProjectDirs(cfg.claudeDirs || []);
    state.accounts = accountsFor(state.sourceDirs);
    void refreshLimits(true);
  }
  return res;
});

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
  state.limitsHistory = new LimitsHistory(path.join(app.getPath('userData'), 'limits-history.json'));
  state.currency = new CurrencyService(app.getPath('userData'));
  createWindow();

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
  void refreshCurrency();

  setInterval(() => {
    if (state.status === 'ready') recompute();
  }, PERIODIC_REFRESH_MS);
  setInterval(() => void refreshLimits(), LIMITS_REFRESH_MS);
  setInterval(() => void refreshCurrency(), CURRENCY_REFRESH_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
