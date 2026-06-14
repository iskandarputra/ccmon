/**
 * @file accounts.ts
 * @brief Account identity and live plan-limits fetch against the Anthropic OAuth usage endpoint.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type { AccountInfo, AccountsMap, LimitsResult, LimitWindow } from '../../shared/types';

/**
 * Per-account metadata and (opt-in) live plan limits.
 *
 * Each source dir (`<root>/projects`) belongs to a Claude Code account root.
 * The account's identity lives in `<root>/.claude.json` — except the default
 * `~/.claude` account, whose config is the SIBLING file `~/.claude.json`.
 * OAuth credentials live in `<root>/.credentials.json`.
 *
 * Live limits use the same endpoint Claude Code's /usage screen calls, with
 * the stored access token, read-only. We deliberately NEVER refresh tokens:
 * Anthropic rotates refresh tokens, and consuming one here would invalidate
 * the user's Claude Code login. An expired token just reports a reason.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const FETCH_TIMEOUT_MS = 10_000;

const PLAN_LABELS: Record<string, string> = {
  claude_max: 'max',
  claude_pro: 'pro',
  claude_team: 'team',
  claude_enterprise: 'enterprise',
};

interface OauthAccount {
  emailAddress?: string;
  organizationName?: string;
  organizationType?: string;
  seatTier?: string;
}

interface ClaudeConfig {
  oauthAccount?: OauthAccount;
}

interface OauthCredentials {
  accessToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  /** e.g. 'default_claude_max_5x' | 'default_claude_max_20x' */
  rateLimitTier?: string;
}

interface CredentialsFile {
  claudeAiOauth?: OauthCredentials;
}

export interface UsageApiWindow {
  utilization?: number;
  resets_at?: string;
}

interface UsageApiResponse {
  five_hour?: UsageApiWindow;
  seven_day?: UsageApiWindow;
  seven_day_opus?: UsageApiWindow;
  seven_day_sonnet?: UsageApiWindow;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

const rootOf = (projectDir: string) => path.dirname(projectDir);

function accountConfig(projectDir: string): ClaudeConfig | null {
  const root = rootOf(projectDir);
  const inside = readJson<ClaudeConfig>(path.join(root, '.claude.json'));
  if (inside) return inside;
  if (path.basename(root) === '.claude') {
    return readJson<ClaudeConfig>(path.join(path.dirname(root), '.claude.json'));
  }
  return null;
}

function credentials(projectDir: string): OauthCredentials | null {
  const creds = readJson<CredentialsFile>(path.join(rootOf(projectDir), '.credentials.json'));
  return creds?.claudeAiOauth || null;
}

/**
 * Plan multiplier from the stored rateLimitTier, e.g.
 * 'default_claude_max_5x' → '5x', 'default_claude_max_20x' → '20x'.
 * (The same value is also served by /api/oauth/profile as
 * organization.rate_limit_tier — the local copy spares a request.)
 */
function tierOf(rateLimitTier: string | undefined): string | null {
  const m = rateLimitTier?.match(/_(\d+x)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Non-secret account identity for a source dir, or null when unknown. */
export function accountInfo(projectDir: string): AccountInfo | null {
  const oauth = accountConfig(projectDir)?.oauthAccount || null;
  const creds = credentials(projectDir);
  if (!oauth && !creds) return null;
  const plan =
    creds?.subscriptionType ||
    (oauth?.organizationType ? PLAN_LABELS[oauth.organizationType] : undefined) ||
    oauth?.seatTier ||
    null;
  return {
    plan,
    tier: tierOf(creds?.rateLimitTier),
    email: oauth?.emailAddress || null,
    organization: oauth?.organizationName || null,
    hasCredentials: !!creds?.accessToken,
  };
}

/** All account infos keyed by source dir. */
export function accountsFor(projectDirs: string[] = []): AccountsMap {
  const out: AccountsMap = {};
  for (const dir of projectDirs) {
    const info = accountInfo(dir);
    if (info) out[dir] = info;
  }
  return out;
}

/** {pct, resetsAt} from one usage window of the API response, or null. */
export function limitWindow(w: UsageApiWindow | undefined): LimitWindow | null {
  if (!w || typeof w !== 'object') return null;
  let pct: number | null = null;
  if (typeof w.utilization === 'number' && Number.isFinite(w.utilization)) {
    // The usage endpoint reports utilization on a 0–100 percent scale (a
    // session at 11% arrives as `11`, not `0.11`). The old `<= 1 ? *100`
    // fraction-detection misfired on any window sitting at ≤1%: a weekly
    // all-models window at 1% became `1 * 100 = 100%`. Treat the value as
    // a percent directly and clamp to a sane range.
    pct = Math.max(0, Math.min(100, w.utilization));
  }
  const resetsAt = w.resets_at ? Date.parse(w.resets_at) : NaN;
  if (pct == null && !Number.isFinite(resetsAt)) return null;
  return { pct, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null };
}

/** Retry-After header → ms (seconds form or HTTP-date form), or null. */
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > Date.now() ? at - Date.now() : null;
}

/** Plain-language explanation for a usage-endpoint HTTP status. */
function httpReason(status: number): string {
  if (status === 429) return 'rate limited by anthropic — too many requests to the usage endpoint';
  if (status === 401 || status === 403) return 'token rejected — open Claude Code once to refresh the login';
  if (status >= 500) return 'anthropic server error';
  return 'request failed';
}

/**
 * Fetch live plan limits for one account. Resolves
 * `{ ok: true, fetchedAt, session, week, weekOpus }` (windows per
 * limitWindow(), any may be null) or a verbose `{ ok: false, error,
 * status?, retryAfterMs?, at }` — never rejects. Error strings are written
 * for the UI: they say what happened AND why, not just a status code.
 */
export async function fetchLiveLimits(projectDir: string): Promise<LimitsResult> {
  const creds = credentials(projectDir);
  if (!creds?.accessToken) {
    return {
      ok: false,
      at: Date.now(),
      error: 'no stored login (.credentials.json missing or has no access token)',
    };
  }
  if (creds.expiresAt && creds.expiresAt < Date.now() + 60_000) {
    return {
      ok: false,
      at: Date.now(),
      error: `login expired ${new Date(creds.expiresAt).toLocaleString()} — open Claude Code to refresh it`,
    };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': OAUTH_BETA,
      },
      signal: ctl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 160).replace(/\s+/g, ' ').trim();
      } catch {
        /* body unreadable — the status alone still tells the story */
      }
      return {
        ok: false,
        status: res.status,
        retryAfterMs: parseRetryAfter(res),
        at: Date.now(),
        error: `${httpReason(res.status)} (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? ` · ${detail}` : ''})`,
      };
    }
    const data = (await res.json()) as UsageApiResponse;
    const session = limitWindow(data.five_hour);
    const week = limitWindow(data.seven_day);
    const weekOpus = limitWindow(data.seven_day_opus);
    const weekSonnet = limitWindow(data.seven_day_sonnet);
    // the endpoint is undocumented — if it answers 200 but none of the known
    // windows parse, its shape changed; say so instead of rendering nothing
    if (!session && !week && !weekOpus && !weekSonnet) {
      return {
        ok: false,
        at: Date.now(),
        error:
          'usage endpoint returned no recognizable limit windows — its response shape may have changed (please open an issue)',
      };
    }
    return { ok: true, fetchedAt: Date.now(), session, week, weekOpus, weekSonnet };
  } catch (err) {
    const e = err as Error;
    return {
      ok: false,
      at: Date.now(),
      error:
        e.name === 'AbortError'
          ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s — network slow or endpoint unreachable`
          : `network error (${e.name}: ${e.message || 'fetch failed'})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthetic plan limits for promo recordings — NEVER used in production. The
 * limits poll swaps to this only when `CCMON_DEMO_LIMITS` is set (record.ts in
 * --demo). Returns deterministic per-account utilization tuned so the
 * cross-account headroom banner fires: the `.claude-work` account sits near a
 * cap while the default `.claude` account keeps room (see src/lib/crossAccount
 * thresholds HIGH 80 / GAP 25 / ROOM 70). A gentle time wobble keeps the
 * "live" dot and sparkline from reading as frozen on camera.
 */
export function demoLimits(projectDir: string, now: number): LimitsResult {
  const isWork = path.basename(rootOf(projectDir)) !== '.claude';
  const wobble = Math.sin(now / 30_000) * 1.5;
  const win = (pct: number, resetInHours: number): LimitWindow => ({
    pct: Math.max(0, Math.min(100, pct)),
    resetsAt: now + resetInHours * 3_600_000,
  });
  return isWork
    ? {
        ok: true,
        fetchedAt: now,
        session: win(90 + wobble, 2.5),
        week: win(76 + wobble * 0.5, 88),
        weekOpus: win(83 + wobble * 0.5, 88),
        weekSonnet: win(61 + wobble * 0.5, 88),
      }
    : {
        ok: true,
        fetchedAt: now,
        session: win(24 + wobble, 4),
        week: win(31 + wobble * 0.5, 104),
        weekOpus: win(27 + wobble * 0.5, 104),
        weekSonnet: win(19 + wobble * 0.5, 104),
      };
}
