/**
 * @file deepseek.ts
 * @brief Read-only DeepSeek account balance fetch against the platform's
 *        `/user/balance` endpoint, with the same keep-last-good contract as
 *        the Anthropic limits poll.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { DeepseekBalance, DeepseekResult } from '../../shared/types';

/**
 * DeepSeek has no OAuth — the platform authenticates with a bare API key, so
 * there is no token to rotate and nothing to keep in lockstep with another
 * app (contrast `auth.ts`, which must persist Anthropic's rotated pair). That
 * makes this the simplest of ccmon's network paths: one GET, one Bearer
 * header, read-only, and the key never leaves the machine except as that
 * header.
 *
 * `/user/balance` is also the ONLY account endpoint DeepSeek publishes. There
 * is no usage-history, quota, or rate-limit endpoint, so there is no DeepSeek
 * equivalent of the plan-limit windows — everything beyond the raw balance
 * (burn, runway, drift) is derived locally in `deepseek-history.ts`.
 *
 * Pure Node on purpose — no Electron imports (the key store injects its
 * crypto, see `deepseek-key.ts`).
 */

const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const FETCH_TIMEOUT_MS = 10_000;

interface BalanceInfoApi {
  currency?: unknown;
  total_balance?: unknown;
  granted_balance?: unknown;
  topped_up_balance?: unknown;
}

interface BalanceApiResponse {
  is_available?: unknown;
  balance_infos?: unknown;
}

/**
 * The API returns amounts as decimal STRINGS ("110.00"), not numbers. Parse
 * leniently but reject anything non-finite so a shape change surfaces as a
 * loud failure rather than a balance of NaN on screen.
 */
function amount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Parse `balance_infos` into typed balances, dropping unparseable rows. Pure. */
export function parseBalances(raw: unknown): DeepseekBalance[] {
  if (!Array.isArray(raw)) return [];
  const out: DeepseekBalance[] = [];
  for (const item of raw as BalanceInfoApi[]) {
    if (!item || typeof item !== 'object') continue;
    const currency = typeof item.currency === 'string' ? item.currency.toUpperCase() : null;
    const total = amount(item.total_balance);
    if (!currency || total == null) continue; // currency + total are the load-bearing pair
    out.push({
      currency,
      total,
      granted: amount(item.granted_balance) ?? 0,
      toppedUp: amount(item.topped_up_balance) ?? 0,
    });
  }
  return out;
}

/**
 * Which balance ccmon leads with. USD wins when the account holds it, since
 * every other number in the app is USD and showing them side by side without
 * a conversion step is less to get wrong; otherwise the first row, whatever
 * it is denominated in. Pure.
 */
export function pickPrimary(balances: DeepseekBalance[]): DeepseekBalance | null {
  if (!balances.length) return null;
  return balances.find((b) => b.currency === 'USD') ?? balances[0];
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

/** Plain-language explanation for a balance-endpoint HTTP status. */
function httpReason(status: number): string {
  if (status === 401 || status === 403) {
    return 'key rejected — the DeepSeek API key is invalid or was revoked';
  }
  if (status === 429) return 'rate limited by deepseek — too many requests to the balance endpoint';
  if (status >= 500) return 'deepseek server error';
  return 'request failed';
}

/**
 * Fetch the account balance for one API key. Resolves
 * `{ok: true, fetchedAt, isAvailable, balances, primary}` or a verbose
 * `{ok: false, error, status?, retryAfterMs?, at}` — never rejects. Error
 * strings are written for the UI: what happened AND why.
 */
export async function fetchBalance(apiKey: string): Promise<DeepseekResult> {
  if (!apiKey) {
    return { ok: false, at: Date.now(), error: 'no DeepSeek API key configured' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
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
    const data = (await res.json()) as BalanceApiResponse;
    const balances = parseBalances(data.balance_infos);
    const primary = pickPrimary(balances);
    // 200 with nothing parseable means the response shape moved under us —
    // say so rather than rendering an empty card that looks like zero balance
    if (!primary) {
      return {
        ok: false,
        at: Date.now(),
        error:
          'balance endpoint returned no recognizable balances — its response shape may have changed (please open an issue)',
      };
    }
    return {
      ok: true,
      fetchedAt: Date.now(),
      isAvailable: data.is_available !== false, // absent → assume usable, the balances speak for themselves
      balances,
      primary,
    };
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
