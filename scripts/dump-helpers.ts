/**
 * @file dump-helpers.ts
 * @brief Write the embedded cross-resume helper scripts to disk for syntax checking.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The helpers are JS template literals holding shell and PowerShell source, so
 * an escaping slip produces a script that is silently broken rather than a
 * failing test. Dump them and run them through `bash -n` / the PowerShell
 * parser — that is the only check that actually reads them as code.
 *
 *   npx tsx scripts/dump-helpers.ts <out-dir>
 */

import fs from 'fs';
import path from 'path';
import {
  CODEX_HELPER_SCRIPT,
  CODEX_PS_HELPER_SCRIPT,
} from '../electron/services/tools/codex-resume';

const out = process.argv[2];
if (!out) {
  console.error('usage: tsx scripts/dump-helpers.ts <out-dir>');
  process.exit(64);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'codex-cross-resume.sh'), CODEX_HELPER_SCRIPT);
fs.writeFileSync(path.join(out, 'codex-cross-resume.ps1'), CODEX_PS_HELPER_SCRIPT);
console.log(
  `wrote codex-cross-resume.sh (${CODEX_HELPER_SCRIPT.length} bytes) and ` +
    `codex-cross-resume.ps1 (${CODEX_PS_HELPER_SCRIPT.length} bytes) to ${out}`,
);
