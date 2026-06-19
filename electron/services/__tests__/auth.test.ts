/**
 * @file auth.test.ts
 * @brief Unit tests for PKCE generation, authorize-URL shaping, token merge,
 *        and the refresh / code-exchange grants (network mocked).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  authorizeUrl,
  beginBrowserLogin,
  completeBrowserLogin,
  createPkce,
  mergeTokens,
  refresh,
  type StoredOauth,
} from '../auth';

let tmp: string;
let projectDir: string;
let credsFile: string;

/** Seed `<root>/.credentials.json` for a fake account; projectDir is `<root>/projects`. */
function seedCreds(oauth: StoredOauth, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(credsFile, JSON.stringify({ ...extra, claudeAiOauth: oauth }));
}
function readCreds(): StoredOauth {
  return JSON.parse(fs.readFileSync(credsFile, 'utf8')).claudeAiOauth as StoredOauth;
}

/** A Response-like with json body + status for stubbing global fetch. */
const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-auth-'));
  projectDir = path.join(tmp, 'projects');
  credsFile = path.join(tmp, '.credentials.json');
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('createPkce', () => {
  it('emits base64url verifier/challenge/state with no padding', () => {
    const { verifier, challenge, state } = createPkce();
    for (const v of [verifier, challenge, state]) {
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(v).not.toContain('=');
    }
  });

  it('derives the challenge as S256(verifier)', () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
  });

  it('generates a fresh verifier each call', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
  });
});

describe('authorizeUrl', () => {
  it('carries the client, PKCE challenge, scopes and state', () => {
    const url = new URL(authorizeUrl('CHAL', 'STATE', ['user:profile', 'user:inference']));
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge')).toBe('CHAL');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBe('STATE');
    expect(q.get('scope')).toBe('user:profile user:inference');
    expect(q.get('redirect_uri')).toBe('https://console.anthropic.com/oauth/code/callback');
  });
});

describe('mergeTokens', () => {
  const prev: StoredOauth = {
    accessToken: 'A1',
    refreshToken: 'R1',
    expiresAt: 1000,
    scopes: ['x'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_5x',
  };

  it('rotates tokens, recomputes expiry, and adopts the granted scope', () => {
    const next = mergeTokens(prev, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'a b' }, 10_000);
    expect(next.accessToken).toBe('A2');
    expect(next.refreshToken).toBe('R2');
    expect(next.expiresAt).toBe(10_000 + 3600 * 1000);
    expect(next.scopes).toEqual(['a', 'b']);
  });

  it('preserves plan metadata the token endpoint never returns', () => {
    const next = mergeTokens(prev, { access_token: 'A2', expires_in: 60 }, 0);
    expect(next.subscriptionType).toBe('max');
    expect(next.rateLimitTier).toBe('default_claude_max_5x');
  });

  it('keeps the old refresh token + scopes when the response omits them', () => {
    const next = mergeTokens(prev, { access_token: 'A2', expires_in: 60 }, 0);
    expect(next.refreshToken).toBe('R1');
    expect(next.scopes).toEqual(['x']);
  });

  it('defaults to a 1h expiry when expires_in is absent', () => {
    expect(mergeTokens(prev, { access_token: 'A2' }, 0).expiresAt).toBe(3600 * 1000);
  });
});

describe('refresh', () => {
  it('returns needsBrowser without a network call when no refresh token is stored', async () => {
    seedCreds({ accessToken: 'A1' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await refresh(projectDir);
    expect(r).toEqual({ ok: false, needsBrowser: true, error: expect.stringContaining('no stored refresh token') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists the rotated pair atomically on success, preserving siblings', async () => {
    seedCreds(
      { accessToken: 'A1', refreshToken: 'R1', subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
      { someOtherKey: 42 },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'a b' })),
    );
    const r = await refresh(projectDir);
    expect(r.ok).toBe(true);

    const saved = readCreds();
    expect(saved.accessToken).toBe('A2');
    expect(saved.refreshToken).toBe('R2');
    expect(saved.subscriptionType).toBe('max');
    expect(saved.rateLimitTier).toBe('default_claude_max_20x');
    // sibling keys outside claudeAiOauth survive the rewrite
    expect(JSON.parse(fs.readFileSync(credsFile, 'utf8')).someOtherKey).toBe(42);
    // written with owner-only permissions
    if (process.platform !== 'win32') {
      expect(fs.statSync(credsFile).mode & 0o777).toBe(0o600);
    }
  });

  it('flags needsBrowser on a dead refresh token (invalid_grant)', async () => {
    seedCreds({ refreshToken: 'DEAD' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)));
    const r = await refresh(projectDir);
    expect(r).toMatchObject({ ok: false, needsBrowser: true });
  });

  it('does NOT flag needsBrowser on a transient server error', async () => {
    seedCreds({ refreshToken: 'R1' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('upstream down', 503)));
    const r = await refresh(projectDir);
    expect(r).toMatchObject({ ok: false, needsBrowser: false });
  });
});

describe('completeBrowserLogin', () => {
  const pending = { verifier: 'V', state: 'S', scopes: ['user:profile'], createdAt: 0 };

  it('rejects a state mismatch before hitting the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await completeBrowserLogin(projectDir, pending, 'CODE#WRONG');
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('state mismatch') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges CODE#STATE with the PKCE verifier and persists tokens', async () => {
    seedCreds({ accessToken: 'OLD' });
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ access_token: 'NEW', refresh_token: 'RNEW', expires_in: 60 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await completeBrowserLogin(projectDir, pending, '  CODE123#S  ');
    expect(r.ok).toBe(true);
    expect(readCreds().accessToken).toBe('NEW');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'CODE123',
      code_verifier: 'V',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    });
  });
});

describe('beginBrowserLogin', () => {
  it('reuses the existing login scopes so a re-login never downgrades them', () => {
    seedCreds({ accessToken: 'A1', scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:mcp_servers'] });
    const { url } = beginBrowserLogin(projectDir);
    expect(new URL(url).searchParams.get('scope')).toBe(
      'org:create_api_key user:profile user:inference user:mcp_servers',
    );
  });

  it('falls back to default scopes for a from-scratch login', () => {
    const { url, pending } = beginBrowserLogin(projectDir);
    expect(new URL(url).searchParams.get('scope')).toBe('org:create_api_key user:profile user:inference');
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
