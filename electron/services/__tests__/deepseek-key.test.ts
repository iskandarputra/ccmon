/**
 * @file deepseek-key.test.ts
 * @brief Unit tests for DeepSeek key storage — keyring encryption, the
 *        plaintext fallback, environment detection, and precedence.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeepseekKeyStore,
  envKey,
  looksLikeKey,
  maskKey,
  plainCrypto,
  type KeyCrypto,
} from '../deepseek-key';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());

function keyFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-dskey-test-'));
  roots.push(root);
  return path.join(root, 'deepseek-key.json');
}

/** A reversible stand-in for the OS keyring — proves the ciphertext round-trips. */
const fakeCrypto: KeyCrypto = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (buf) => {
    const s = buf.toString('utf8');
    if (!s.startsWith('enc:')) throw new Error('not our ciphertext');
    return s.slice(4);
  },
};

describe('envKey', () => {
  it('reads DEEPSEEK_API_KEY', () => {
    expect(envKey({ DEEPSEEK_API_KEY: ' sk-env-key ' })).toBe('sk-env-key');
  });

  it('accepts ANTHROPIC_AUTH_TOKEN only when the base URL points at DeepSeek', () => {
    expect(
      envKey({
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-ds',
      }),
    ).toBe('sk-ds');
  });

  it('never mistakes a plain Anthropic token for a DeepSeek key', () => {
    expect(envKey({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-secret' })).toBeNull();
    expect(
      envKey({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'sk-ant' }),
    ).toBeNull();
  });

  it('prefers the explicit DeepSeek variable over the proxy one', () => {
    expect(
      envKey({
        DEEPSEEK_API_KEY: 'sk-direct',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-proxy',
      }),
    ).toBe('sk-direct');
  });

  it('is null with nothing set', () => {
    expect(envKey({})).toBeNull();
  });
});

describe('maskKey / looksLikeKey', () => {
  it('masks down to a 4-character tail', () => {
    expect(maskKey('sk-abcdef1234a91f')).toBe('…a91f');
  });

  it('rejects empties, whitespace-bearing pastes, and truncated keys', () => {
    expect(looksLikeKey('')).toBe(false);
    expect(looksLikeKey('sk-123')).toBe(false);
    expect(looksLikeKey('sk-abc def12345')).toBe(false);
    expect(looksLikeKey('sk-abcdef123456')).toBe(true);
  });
});

describe('DeepseekKeyStore', () => {
  it('round-trips an encrypted key through a fresh instance', () => {
    const file = keyFile();
    new DeepseekKeyStore(file, fakeCrypto).save('sk-secret-key');

    // the plaintext must not be sitting in the file
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-secret-key');

    const reloaded = new DeepseekKeyStore(file, fakeCrypto);
    expect(reloaded.key()).toBe('sk-secret-key');
    expect(reloaded.auth()).toMatchObject({ connected: true, source: 'stored', encrypted: true });
  });

  it('writes the key file 0600', () => {
    const file = keyFile();
    new DeepseekKeyStore(file, fakeCrypto).save('sk-secret-key');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('falls back to plaintext WITHOUT claiming to be encrypted', () => {
    const file = keyFile();
    new DeepseekKeyStore(file, plainCrypto).save('sk-plain-key');
    const reloaded = new DeepseekKeyStore(file, plainCrypto);
    expect(reloaded.key()).toBe('sk-plain-key');
    expect(reloaded.auth().encrypted).toBe(false);
  });

  it('reports no key rather than a broken one when the keyring can no longer decrypt', () => {
    const file = keyFile();
    new DeepseekKeyStore(file, fakeCrypto).save('sk-secret-key');
    const rotated: KeyCrypto = {
      ...fakeCrypto,
      decrypt: () => {
        throw new Error('keyring rotated');
      },
    };
    const store = new DeepseekKeyStore(file, rotated);
    expect(store.key()).toBeNull();
    expect(store.auth().connected).toBe(false);
  });

  it('prefers a saved key over one in the environment', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-from-env');
    const store = new DeepseekKeyStore(keyFile(), fakeCrypto);
    expect(store.auth()).toMatchObject({ source: 'env', envDetected: true });
    store.save('sk-saved-key');
    expect(store.key()).toBe('sk-saved-key');
    expect(store.auth()).toMatchObject({ source: 'stored', envDetected: false });
  });

  it('hands back to the environment key after a disconnect', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-from-env');
    const file = keyFile();
    const store = new DeepseekKeyStore(file, fakeCrypto);
    store.save('sk-saved-key');
    store.clear();
    expect(fs.existsSync(file)).toBe(false);
    expect(store.key()).toBe('sk-from-env');
    expect(store.auth()).toMatchObject({ connected: true, source: 'env' });
  });

  it('is simply disconnected with no key anywhere', () => {
    const store = new DeepseekKeyStore(keyFile(), fakeCrypto);
    expect(store.key()).toBeNull();
    expect(store.auth()).toEqual({
      connected: false,
      source: null,
      hint: null,
      encrypted: false,
      envDetected: false,
    });
  });
});
