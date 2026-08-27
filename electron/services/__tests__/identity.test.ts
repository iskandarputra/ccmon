/**
 * @file identity.test.ts
 * @brief Unit tests for per-tool account identity readers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { codexIdentity, identityFor } from '../tools/identity';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-identity-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/** An unsigned JWT with `payload` as its claim set — shape only, never verified. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.signature-not-checked`;
}

function writeAuth(root: string, auth: Record<string, unknown>): string {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
  return root;
}

describe('codexIdentity — ChatGPT login', () => {
  it('reads plan, email and organization out of the id_token', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: {
        id_token: jwt({
          email: 'dev@example.com',
          name: 'A Dev',
          'https://api.openai.com/auth': {
            chatgpt_plan_type: 'pro',
            organizations: [{ id: 'org-1', title: 'Acme Inc', is_default: true, role: 'owner' }],
          },
        }),
        access_token: 'at',
        refresh_token: 'rt',
        account_id: 'acct',
      },
    });

    expect(codexIdentity(root)).toEqual({
      tool: 'codex',
      plan: 'pro',
      tier: null,
      email: 'dev@example.com',
      organization: 'Acme Inc',
      hasCredentials: true,
      authMode: 'chatgpt',
      cleanupPeriodDays: null,
    });
  });

  it('prefers the default organization over the first listed', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'at',
        id_token: jwt({
          email: 'dev@example.com',
          'https://api.openai.com/auth': {
            chatgpt_plan_type: 'plus',
            organizations: [
              { title: 'Side Project', is_default: false },
              { title: 'Day Job', is_default: true },
            ],
          },
        }),
      },
    });
    expect(codexIdentity(root)?.organization).toBe('Day Job');
  });

  it('leaves organization null when the claim carries none', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: {
        id_token: jwt({
          email: 'solo@example.com',
          'https://api.openai.com/auth': { chatgpt_plan_type: 'free' },
        }),
        access_token: 'at',
      },
    });
    expect(codexIdentity(root)?.organization).toBeNull();
    expect(codexIdentity(root)?.plan).toBe('free');
  });
});

describe('codexIdentity — API key login', () => {
  it('reports the mode without inventing an identity', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-not-a-real-key',
    });
    const info = codexIdentity(root);
    expect(info?.authMode).toBe('apikey');
    expect(info?.hasCredentials).toBe(true);
    expect(info?.email).toBeNull();
    expect(info?.plan).toBeNull();
    expect(info?.organization).toBeNull();
  });

  it('never returns the key itself', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-secret-value',
    });
    expect(JSON.stringify(codexIdentity(root))).not.toContain('sk-secret-value');
  });
});

describe('codexIdentity — degrades quietly', () => {
  it('returns null when there is no auth.json at all', () => {
    fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
    expect(codexIdentity(path.join(home, '.codex'))).toBeNull();
  });

  it('survives a malformed id_token rather than throwing', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: { id_token: 'not.a.jwt', access_token: 'at' },
    });
    const info = codexIdentity(root);
    expect(info?.hasCredentials).toBe(true);
    expect(info?.email).toBeNull();
  });

  it('survives a truncated auth.json', () => {
    const root = path.join(home, '.codex');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'auth.json'), '{"auth_mode":');
    expect(codexIdentity(root)).toBeNull();
  });

  it('returns null for an auth.json holding no credential of any kind', () => {
    const root = writeAuth(path.join(home, '.codex'), { last_refresh: '2026-08-15T12:43:42Z' });
    expect(codexIdentity(root)).toBeNull();
  });
});

describe('identityFor — dispatch by root', () => {
  it('sends a Codex home to the Codex reader', () => {
    const root = writeAuth(path.join(home, '.codex-work'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-x',
    });
    expect(identityFor(root)?.tool).toBe('codex');
  });

  it('returns null for a Claude root with no config or credentials', () => {
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    expect(identityFor(path.join(home, '.claude'))).toBeNull();
  });

  it('does not hand a Claude root to the Codex reader', () => {
    // A Claude root with an auth.json (unlikely, but a user can put anything
    // in their home) must not be misread as a Codex account.
    const root = writeAuth(path.join(home, '.claude-work'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-x',
    });
    expect(identityFor(root)).toBeNull();
  });
});
