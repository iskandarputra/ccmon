/**
 * @file auth.ts
 * @brief User-initiated Claude Code re-login — silent refresh-token grant with
 *        a browser PKCE fallback — persisting the rotated tokens back to
 *        `<root>/.credentials.json`.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import crypto from 'crypto';
import fs from 'fs';
import { credentialsPath } from './accounts';

/**
 * This module is the ONLY place ccmon ever writes Claude Code credentials, and
 * it runs solely from an explicit user action ("Log in"). It never runs in the
 * 60s limits poller. Anthropic rotates refresh tokens, so the safety contract
 * is: whenever a grant returns a new refresh token we persist the whole rotated
 * pair atomically back to the same `.credentials.json` Claude Code reads — that
 * keeps the two in lockstep. Failing to persist a rotated token is what would
 * log the user out, so persistence is mandatory, not best-effort.
 *
 * macOS note: when Claude Code stores its login in the Keychain rather than a
 * file, no `.credentials.json` exists; the silent refresh has nothing to read
 * and the browser flow would write a file Claude Code may not consult. Limits
 * already only work where the file exists, so this inherits that limitation.
 */

// Public Claude Code OAuth client (native/loopback client — has no secret).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
// Manual-paste redirect: the authorize page shows a `code#state` string the
// user pastes back, so we don't depend on a loopback redirect being registered.
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
// Scopes for a from-scratch login. An existing login's own scopes are reused
// verbatim instead, so a re-login never downgrades what Claude Code had.
const DEFAULT_SCOPES = ['org:create_api_key', 'user:profile', 'user:inference'];
const FETCH_TIMEOUT_MS = 15_000;

export interface StoredOauth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface CredentialsFile {
  claudeAiOauth?: StoredOauth;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/** One in-flight browser login (PKCE verifier + CSRF state), keyed by source dir in main. */
export interface PendingLogin {
  verifier: string;
  state: string;
  scopes: string[];
  createdAt: number;
}

export type RefreshOutcome =
  | { ok: true; expiresAt: number }
  | { ok: false; needsBrowser: boolean; error: string };

export type CodeOutcome = { ok: true; expiresAt: number } | { ok: false; error: string };

/** RFC 7636 base64url (no padding). */
const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Short, single-line snippet of an error body for verbose UI messages. */
const snip = (text: string): string => {
  const s = text.slice(0, 160).replace(/\s+/g, ' ').trim();
  return s ? ` · ${s}` : '';
};

function readFile(projectDir: string): CredentialsFile | null {
  try {
    return JSON.parse(fs.readFileSync(credentialsPath(projectDir), 'utf8')) as CredentialsFile;
  } catch {
    return null;
  }
}

/** Full stored OAuth record for a source dir (incl. the refresh token), or null. */
export function readOauth(projectDir: string): StoredOauth | null {
  return readFile(projectDir)?.claudeAiOauth ?? null;
}

/**
 * Fold a token response onto the previous record: rotate access/refresh tokens
 * (a missing field keeps the old value), recompute absolute expiry, and adopt
 * the granted scope when present. Plan metadata (subscriptionType / tier) is
 * carried over untouched — the token endpoint doesn't return it. Pure: no IO.
 */
export function mergeTokens(prev: StoredOauth, tok: TokenResponse, now: number): StoredOauth {
  return {
    ...prev,
    accessToken: tok.access_token ?? prev.accessToken,
    refreshToken: tok.refresh_token ?? prev.refreshToken,
    expiresAt: now + (tok.expires_in ?? 3600) * 1000,
    scopes: tok.scope ? tok.scope.split(' ') : prev.scopes,
  };
}

/** Merge + write `.credentials.json` atomically (temp + rename, mode 0600). Returns the new expiry. */
function persistTokens(projectDir: string, tok: TokenResponse): number {
  const file = readFile(projectDir) ?? {};
  const next = mergeTokens(file.claudeAiOauth ?? {}, tok, Date.now());
  const out: CredentialsFile = { ...file, claudeAiOauth: next };
  const target = credentialsPath(projectDir);
  const tmp = `${target}.ccmon-${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target); // atomic on the same filesystem
  return next.expiresAt ?? Date.now();
}

async function postToken(
  body: Record<string, string>,
): Promise<{ res: Response; json: TokenResponse | null; text: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: TokenResponse | null = null;
    try {
      json = JSON.parse(text) as TokenResponse;
    } catch {
      /* non-JSON error body — the status + snippet still tell the story */
    }
    return { res, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const networkError = (err: unknown): string => {
  const e = err as Error;
  return e.name === 'AbortError'
    ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s contacting the token endpoint`
    : `network error (${e.name}: ${e.message || 'fetch failed'})`;
};

/**
 * Silent re-auth via the stored refresh token. On success the rotated pair is
 * persisted and the new expiry returned. `needsBrowser` is set when the refresh
 * token itself is dead (the caller should fall back to {@link beginBrowserLogin}).
 * Never throws.
 */
export async function refresh(projectDir: string): Promise<RefreshOutcome> {
  const creds = readOauth(projectDir);
  if (!creds?.refreshToken) {
    return { ok: false, needsBrowser: true, error: 'no stored refresh token — sign in with the browser' };
  }
  try {
    const { res, json, text } = await postToken({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    });
    if (res.ok && json?.access_token) {
      return { ok: true, expiresAt: persistTokens(projectDir, json) };
    }
    // A dead/rotated refresh token answers 400/401 (often invalid_grant); only
    // then is a full browser login required. 5xx / rate limits are transient.
    const needsBrowser =
      res.status === 400 || res.status === 401 || /invalid_grant|invalid_token/i.test(text);
    return {
      ok: false,
      needsBrowser,
      error: `token refresh failed (HTTP ${res.status}${snip(text)})`,
    };
  } catch (err) {
    return { ok: false, needsBrowser: false, error: networkError(err) };
  }
}

/** Fresh PKCE verifier/challenge + CSRF state for a browser login. */
export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(32));
  return { verifier, challenge, state };
}

/** The authorize URL the user opens in their browser (manual-paste flow). */
export function authorizeUrl(challenge: string, state: string, scopes: string[]): string {
  const q = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/**
 * Start a browser login: returns the authorize URL to open and the pending
 * state to retain until the user pastes their code. Reuses the account's
 * existing scopes so a re-login can't strip capabilities Claude Code relies on.
 */
export function beginBrowserLogin(projectDir: string): { url: string; pending: PendingLogin } {
  const { verifier, challenge, state } = createPkce();
  const existing = readOauth(projectDir)?.scopes;
  const scopes = existing && existing.length ? existing : DEFAULT_SCOPES;
  const pending: PendingLogin = { verifier, state, scopes, createdAt: Date.now() };
  return { url: authorizeUrl(challenge, state, scopes), pending };
}

/**
 * Finish a browser login by exchanging the pasted `code#state` string. Verifies
 * the returned state against the pending one (CSRF), exchanges the code with the
 * PKCE verifier, and persists the new tokens. Never throws.
 */
export async function completeBrowserLogin(
  projectDir: string,
  pending: PendingLogin,
  pasted: string,
): Promise<CodeOutcome> {
  // The authorize page yields "CODE#STATE"; tolerate surrounding whitespace.
  const [code, returnedState] = pasted.trim().split('#');
  if (!code) return { ok: false, error: 'no authorization code found in the pasted text' };
  if (returnedState && returnedState !== pending.state) {
    return { ok: false, error: 'state mismatch — please restart the login' };
  }
  try {
    const { res, json, text } = await postToken({
      grant_type: 'authorization_code',
      code,
      state: pending.state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    });
    if (res.ok && json?.access_token) {
      return { ok: true, expiresAt: persistTokens(projectDir, json) };
    }
    return { ok: false, error: `code exchange failed (HTTP ${res.status}${snip(text)})` };
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
}
