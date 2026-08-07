/**
 * @file bootstrap.test.ts
 * @brief Unit tests for the renderer→main settings bridge.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * `updateSettings` is called from twelve UI call sites, none of which await it
 * and none of which can do anything useful with a rejection — main is the
 * source of truth and pushes the applied settings back on `settings:changed`.
 * It is therefore typed `void` and swallows failures with a log. These tests
 * pin that: a failing IPC must not become an unhandled rejection, and must not
 * throw at the call site either.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateSettings } from '../bootstrap';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('updateSettings', () => {
  it('forwards the patch to main', () => {
    const setSettings = vi.fn(() => Promise.resolve());
    vi.stubGlobal('window', { ccmon: { setSettings } });

    updateSettings({ privacyMode: true });
    expect(setSettings).toHaveBeenCalledWith({ privacyMode: true });
  });

  it('returns nothing — callers must not await it', () => {
    vi.stubGlobal('window', { ccmon: { setSettings: () => Promise.resolve() } });
    expect(updateSettings({ theme: 'nord' })).toBeUndefined();
  });

  it('does not throw when the bridge is missing', () => {
    vi.stubGlobal('window', {});
    expect(() => updateSettings({ theme: 'nord' })).not.toThrow();
  });

  /** The reason this function exists rather than a bare `window.ccmon?.…`. */
  it('swallows a rejected IPC and logs it, instead of an unhandled rejection', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('window', {
      ccmon: { setSettings: () => Promise.reject(new Error('ipc gone')) },
    });

    expect(() => updateSettings({ theme: 'nord' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain('settings update failed');
  });
});
