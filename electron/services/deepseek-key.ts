/**
 * @file deepseek-key.ts
 * @brief Storage and environment detection for the DeepSeek API key —
 *        encrypted at rest through an injected OS-keyring crypto.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type { DeepseekAuth } from '../../shared/types';

/**
 * The one secret ccmon owns.
 *
 * Anthropic credentials are Claude Code's — ccmon reads them and (only on an
 * explicit re-login) writes them back. A DeepSeek key is different: the user
 * hands it to ccmon directly, so ccmon is responsible for it. It is written
 * to `<userData>/deepseek-key.json` at mode 0600, encrypted with the OS
 * keyring via the injected {@link KeyCrypto} (Electron's `safeStorage` in
 * production). The crypto is injected rather than imported so this file stays
 * pure Node like every other service — and so tests can drive it with a fake.
 *
 * When the keyring is unavailable (a Linux box with no configured secret
 * service, most often) the key is stored in plaintext and `encrypted: false`
 * is reported all the way to the UI, which says so plainly. Silently
 * downgrading a secret without telling anyone is the failure mode worth
 * avoiding here.
 *
 * The key is used for exactly one thing: a Bearer header on the read-only
 * balance GET in `deepseek.ts`. It is never logged, never sent anywhere else,
 * and never crosses the IPC bridge — the renderer only ever sees a masked
 * 4-character tail.
 */

/** Injected OS-keyring encryption (Electron `safeStorage` in production). */
export interface KeyCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(buf: Buffer): string;
}

/** A no-op crypto for environments without a keyring — stores plaintext. */
export const plainCrypto: KeyCrypto = {
  available: () => false,
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (buf) => buf.toString('utf8'),
};

interface KeyFile {
  v: number;
  /** true → `key` is base64 ciphertext from the OS keyring */
  enc: boolean;
  key: string;
}

/**
 * Where a key can come from without the user pasting one. `DEEPSEEK_API_KEY`
 * is the platform's own convention; `ANTHROPIC_AUTH_TOKEN` is only trusted
 * when `ANTHROPIC_BASE_URL` points at DeepSeek, which is how Claude Code is
 * pointed at the anthropic-compatible endpoint — that token IS the DeepSeek
 * key in that setup. Anything else would be an Anthropic token, and sending
 * one to DeepSeek is not a mistake worth making automatically.
 */
export function envKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = env.DEEPSEEK_API_KEY?.trim();
  if (direct) return direct;
  const base = env.ANTHROPIC_BASE_URL?.toLowerCase() ?? '';
  if (base.includes('deepseek')) {
    const token = env.ANTHROPIC_AUTH_TOKEN?.trim();
    if (token) return token;
  }
  return null;
}

/** Last 4 characters, for "connected · …a91f". Never the key itself. */
export const maskKey = (key: string): string => `…${key.slice(-4)}`;

/**
 * Shape check before spending a network round-trip on an obvious typo. The
 * real verdict comes from the balance endpoint — this only catches empties,
 * pasted whitespace, and truncation.
 */
export function looksLikeKey(key: string): boolean {
  const k = key.trim();
  return k.length >= 8 && !/\s/.test(k);
}

export class DeepseekKeyStore {
  private readonly file: string;
  private readonly crypto: KeyCrypto;
  private stored: string | null = null;
  /** whether the key on disk is keyring-encrypted (false = plaintext fallback) */
  private storedEncrypted = false;

  constructor(file: string, crypto: KeyCrypto = plainCrypto) {
    this.file = file;
    this.crypto = crypto;
    this.load();
  }

  private load(): void {
    let raw: KeyFile;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as KeyFile;
    } catch {
      return; // no key saved yet
    }
    if (!raw?.key || typeof raw.key !== 'string') return;
    if (!raw.enc) {
      this.stored = raw.key;
      this.storedEncrypted = false;
      return;
    }
    try {
      this.stored = this.crypto.decrypt(Buffer.from(raw.key, 'base64'));
      this.storedEncrypted = true;
    } catch (err) {
      // a keyring that changed under us (reinstall, new OS user) makes the
      // ciphertext undecryptable forever — say so once and let the user
      // reconnect rather than failing every poll with a cryptic error
      console.warn('[ccmon] stored DeepSeek key could not be decrypted:', (err as Error).message);
    }
  }

  /**
   * The key to authenticate with: an explicitly saved one wins over an
   * environment one, so saving a key is how a user overrides whatever their
   * shell happens to export.
   */
  key(): string | null {
    return this.stored ?? envKey();
  }

  /** Non-secret connection state for the UI. */
  auth(): DeepseekAuth {
    const env = envKey();
    const active = this.stored ?? env;
    return {
      connected: !!active,
      source: this.stored ? 'stored' : env ? 'env' : null,
      hint: active ? maskKey(active) : null,
      encrypted: this.stored ? this.storedEncrypted : false,
      envDetected: !!env && !this.stored,
    };
  }

  /** Persist a key (atomic, mode 0600). Throws only if the write itself fails. */
  save(key: string): void {
    const value = key.trim();
    const enc = this.crypto.available();
    const payload: KeyFile = {
      v: 1,
      enc,
      key: enc ? this.crypto.encrypt(value).toString('base64') : value,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.ccmon-${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file); // atomic on the same filesystem
    this.stored = value;
    this.storedEncrypted = enc;
    if (!enc) {
      console.warn(
        '[ccmon] OS keyring unavailable — the DeepSeek key is stored unencrypted at ' +
          `${this.file} (mode 0600)`,
      );
    }
  }

  /** Forget the saved key. An environment key, if any, takes over again. */
  clear(): void {
    this.stored = null;
    this.storedEncrypted = false;
    try {
      fs.rmSync(this.file, { force: true });
    } catch (err) {
      console.warn('[ccmon] could not remove the stored DeepSeek key:', (err as Error).message);
    }
  }
}
