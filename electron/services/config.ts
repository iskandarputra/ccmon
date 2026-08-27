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
 *   "claudeDirs": ["/extra/claude/root", "~/archive/claude"],
 *   "codexDirs":  ["~/.codex-work"],           // dirs holding a `sessions/`
 *   "pricing": {                                   // per-MTok overrides
 *     "fable": { "in": 5, "out": 25, "w5m": 6.25, "w1h": 10, "read": 0.5 },
 *     "^my-proxy-opus": {
 *       "in": 15, "out": 75,
 *       "tier": { "in": 30 },                      // above-200k rates
 *       "contextLimit": 1000000,                   // drives the context gauge
 *       "fast": 6                                  // `-fast` variant multiplier
 *     }
 *   }
 * }
 *   "modelAliases": { "arn:aws:bedrock:...:profile/abc": "opus-4-6 (bedrock)" },
 *   "projectAliases": { "/home/me/Documents/work/api": "api" }
 *
 * Alias maps are DISPLAY ONLY — applied at render time, never before pricing or
 * grouping, so aliasing can never merge two models or shift a cost.
 *
 * Keys of `pricing` are case-insensitive regexes matched against model ids;
 * overrides win over the built-in table. Every field the engine consumes is
 * reachable — unset `tier` fields derive from `tier.in`, and `fast: 1` prices a
 * `-fast` variant absolutely instead of as a multiple. `claudeDirs` and
 * `codexDirs` entries may use a leading `~`, and each is routed to its OWN
 * adapter — a Claude root is never probed as a Codex home.
 */
export function loadConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as UserConfig;
  } catch {
    return {};
  }
}
