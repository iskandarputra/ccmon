/**
 * @file keychain.test.ts
 * @brief Unit tests for the macOS Keychain read/write seam — every OS branch, off macOS.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import {
  KEYCHAIN_SERVICE,
  classifySecurityError,
  clearKeychainCache,
  keychainApplies,
  keychainReason,
  readKeychainSecret,
  writeKeychainSecret,
  type KeychainIO,
} from '../keychain';

const HOME = '/Users/isz';
const DEFAULT_ROOT = path.join(HOME, '.claude');
const WORK_ROOT = path.join(HOME, '.claude-work');
const BLOB = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 4102444800000 } });

/** Recording fake for `security(1)`. */
function fakeIO(stored: string | null = BLOB) {
  const calls: Array<{ op: string; service: string; account: string; secret?: string }> = [];
  const io: KeychainIO = {
    read: (service, account) => {
      calls.push({ op: 'read', service, account });
      return stored;
    },
    write: (service, account, secret) => {
      calls.push({ op: 'write', service, account, secret });
      stored = secret;
    },
  };
  return { io, calls, current: () => stored };
}

const mac = (over = {}) => ({ platform: 'darwin', home: HOME, user: 'isz', ...over });

beforeEach(clearKeychainCache);

describe('keychainApplies — macOS default root only', () => {
  it('applies to ~/.claude on macOS', () => {
    expect(keychainApplies(DEFAULT_ROOT, mac())).toBe(true);
  });

  it('does NOT apply to a second account root', () => {
    // the Keychain item carries nothing identifying a config dir, so reusing it
    // would report the default account's limits under another account's name
    expect(keychainApplies(WORK_ROOT, mac())).toBe(false);
  });

  it('does not apply off macOS, where the file is authoritative', () => {
    expect(keychainApplies(DEFAULT_ROOT, { platform: 'linux', home: HOME })).toBe(false);
    expect(keychainApplies(DEFAULT_ROOT, { platform: 'win32', home: HOME })).toBe(false);
  });
});

describe('readKeychainSecret', () => {
  it('reads the Claude Code item for the default root', () => {
    const f = fakeIO();
    expect(readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 1000 }))).toBe(BLOB);
    expect(f.calls[0]).toMatchObject({ op: 'read', service: KEYCHAIN_SERVICE, account: 'isz' });
  });

  it('never shells out for a root it does not apply to', () => {
    const f = fakeIO();
    expect(readKeychainSecret(WORK_ROOT, mac({ io: f.io }))).toBeNull();
    expect(
      readKeychainSecret(DEFAULT_ROOT, { platform: 'linux', home: HOME, io: f.io }),
    ).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it('returns null when the item is absent (security exits non-zero)', () => {
    const f = fakeIO(null);
    expect(readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 1000 }))).toBeNull();
  });

  it('caches within the TTL and re-reads after it — one spawn per poll, not per call', () => {
    const f = fakeIO();
    readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 1000 }));
    readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 3000 }));
    expect(f.calls.filter((c) => c.op === 'read')).toHaveLength(1);
    readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 9000 }));
    expect(f.calls.filter((c) => c.op === 'read')).toHaveLength(2);
  });
});

describe('writeKeychainSecret — token rotation goes back where it came from', () => {
  it('updates the item and drops the cached read', () => {
    const f = fakeIO();
    readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 1000 }));
    expect(writeKeychainSecret(DEFAULT_ROOT, 'rotated', mac({ io: f.io }))).toBe(true);
    expect(f.current()).toBe('rotated');
    // same instant: without the invalidation this would still serve the old blob
    expect(readKeychainSecret(DEFAULT_ROOT, mac({ io: f.io, now: 1000 }))).toBe('rotated');
  });

  it('refuses roots it does not own, so the caller writes the file instead', () => {
    const f = fakeIO();
    expect(writeKeychainSecret(WORK_ROOT, 'x', mac({ io: f.io }))).toBe(false);
    expect(
      writeKeychainSecret(DEFAULT_ROOT, 'x', { platform: 'linux', home: HOME, io: f.io }),
    ).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

describe('classifySecurityError — tell "not logged in" apart from "cannot reach it"', () => {
  it('says nothing for an absent item — that is the ordinary not-logged-in case', () => {
    expect(
      classifySecurityError(
        44,
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      ),
    ).toBeNull();
  });

  it('explains the GUI-session refusal, which is what SSH and detached tmux hit', () => {
    // credentials exist and the Mac is logged in — the process just cannot
    // reach the Keychain, which reads as "no stored login" without this
    const msg = classifySecurityError(
      36,
      'security: SecKeychainSearchCopyNext: User interaction is not allowed.',
    );
    expect(msg).toContain('without a GUI session');
    expect(msg).toContain('unlock-keychain');
  });

  it('reports a locked keychain and a cancelled prompt', () => {
    expect(
      classifySecurityError(
        51,
        'The user name or passphrase you entered is not correct; keychain is locked',
      ),
    ).toContain('locked');
    expect(classifySecurityError(128, 'User canceled the operation.')).toContain('cancelled');
  });

  it('passes an unrecognised failure through, truncated, rather than swallowing it', () => {
    expect(classifySecurityError(1, 'something else entirely')).toBe(
      'macOS Keychain error: something else entirely',
    );
    expect(classifySecurityError(1, '   ')).toBeNull();
  });
});

describe('keychainReason — why a Mac user sees no login', () => {
  it('explains the single-item limitation for a non-default root', () => {
    expect(keychainReason(WORK_ROOT, mac())).toContain('Keychain');
  });

  it('says nothing when the Keychain was consulted, or off macOS', () => {
    expect(keychainReason(DEFAULT_ROOT, mac())).toBe('');
    expect(keychainReason(WORK_ROOT, { platform: 'linux', home: HOME })).toBe('');
  });
});
