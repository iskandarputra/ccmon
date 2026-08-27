/**
 * @file persistence.test.ts
 * @brief Unit tests for the four small on-disk stores: settings, config, window state, pricing archive.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * All four share one contract worth pinning: **a broken file must never break
 * the app.** These are read at startup, they live in a directory the user can
 * edit by hand, and a half-written or hand-mangled JSON file is a normal thing
 * to find. Every one of them is written to degrade to defaults rather than
 * throw, and nothing tested that.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, Settings } from '../settings';
import { loadState } from '../window-state';
import { PricingArchive } from '../pricing-archive';
import type { LitellmEntry } from '../../../shared/types';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-persist-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const file = (name: string) => path.join(tmp, name);

describe('Settings', () => {
  it('starts from defaults when no file exists', () => {
    expect(new Settings(file('settings.json')).get()).toEqual(DEFAULTS);
  });

  it('round-trips a patch through disk', () => {
    const f = file('settings.json');
    const s = new Settings(f);
    s.patch({ theme: 'nord', privacyMode: true });
    expect(new Settings(f).get()).toMatchObject({ theme: 'nord', privacyMode: true });
  });

  it('keeps defaults for keys the stored file omits', () => {
    const f = file('settings.json');
    fs.writeFileSync(f, JSON.stringify({ theme: 'nord' }));
    const got = new Settings(f).get();
    expect(got.theme).toBe('nord');
    expect(got.costMode).toBe(DEFAULTS.costMode); // not undefined
  });

  it('falls back to defaults on a corrupt file rather than throwing', () => {
    const f = file('settings.json');
    fs.writeFileSync(f, '{ this is not json');
    expect(() => new Settings(f)).not.toThrow();
    expect(new Settings(f).get()).toEqual(DEFAULTS);
  });

  /** 'sunday' is retired; an old settings file must not resurrect it. */
  it('forces startOfWeek to monday even when the file says otherwise', () => {
    const f = file('settings.json');
    fs.writeFileSync(f, JSON.stringify({ startOfWeek: 'sunday' }));
    expect(new Settings(f).get().startOfWeek).toBe('monday');
  });

  it('hands out a COPY, so a caller cannot mutate stored state', () => {
    const s = new Settings(file('settings.json'));
    const a = s.get();
    a.theme = 'mutated';
    expect(s.get().theme).not.toBe('mutated');
  });

  it('creates the parent directory on first write', () => {
    const f = path.join(tmp, 'nested', 'deeper', 'settings.json');
    new Settings(f).patch({ theme: 'nord' });
    expect(fs.existsSync(f)).toBe(true);
  });

  /**
   * accountWrapperPrefs[].env can carry a provider API token, so the file is
   * written 0600. No-op on Windows, which has no POSIX mode bits.
   */
  it.skipIf(process.platform === 'win32')('writes the file 0600', () => {
    const f = file('settings.json');
    new Settings(f).patch({ theme: 'nord' });
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });

  it('survives an unwritable path without throwing', () => {
    // a path whose parent is a FILE cannot be created
    const blocker = file('blocker');
    fs.writeFileSync(blocker, 'x');
    const s = new Settings(path.join(blocker, 'settings.json'));
    expect(() => s.patch({ theme: 'nord' })).not.toThrow();
    expect(s.get().theme).toBe('nord'); // in-memory still applied
  });
});

describe('window-state loadState', () => {
  const defaults = { width: 1280, height: 832 };

  it('returns the defaults when no file exists', () => {
    expect(loadState(file('nope.json'), defaults)).toEqual(defaults);
  });

  it('merges saved geometry over the defaults', () => {
    const f = file('win.json');
    fs.writeFileSync(f, JSON.stringify({ x: 10, y: 20, width: 900 }));
    expect(loadState(f, defaults)).toEqual({ x: 10, y: 20, width: 900, height: 832 });
  });

  it('falls back to defaults on a corrupt file', () => {
    const f = file('win.json');
    fs.writeFileSync(f, 'not json at all');
    expect(loadState(f, defaults)).toEqual(defaults);
  });

  it("returns a fresh object, never the caller's defaults instance", () => {
    const out = loadState(file('nope.json'), defaults);
    expect(out).not.toBe(defaults);
    out.width = 1;
    expect(defaults.width).toBe(1280);
  });
});

describe('PricingArchive', () => {
  const cat = (inRate: number): Record<string, LitellmEntry> => ({
    'claude-opus-5': { input_cost_per_token: inRate },
  });

  it('starts empty with no file on disk', () => {
    expect(new PricingArchive(tmp).size).toBe(0);
  });

  it('records the first layer and persists it', () => {
    const a = new PricingArchive(tmp);
    expect(a.record('2026-01-01', cat(1))).toBe(true);
    expect(new PricingArchive(tmp).size).toBe(1);
  });

  /** The file must grow only when prices actually change, not on every refresh. */
  it('does not append an identical catalog', () => {
    const a = new PricingArchive(tmp);
    a.record('2026-01-01', cat(1));
    expect(a.record('2026-01-02', cat(1))).toBe(false);
    expect(a.size).toBe(1);
  });

  it('appends a new layer when prices change', () => {
    const a = new PricingArchive(tmp);
    a.record('2026-01-01', cat(1));
    expect(a.record('2026-01-05', cat(2))).toBe(true);
    expect(a.size).toBe(2);
  });

  it('overwrites rather than duplicates a same-day change', () => {
    const a = new PricingArchive(tmp);
    a.record('2026-01-01', cat(1));
    a.record('2026-01-01', cat(2));
    expect(a.size).toBe(1);
    expect(a.layerFor('2026-01-01')?.models['claude-opus-5'].input_cost_per_token).toBe(2);
  });

  it('resolves a date to the newest layer at or before it', () => {
    const a = new PricingArchive(tmp);
    a.record('2026-01-01', cat(1));
    a.record('2026-02-01', cat(2));
    expect(a.layerFor('2026-01-15')?.models['claude-opus-5'].input_cost_per_token).toBe(1);
    expect(a.layerFor('2026-03-01')?.models['claude-opus-5'].input_cost_per_token).toBe(2);
  });

  /**
   * Past prices cannot be fetched retroactively, so a date before the first
   * layer has no archived answer — the engine falls back to current rates.
   */
  it('returns null for a date preceding every layer', () => {
    const a = new PricingArchive(tmp);
    a.record('2026-02-01', cat(1));
    expect(a.layerFor('2026-01-01')).toBeNull();
  });

  it('ignores malformed layers in a hand-edited file', () => {
    fs.writeFileSync(
      path.join(tmp, 'pricing-archive.json'),
      JSON.stringify({
        layers: [
          { since: '2026-01-01', models: { a: {} } },
          { since: 42, models: {} }, // bad `since`
          { since: '2026-02-01' }, // no models
          null,
        ],
      }),
    );
    expect(new PricingArchive(tmp).size).toBe(1);
  });

  it('recovers from a corrupt archive file', () => {
    fs.writeFileSync(path.join(tmp, 'pricing-archive.json'), '{{{');
    expect(() => new PricingArchive(tmp)).not.toThrow();
    expect(new PricingArchive(tmp).size).toBe(0);
  });

  it('sorts layers read back out of order', () => {
    fs.writeFileSync(
      path.join(tmp, 'pricing-archive.json'),
      JSON.stringify({
        layers: [
          { since: '2026-03-01', models: cat(3) },
          { since: '2026-01-01', models: cat(1) },
        ],
      }),
    );
    const a = new PricingArchive(tmp);
    expect(a.layerFor('2026-02-01')?.models['claude-opus-5'].input_cost_per_token).toBe(1);
  });

  it('keeps working in memory when the directory is unwritable', () => {
    const blocker = file('blocker');
    fs.writeFileSync(blocker, 'x');
    const a = new PricingArchive(blocker); // parent is a file
    expect(() => a.record('2026-01-01', cat(1))).not.toThrow();
    expect(a.size).toBe(1);
  });
});
