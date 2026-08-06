/**
 * @file keychain.ts
 * @brief macOS Keychain access for the Claude Code login, which is NOT a file there.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * On Linux and Windows, Claude Code writes its OAuth login to
 * `<root>/.credentials.json` and everything in ccmon reads it from there. On
 * macOS it stores the same JSON in the login Keychain instead, so that file
 * simply does not exist — which used to take out live plan limits, the tray
 * cap row, the near-cap alert, the limits history and the AI advisor (it
 * reuses the same token) on every Mac.
 *
 * This module is the macOS half of that read, kept deliberately small:
 *
 * - **Read-only by default.** The one write is the token rotation that
 *   `auth.ts` performs after an explicit user re-login, and it must go back to
 *   the same store it was read from or Claude Code loses the rotated pair.
 * - **`security(1)`, not a native module.** It ships with macOS, needs no
 *   build step, and keeps `electron/services` pure Node (no Electron, no
 *   node-gyp). Reading a generic password the user already owns does not
 *   prompt; the item is theirs and the process runs as them.
 * - **Default root only.** The Keychain item is keyed by service name, with
 *   nothing in it that identifies a `CLAUDE_CONFIG_DIR`. Handing the same
 *   token to a second account root would attribute one login's limits to
 *   another account — a wrong number is worse than a missing one — so a
 *   non-default root reports why instead of guessing. See `keychainReason`.
 */

/** The service name Claude Code stores its login under. */
export const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/** Shell-out seam: injectable so every branch is testable off macOS. */
export interface KeychainIO {
  /** the stored secret, or null when absent/denied */
  read(service: string, account: string): string | null;
  /** replace the stored secret; throws with a usable message on failure */
  write(service: string, account: string, secret: string): void;
}

const RW_TIMEOUT_MS = 5000;

export const securityIO: KeychainIO = {
  read(service, account) {
    try {
      const args = ['find-generic-password', '-s', service, '-w'];
      if (account) args.push('-a', account);
      const out = execFileSync('security', args, { encoding: 'utf8', timeout: RW_TIMEOUT_MS });
      const trimmed = out.trim();
      return trimmed || null;
    } catch {
      // exit 44 = item not found; anything else (locked keychain, denied) is
      // equally "no credentials from here" as far as the caller is concerned
      return null;
    }
  },
  write(service, account, secret) {
    // -U updates in place when the item already exists, rather than erroring
    execFileSync('security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w', secret], {
      encoding: 'utf8',
      timeout: RW_TIMEOUT_MS,
    });
  },
};

export interface KeychainOptions {
  platform?: string;
  home?: string;
  user?: string;
  io?: KeychainIO;
  /** injectable clock for the read cache */
  now?: number;
}

const userName = (): string => {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
};

/** `<home>/.claude` — the one root whose login the Keychain item belongs to. */
const defaultRoot = (home: string) => path.join(home, '.claude');

/**
 * Whether the Keychain is the right place to look for THIS account root.
 * macOS + the default root, and nothing else (see the module note).
 */
export function keychainApplies(root: string, opts: KeychainOptions = {}): boolean {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  return platform === 'darwin' && path.resolve(root) === defaultRoot(home);
}

/**
 * Why the Keychain was not consulted for a root, phrased for the UI — an empty
 * string when it WAS consulted. Callers append this to their own error so a
 * Mac user reads "no stored login … macOS keeps the login in the Keychain, and
 * ccmon only reads it for the default ~/.claude account" rather than a bare
 * missing-file message that is not even true on their machine.
 */
export function keychainReason(root: string, opts: KeychainOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') return '';
  if (keychainApplies(root, opts)) return '';
  return (
    ' — on macOS the login lives in the Keychain under one item, which ccmon reads only for the ' +
    'default ~/.claude account; other roots need a ~/.credentials.json'
  );
}

/**
 * Reads are cached for a few seconds because the callers are hot: account
 * identity is resolved on every snapshot publish and limits poll, and each
 * miss is a `security` process. The window is short enough that a login made
 * in another terminal shows up almost immediately, and a write clears it.
 */
const READ_TTL_MS = 5000;
let cache: { at: number; value: string | null } | null = null;

/** Drop the cached read — for tests and immediately after a write. */
export function clearKeychainCache(): void {
  cache = null;
}

/** The raw JSON blob Claude Code stored, or null. No parsing, no shape guess. */
export function readKeychainSecret(root: string, opts: KeychainOptions = {}): string | null {
  if (!keychainApplies(root, opts)) return null;
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < READ_TTL_MS) return cache.value;
  const io = opts.io ?? securityIO;
  const value = io.read(KEYCHAIN_SERVICE, opts.user ?? userName());
  cache = { at: now, value };
  return value;
}

/**
 * Replace the stored blob after a token rotation. Returns false when the
 * Keychain is not the store for this root — the caller then writes the file,
 * which is the correct behaviour everywhere except a default-root Mac.
 */
export function writeKeychainSecret(root: string, secret: string, opts: KeychainOptions = {}): boolean {
  if (!keychainApplies(root, opts)) return false;
  const io = opts.io ?? securityIO;
  io.write(KEYCHAIN_SERVICE, opts.user ?? userName(), secret);
  clearKeychainCache(); // the next read must see the rotated pair, not the old one
  return true;
}
