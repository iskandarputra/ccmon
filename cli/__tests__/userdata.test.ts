/**
 * @file userdata.test.ts
 * @brief Unit tests for headless userData resolution (must track Electron).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { APP_NAME, appDataRoot, userDataDir } from '../userdata';
import pkg from '../../package.json';

const HOME = '/home/tester';

describe('APP_NAME', () => {
  it('matches package.json name — Electron derives userData from it', () => {
    expect(APP_NAME).toBe(pkg.name);
  });
});

describe('appDataRoot', () => {
  it('follows the platform convention', () => {
    expect(appDataRoot('linux', {}, HOME)).toBe(path.join(HOME, '.config'));
    expect(appDataRoot('darwin', {}, HOME)).toBe(path.join(HOME, 'Library', 'Application Support'));
    expect(appDataRoot('win32', {}, HOME)).toBe(path.join(HOME, 'AppData', 'Roaming'));
  });

  it('honours the same env overrides Electron does', () => {
    expect(appDataRoot('linux', { XDG_CONFIG_HOME: '/xdg' }, HOME)).toBe('/xdg');
    expect(appDataRoot('win32', { APPDATA: 'C:\\Roaming' }, HOME)).toBe('C:\\Roaming');
  });

  it('ignores XDG_CONFIG_HOME off-platform', () => {
    expect(appDataRoot('darwin', { XDG_CONFIG_HOME: '/xdg' }, HOME)).toBe(
      path.join(HOME, 'Library', 'Application Support'),
    );
  });
});

describe('userDataDir', () => {
  it('appends the app name to the platform root', () => {
    expect(userDataDir('linux', {}, HOME)).toBe(path.join(HOME, '.config', APP_NAME));
    expect(userDataDir('darwin', {}, HOME)).toBe(
      path.join(HOME, 'Library', 'Application Support', APP_NAME),
    );
  });

  it('lets CCMON_USER_DATA override everything', () => {
    expect(userDataDir('linux', { CCMON_USER_DATA: '/custom' }, HOME)).toBe('/custom');
    expect(userDataDir('win32', { CCMON_USER_DATA: '/custom', APPDATA: 'C:\\R' }, HOME)).toBe(
      '/custom',
    );
  });
});
