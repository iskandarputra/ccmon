/**
 * @file settings.ts
 * @brief Persisted UI settings with defaults and normalization.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../../shared/types';

/**
 * App-managed UI settings, persisted as JSON. Distinct from
 * ~/.config/ccmon/config.json, which holds hand-edited power-user overrides
 * (extra data dirs, pricing table patches); this file is owned by the UI.
 */
export const DEFAULTS: AppSettings = {
  theme: 'nord',
  costMode: 'auto', //        auto | calculate | display
  timezone: '', //            '' = system zone; else an IANA name
  pricingOffline: false, //   true → never hit the network for pricing
  startOfWeek: 'monday', //   weeks start monday — the sunday option is retired
  tokenLimit: 'max', //       'max' | tokens-per-block number | null (off)
  blockHours: null, //        null = 5h, Anthropic's real billing window
  compactNumbers: true,
  privacyMode: false, //      true = blank every money figure (display only)
  currency: 'USD', //         display currency (ISO code) — internals stay USD
  sources: null, //           null (primary account) | array of project dirs
  notifyNearCap: false, //    opt-in OS notifications when an account nears a cap
  closeToTray: false, //      opt-in: close hides to tray instead of quitting
  aiModel: 'claude-sonnet-4-6', // advisor model (reuses the Claude Code login)
  accountWrapperPrefs: {}, // per-root shell-wrapper rename/untrack overrides
};

export class Settings {
  private readonly file: string;
  private data: AppSettings;

  constructor(file: string) {
    this.file = file;
    // startOfWeek is forced: older settings files may still carry 'sunday'
    this.data = { ...DEFAULTS, ...this.read(), startOfWeek: 'monday' };
  }

  private read(): Partial<AppSettings> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppSettings>;
    } catch {
      return {};
    }
  }

  get(): AppSettings {
    return { ...this.data };
  }

  patch(partial: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...partial };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // 0600: accountWrapperPrefs[].env can carry a provider API token. The
      // mode is a no-op on Windows (which has no POSIX bits) — there the user
      // profile ACL is the only protection, as it is for .credentials.json.
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    } catch {
      /* persistence is best-effort */
    }
    return this.get();
  }
}
