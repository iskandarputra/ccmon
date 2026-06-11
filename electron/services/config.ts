/**
 * @file config.ts
 * @brief Power-user config loader (~/.config/ccmon/config.json: extra roots, pricing overrides).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { UserConfig } from '../../shared/types';

export const CONFIG_PATH = path.join(os.homedir(), '.config', 'ccmon', 'config.json');

/**
 * Optional user config. Shape:
 * {
 *   "claudeDirs": ["/extra/claude/root"],          // additional data roots
 *   "pricing": {                                   // per-MTok overrides
 *     "fable": { "in": 5, "out": 25, "w5m": 6.25, "w1h": 10, "read": 0.5 }
 *   }
 * }
 * Keys of `pricing` are case-insensitive regexes matched against model ids;
 * overrides win over the built-in table.
 */
export function loadConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as UserConfig;
  } catch {
    return {};
  }
}
