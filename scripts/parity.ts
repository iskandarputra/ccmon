/**
 * @file parity.ts
 * @brief ccusage parity check — diffs grand token totals against ccusage over the same data.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Parity check against ccusage (docs/v2-spec.md §1 dedupe + token math).
 *
 * Scans the real ~/.claude data through ccmon's pipeline, runs
 * `npx ccusage@latest claude daily --json --offline` over the same files,
 * and compares GRAND TOKEN TOTALS for claude-* models. Tokens are the right
 * surface: they are independent of pricing versions, cost modes, and (at the
 * grand-total level) timezone bucketing — any drift means the dedupe or
 * parsing diverged. Manual / CI-optional: needs npx + network for the first
 * download. Exit 0 on parity, 1 on drift or unexpected output.
 */

import { execFileSync } from 'child_process';
import { detectProjectDirs } from '../electron/services/paths';
import { loadConfig } from '../electron/services/config';
import { UsageWatcher } from '../electron/services/watcher';

interface CcusageBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface CcusageDailyRow {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  modelBreakdowns?: CcusageBreakdown[];
}

type Totals = { in: number; out: number; write: number; read: number };

const fmt = (t: Totals) =>
  `in ${t.in} · out ${t.out} · write ${t.write} · read ${t.read}`;

async function main(): Promise<void> {
  // only the roots ccusage also reads — extra ccmon roots (multi-account
  // dirs like ~/.claude-work) would inflate our side of the comparison
  const dirs = detectProjectDirs(loadConfig().claudeDirs || []).filter(
    (d) => /[\\/]\.claude[\\/]projects$/.test(d) || /[\\/]\.config[\\/]claude[\\/]projects$/.test(d),
  );
  if (!dirs.length) {
    console.error('no standard Claude data directories found');
    process.exit(1);
  }
  console.log('comparing roots:', dirs.join(', '));

  console.log('scanning via ccmon pipeline…');
  const watcher = new UsageWatcher({ dirs, watch: false });
  const entries = await watcher.start();
  const mine: Totals = { in: 0, out: 0, write: 0, read: 0 };
  for (const e of entries) {
    mine.in += e.in;
    mine.out += e.out;
    mine.read += e.read;
    mine.write += e.w5m + e.w1h;
  }
  console.log(`ccmon   : ${entries.length} entries · ${fmt(mine)}`);

  console.log('running ccusage (npx, may download on first run)…');
  const raw = execFileSync(
    'npx',
    ['-y', 'ccusage@latest', 'claude', 'daily', '--json', '--offline'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 },
  );
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const rows = (parsed.daily ?? parsed.data) as CcusageDailyRow[] | undefined;
  if (!Array.isArray(rows)) {
    console.error('unexpected ccusage JSON shape — top-level keys:', Object.keys(parsed));
    process.exit(1);
  }

  const theirs: Totals = { in: 0, out: 0, write: 0, read: 0 };
  for (const row of rows) {
    const claude = (row.modelBreakdowns || []).filter((b) =>
      (b.modelName || '').includes('claude'),
    );
    // prefer the per-model split (excludes any non-claude rows), else the row
    const parts: CcusageBreakdown[] = claude.length ? claude : [row];
    for (const p of parts) {
      theirs.in += p.inputTokens || 0;
      theirs.out += p.outputTokens || 0;
      theirs.write += p.cacheCreationTokens || 0;
      theirs.read += p.cacheReadTokens || 0;
    }
  }
  console.log(`ccusage : ${rows.length} day rows · ${fmt(theirs)}`);

  const drift = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - b) / b);
  const checks: Array<[string, number, number]> = [
    ['input', mine.in, theirs.in],
    ['output', mine.out, theirs.out],
    ['cache write', mine.write, theirs.write],
    ['cache read', mine.read, theirs.read],
  ];
  let failed = false;
  for (const [label, a, b] of checks) {
    const d = drift(a, b);
    const ok = d < 0.001; // 0.1% — boundary-day bucketing noise at most
    if (!ok) failed = true;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(12)} ccmon ${a} vs ccusage ${b} (drift ${(d * 100).toFixed(3)}%)`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('parity FAILED:', err);
  process.exit(1);
});
