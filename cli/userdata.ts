/**
 * @file userdata.ts
 * @brief Headless resolution of Electron's userData directory.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The CLI reads the same state the app writes — settings, limits history, the
 * pricing archive and disk cache all live in Electron's `userData` dir. Electron
 * isn't loaded here (that's the whole point of `electron/services` staying pure
 * Node), so the platform convention is reproduced instead.
 *
 * Keep in sync with `app.getPath('userData')`, which is
 * `<per-platform app-data root>/<app name>` with the name taken from
 * package.json. If the app is ever renamed, or a `productName` is added to the
 * electron-builder config, this must follow.
 */

import os from 'os';
import path from 'path';

/** Must match package.json `name` — what Electron derives userData from. */
export const APP_NAME = 'ccmon';

/**
 * Electron's per-platform app-data root, honouring the same environment
 * overrides Electron does (`APPDATA` on Windows, `XDG_CONFIG_HOME` on Linux).
 */
export function appDataRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

/** The app's userData directory — where every persisted ccmon file lives. */
export function userDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  // CCMON_USER_DATA is an escape hatch for testing and for pointing the CLI at
  // a portable install; Electron has no equivalent, so it is CLI-only.
  if (env.CCMON_USER_DATA) return env.CCMON_USER_DATA;
  return path.join(appDataRoot(platform, env, home), APP_NAME);
}
