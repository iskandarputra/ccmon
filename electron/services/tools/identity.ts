/**
 * @file identity.ts
 * @brief Per-tool account identity — the filesystem half of the tool registry.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { toolForRoot } from '../../../shared/tools';
import type { AccountInfo } from '../../../shared/types';

/**
 * Reading an account's identity is per-tool because the credential stores are
 * unrelated: Claude Code keeps `<root>/.claude.json` plus
 * `<root>/.credentials.json` (or, on macOS, the Keychain), while Codex keeps a
 * single `<root>/auth.json` holding either an OAuth token set or a bare API
 * key.
 *
 * Everything here is READ-ONLY and OFFLINE. No token is refreshed, no request
 * is made, and no secret is ever returned to the caller — only the non-secret
 * metadata an account row needs to identify itself.
 */

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null; // absent, unreadable, or truncated mid-write
  }
}

/**
 * Plans where the "organization" is the user themselves.
 *
 * Both vendors model a solo subscriber as a one-person org — OpenAI titles it
 * "Personal", Anthropic uses the account holder's own name — so the field is
 * present, truthful and useless. It is worth showing only when it names
 * someone OTHER than the person reading the screen.
 *
 * An UNKNOWN plan is not personal. Answering true for null suppressed a real
 * organization name whenever the plan failed to resolve — dropping information
 * ccmon actually had, to answer a question it could not.
 */
const PERSONAL_PLANS = new Set(['free', 'plus', 'pro', 'max']);

export const isPersonalPlan = (plan: string | null | undefined): boolean =>
  !!plan && PERSONAL_PLANS.has(plan.toLowerCase());

// ---- codex ------------------------------------------------------------------

/** The OpenAI-namespaced claim block inside a Codex `id_token`. */
const OAI_CLAIM = 'https://api.openai.com/auth';

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: unknown;
  tokens?: { id_token?: string; access_token?: string };
}

interface OaiClaims {
  chatgpt_plan_type?: string;
  organizations?: Array<{ title?: string; is_default?: boolean }>;
}

interface IdTokenPayload {
  email?: string;
  name?: string;
  [OAI_CLAIM]?: OaiClaims;
}

/**
 * The claim set of a JWT, or null.
 *
 * The signature is NOT verified, and cannot be: ccmon has no key, makes no
 * network call, and never presents this token to anything. It is display
 * metadata for a row the user is already looking at, read out of a 0600 file
 * in their own home directory — the same trust level as reading `.claude.json`.
 * Treating it as an authorization decision would be wrong; treating it as a
 * label is exactly what it is.
 */
function decodeJwtPayload(token: string): IdTokenPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdTokenPayload;
  } catch {
    return null;
  }
}

/** Non-secret identity for a Codex home, or null when it holds no login. */
export function codexIdentity(root: string): AccountInfo | null {
  const auth = readJson<CodexAuthFile>(path.join(root, 'auth.json'));
  if (!auth) return null;

  const authMode =
    auth.auth_mode === 'chatgpt' || auth.auth_mode === 'apikey' ? auth.auth_mode : null;
  const hasKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
  const hasToken = typeof auth.tokens?.access_token === 'string' && !!auth.tokens.access_token;
  // an auth.json holding neither is a leftover, not an account
  if (!hasKey && !hasToken) return null;

  const payload = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
  const claims = payload?.[OAI_CLAIM];
  const plan = claims?.chatgpt_plan_type ?? null;
  const orgs = claims?.organizations ?? [];
  const org = orgs.find((o) => o.is_default) ?? orgs[0];

  return {
    tool: 'codex',
    plan,
    tier: null, // Codex has no plan-multiplier concept
    email: payload?.email ?? null,
    // A personal ChatGPT account still carries an "organization" — OpenAI
    // auto-creates one titled "Personal" and makes you its owner. That is a
    // billing artifact, not an org, and showing it puts a meaningless row on
    // the card. Only a plan that genuinely has an org keeps one.
    organization: isPersonalPlan(plan) ? null : (org?.title ?? null),
    hasCredentials: true,
    authMode,
    cleanupPeriodDays: null, // Codex has no retention setting
  };
}

// ---- dispatch ---------------------------------------------------------------

/**
 * The Claude reader stays in `accounts.ts` — it also backs the limits poll and
 * re-auth, which are Claude-only and pull in the Keychain path. It registers
 * itself here at module load rather than being imported, which keeps the
 * dependency one-way and avoids a cycle.
 */
let claudeReader: ((root: string) => AccountInfo | null) | null = null;

/** Installed once, at load, by `accounts.ts`. */
export function registerClaudeIdentity(fn: (root: string) => AccountInfo | null): void {
  claudeReader = fn;
}

/** Identity for an account root, dispatched by the tool that owns it. */
export function identityFor(root: string): AccountInfo | null {
  if (toolForRoot(root).id === 'codex') return codexIdentity(root);
  return claudeReader ? claudeReader(root) : null;
}
