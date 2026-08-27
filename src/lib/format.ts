/**
 * @file format.ts
 * @brief Formatting helpers plus the display-currency engine (fiat and crypto).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

const INT = new Intl.NumberFormat('en-US');

type Numeric = number | null | undefined;

// ---- display currency (docs/v2-spec.md §5) ---------------------------------
// All stored values are USD; conversion happens here at FORMAT time so the
// snapshot stays single-currency. bootstrap calls configureCurrency() when
// settings.currency or the hourly rates change, then re-emits the snapshot
// so subscribers re-render with the new formatters.

import { aliasFor, type AliasMap } from '../../shared/aliases';

/** Crypto display symbols — these codes can't go through Intl currency style. */
export const CRYPTO_SYMBOLS: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  USDT: 'USDT ',
  XRP: 'XRP ',
  BNB: 'BNB ',
  SOL: 'SOL ',
  USDC: 'USDC ',
  DOGE: 'DOGE ',
  ADA: 'ADA ',
  TRX: 'TRX ',
};

const fmt0 = (code: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 });
const fmt2 = (code: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const symbolOf = (f: Intl.NumberFormat) =>
  f.formatToParts(0).find((p) => p.type === 'currency')?.value || '$';

/** Significant-digit formatters for crypto amounts (0.0926 ₿ · 12,832 XRP). */
const SIG5 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 5 });
const SIG3 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });

let curCode = 'USD';
let curRate = 1;
let curCrypto = false;
let cur0 = fmt0('USD');
let cur2 = fmt2('USD');
let curSym = symbolOf(cur2);

/** Retarget the money formatters. Returns true when anything changed. */
export function configureCurrency(code: string, rate: number): boolean {
  if (code === curCode && rate === curRate) return false;
  if (CRYPTO_SYMBOLS[code]) {
    curSym = CRYPTO_SYMBOLS[code];
    curCrypto = true;
    curCode = code;
    curRate = rate;
    return true;
  }
  try {
    const f0 = fmt0(code);
    const f2 = fmt2(code);
    cur0 = f0;
    cur2 = f2;
    const sym = symbolOf(f2);
    curSym = /[A-Za-z]$/.test(sym) ? `${sym} ` : sym; // letter symbols read better spaced
    curCrypto = false;
    curCode = code;
    curRate = rate;
  } catch {
    /* unknown ISO code — keep the current currency */
  }
  return true;
}

export const currencyCode = (): string => curCode;
/** Bare symbol for metric labels ('$ / mtok out') — no trailing space. */
export const currencySymbol = (): string => curSym.trim() || curCode;

// ---- privacy mode ----------------------------------------------------------
// Blanks every MONEY figure at format time for screenshots, streams and
// shoulder-surfing. Token counts, model names and timings stay visible: the
// point is to hide spend, not to make the app useless. Nothing stored or
// computed changes, so toggling it back reveals the real numbers instantly.
//
// Masked at the formatter rather than per-component so a new panel cannot
// accidentally leak a dollar figure by forgetting to check a flag.

let privacy = false;
/** Placeholder wide enough to keep table columns from jumping. */
const MASK = '•••';

/** Turn masking on/off. Returns true when the value actually changed. */
export function configurePrivacy(on: boolean): boolean {
  if (privacy === on) return false;
  privacy = on;
  return true;
}

/** Whether money is currently masked — for a UI affordance saying so. */
export const isPrivate = (): boolean => privacy;

export const fmtUSD = (v: Numeric): string => {
  if (privacy) return curSym + MASK;
  const n = (v || 0) * curRate;
  if (curCrypto) return curSym + SIG5.format(n);
  return (n >= 1000 ? cur0 : cur2).format(n);
};

export const fmtUSDPrecise = (v: Numeric): string => {
  if (privacy) return curSym + MASK;
  const n = (v || 0) * curRate;
  if (curCrypto) return curSym + SIG5.format(n);
  if (n > 0 && n < 0.01) return curSym + n.toFixed(4);
  return cur2.format(n);
};

/** Compact money for chart axis ticks: $14 · $1.2k · ₿0.013 */
export const axisUSD = (v: number): string => {
  if (privacy) return curSym + MASK;
  const n = (v || 0) * curRate;
  if (curCrypto) return n >= 1000 ? `${curSym}${SIG3.format(n / 1000)}k` : curSym + SIG3.format(n);
  if (n >= 1000) return `${curSym}${Math.round(n / 100) / 10}k`;
  return `${curSym}${n >= 10 ? Math.round(n) : Math.round(n * 100) / 100}`;
};

export const fmtInt = (n: Numeric): string => INT.format(Math.round(n || 0));

export const fmtTok = (n: Numeric): string => {
  const v = n || 0;
  // computed rates (tokens/min) can be floats — never print them raw
  if (v < 1000) return String(Math.round(v));
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0) + 'k';
  if (v < 1e9) return (v / 1e6).toFixed(v < 1e7 ? 2 : 1) + 'M';
  return (v / 1e9).toFixed(2) + 'B';
};

/** claude-fable-5[1m] → fable-5 · claude-opus-4-8 → opus-4.8 · deepseek-v4-pro[1m] → v4-pro */
export const shortModel = (id = ''): string => {
  const s = id
    .replace(/^claude-/, '')
    .replace(/^deepseek-/, '')
    .replace(/-20\d{6,}$/, '')
    .replace(/\[[^\]]*\]$/, '');
  const dateFirst = s.match(/^(\d+)-(\d+)-(.+)$/);
  if (dateFirst) return `${dateFirst[3]}-${dateFirst[1]}.${dateFirst[2]}`;
  const versioned = s.match(/^([a-z]+)-(\d+)-(\d+)$/);
  if (versioned) return `${versioned[1]}-${versioned[2]}.${versioned[3]}`;
  return s;
};

export const relTime = (ts: Numeric, now: number = Date.now()): string => {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const countdown = (ms: number): string => {
  if (ms <= 0) return '0m';
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  // Days once there are any. Claude's windows are 5-hourly and weekly so this
  // rarely fired, but Codex's free tier resets MONTHLY — "437h 12m" is a
  // number nobody can read at a glance.
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${String(m % 60).padStart(2, '0')}m`;
  }
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

/** Elapsed duration: 45s · 12m · 2h 14m · 3d 2h */
export const fmtDuration = (ms: Numeric): string => {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
};

export const fmtPct = (v: Numeric, digits = 0): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`;

/** 'YYYY-MM' → 'Jun 2026' */
export const monthLabel = (monthKey: string): string =>
  new Date(`${monthKey}-15T12:00:00`).toLocaleDateString([], {
    month: 'short',
    year: 'numeric',
  });

export const clockTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const feedTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour12: false });

/**
 * "20:46 on 14 Sep" — a reset instant, worded the way the tool's own CLI
 * words it so the two read as the same fact rather than two measurements.
 * Same day is just the clock time; there is no "on today".
 */
export const resetTime = (ts: number, now: number = Date.now()): string => {
  const d = new Date(ts);
  const time = clockTime(ts);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return time;
  return `${time} on ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
};

export const dayLabel = (dateKey: string): string =>
  new Date(`${dateKey}T12:00:00`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

export const projectName = (p = ''): string => p.split('/').filter(Boolean).pop() || p || '—';

/** Shorten /home/<user>/… to ~/… for display. */
export const tildify = (p = ''): string => p.replace(/^\/(home|Users)\/[^/]+/, '~');

// ---- display aliases -------------------------------------------------------
// Configured once from the user config at bootstrap, same shape as
// configureCurrency above: alias maps are hand-edited config read at startup,
// so threading them through every component as props would be noise. DISPLAY
// ONLY — see shared/aliases.ts for why they never reach pricing or grouping.

let modelAliases: AliasMap = {};
let projectAliases: AliasMap = {};

/** Install the user's alias maps. Returns true when anything actually changed. */
export function configureAliases(models: AliasMap, projects: AliasMap): boolean {
  if (modelAliases === models && projectAliases === projects) return false;
  modelAliases = models || {};
  projectAliases = projects || {};
  return true;
}

/** The user's label for a model id, or null when they haven't set one. */
export function modelAlias(id: string): string | null {
  const a = aliasFor(id, modelAliases);
  return a === id ? null : a;
}

/** The user's label for a project path, or null when they haven't set one. */
export function projectAlias(path: string): string | null {
  const a = aliasFor(path, projectAliases);
  return a === path ? null : a;
}

/** Account label for a source root: '~/.claude-work/projects' → 'claude-work' */
export const sourceLabel = (dir = ''): string => {
  const parts = dir.split('/').filter(Boolean);
  if (parts[parts.length - 1] === 'projects') parts.pop();
  const name = (parts.pop() || dir).replace(/^\.+/, '');
  return name || dir;
};

/** The main account's project dir: literal ~/.claude when present, else first. */
export const primarySource = (dirs: string[] = []): string | null =>
  dirs.find((d) => /[\\/]\.claude[\\/]projects$/.test(d)) || dirs[0] || null;
