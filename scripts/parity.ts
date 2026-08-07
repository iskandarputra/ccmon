/**
 * @file parity.ts
 * @brief ccusage parity check — diffs grand token totals against ccusage over the same data.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Parity check against ccusage (docs/v2-spec.md §1 dedupe + token math).
 *
 * Scans the real ~/.claude data through ccmon's pipeline, runs
 * `npx ccusage@latest claude daily --json --offline` over the same files,
 * and compares GRAND TOKEN TOTALS. Tokens are the right surface: they are
 * independent of pricing versions, cost modes, and (at the grand-total level)
 * timezone bucketing — any drift means the dedupe or parsing diverged.
 * Manual / CI-optional: needs npx + network for the first download. Exit 0 on
 * parity, 1 on drift or unexpected output.
 *
 * EVERY model counts on both sides. `ccusage claude daily` reads exactly the
 * corpus ccmon scans, so anything in it belongs to both totals — including
 * non-Anthropic models run through Claude Code via a base-URL override (this
 * repo's own transcripts contain DeepSeek). Filtering one side to `claude-*`
 * silently compared different corpora: it reported ~47% input drift while the
 * two agreed per-day and per-model, and it hid behind an exact cache-write
 * match because DeepSeek bills no cache writes. Don't reintroduce a
 * model filter here.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { detectProjectDirs } from '../electron/services/paths';
import { loadConfig } from '../electron/services/config';
import { UsageWatcher } from '../electron/services/watcher';

interface CcusageTokens {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface CcusageDailyRow extends CcusageTokens {
  date?: string;
}

type Totals = { in: number; out: number; write: number; read: number };

const fmt = (t: Totals) => `in ${t.in} · out ${t.out} · write ${t.write} · read ${t.read}`;

/** One ccusage row/totals object → our shape. */
const tokensOf = (t: CcusageTokens): Totals => ({
  in: t.inputTokens || 0,
  out: t.outputTokens || 0,
  write: t.cacheCreationTokens || 0,
  read: t.cacheReadTokens || 0,
});

/**
 * Roots to compare, and the `CLAUDE_CONFIG_DIR` value that pins ccusage to
 * exactly the same ones.
 *
 * Two modes:
 *
 *   default   — the real `~/.claude` corpus. The strongest signal there is
 *               (tens of thousands of entries, every shape Claude Code has
 *               ever written) and the reason this script exists. Needs data on
 *               the machine, so it cannot run on a clean checkout.
 *
 *   --fixture — the committed corpus under `scripts/fixtures/parity/`, a small
 *               root holding one instance of each case where a naive
 *               implementation diverges: cumulative streaming chunks, a
 *               subagent entry mirrored into a parent transcript, an
 *               incomplete ephemeral-cache breakdown, a fast-speed turn, a
 *               non-Anthropic model, and lines that must NOT be billed
 *               (synthetic, usage-limit error, tool_result, compaction,
 *               malformed). This is what CI can run, because it ships with the
 *               repo.
 *
 * The fixture is a floor, not a replacement: it proves no rule regressed, the
 * real corpus proves no rule is missing. Run both before trusting a change to
 * the parser or the dedupe.
 */
function resolveRoots(useFixture: boolean): { dirs: string[]; configDir: string } {
  if (useFixture) {
    const root = path.join(__dirname, 'fixtures', 'parity');
    return { dirs: [path.join(root, 'projects')], configDir: root };
  }
  // only the roots ccusage also reads — extra ccmon roots (multi-account
  // dirs like ~/.claude-work) would inflate our side of the comparison
  const dirs = detectProjectDirs(loadConfig().claudeDirs || []).filter(
    (d) =>
      /[\\/]\.claude[\\/]projects$/.test(d) || /[\\/]\.config[\\/]claude[\\/]projects$/.test(d),
  );
  return { dirs, configDir: dirs.map((d) => path.dirname(d)).join(',') };
}

async function main(): Promise<void> {
  const useFixture = process.argv.includes('--fixture');
  const { dirs, configDir } = resolveRoots(useFixture);
  if (!dirs.length) {
    console.error(
      'no standard Claude data directories found\n' +
        'On a machine with no Claude Code history, run the committed corpus instead:\n' +
        '  npm run parity -- --fixture',
    );
    process.exit(1);
  }
  console.log(`comparing roots${useFixture ? ' (fixture)' : ''}:`, dirs.join(', '));

  console.log('scanning via ccmon pipeline…');
  const watcher = new UsageWatcher({ dirs, watch: false });
  const entries = await watcher.start();
  const mine: Totals = { in: 0, out: 0, write: 0, read: 0 };
  const mineDay = new Map<string, Totals>();
  for (const e of entries) {
    mine.in += e.in;
    mine.out += e.out;
    mine.read += e.read;
    mine.write += e.w5m + e.w1h;
    let d = mineDay.get(e.dateKey);
    if (!d) mineDay.set(e.dateKey, (d = { in: 0, out: 0, write: 0, read: 0 }));
    d.in += e.in;
    d.out += e.out;
    d.read += e.read;
    d.write += e.w5m + e.w1h;
  }
  console.log(`ccmon   : ${entries.length} entries · ${fmt(mine)}`);

  // Pin ccusage to EXACTLY the roots we just restricted ourselves to.
  //
  // ccusage does its own discovery and honours `CLAUDE_CONFIG_DIR`, which it
  // inherits from this process. Run parity from a shell where that variable
  // points at a non-default account (any `claude-<name>` wrapper session, and
  // ccmon's own setup wizard generates those) and the two sides silently read
  // DIFFERENT accounts: ccmon the standard root above, ccusage whatever the
  // environment named. The run still prints tidy percentages, so the failure
  // reads as a token-math regression rather than a harness bug. Setting it
  // explicitly makes the comparison independent of the shell it runs in.
  const ccusageRoots = configDir;
  console.log('running ccusage (npx, may download on first run)…');
  console.log('  CLAUDE_CONFIG_DIR pinned to:', ccusageRoots);
  const raw = execFileSync(
    'npx',
    ['-y', 'ccusage@latest', 'claude', 'daily', '--json', '--offline'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: ccusageRoots },
    },
  );
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const rows = (parsed.daily ?? parsed.data) as CcusageDailyRow[] | undefined;
  if (!Array.isArray(rows)) {
    console.error('unexpected ccusage JSON shape — top-level keys:', Object.keys(parsed));
    process.exit(1);
  }

  // ccusage publishes its own grand totals; prefer them over re-summing, and
  // fall back to the day rows if a future version drops the object.
  const totalsObj = parsed.totals as CcusageTokens | undefined;
  const theirs: Totals = totalsObj
    ? tokensOf(totalsObj)
    : rows.reduce<Totals>(
        (acc, row) => {
          const t = tokensOf(row);
          return {
            in: acc.in + t.in,
            out: acc.out + t.out,
            write: acc.write + t.write,
            read: acc.read + t.read,
          };
        },
        { in: 0, out: 0, write: 0, read: 0 },
      );
  console.log(
    `ccusage : ${rows.length} day rows · ${fmt(theirs)}` +
      `${totalsObj ? '' : '  (summed from rows — no totals object)'}`,
  );

  const theirDay = new Map<string, Totals>();
  for (const row of rows) if (row.date) theirDay.set(row.date, tokensOf(row));

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
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(12)} ccmon ${a} vs ccusage ${b} (drift ${(d * 100).toFixed(3)}%)`,
    );
  }

  // Localize on failure. Grand totals say "something diverged"; the per-day
  // table says WHERE, and distinguishes the two benign shapes from real drift:
  //   - adjacent days with mirror-image deltas → a midnight-boundary bucketing
  //     difference (ccmon buckets in local time), which cancels in the totals
  //   - a delta on today only → lines appended between the two scans
  // Anything else is genuine dedupe or parsing divergence.
  if (failed) {
    console.log('\nper-day deltas (ccmon minus ccusage), non-zero only:');
    const days = [...new Set([...mineDay.keys(), ...theirDay.keys()])].sort();
    const empty: Totals = { in: 0, out: 0, write: 0, read: 0 };
    console.log('  day           Δin        Δout       Δwrite     Δread');
    for (const day of days) {
      const a = mineDay.get(day) ?? empty;
      const b = theirDay.get(day) ?? empty;
      const d: Totals = {
        in: a.in - b.in,
        out: a.out - b.out,
        write: a.write - b.write,
        read: a.read - b.read,
      };
      if (!d.in && !d.out && !d.write && !d.read) continue;
      const col = (n: number) => String(n).padStart(10);
      console.log(`  ${day}  ${col(d.in)} ${col(d.out)} ${col(d.write)} ${col(d.read)}`);
    }
    console.log(
      '\nIf every listed day pairs off with an adjacent mirror image, the totals\n' +
        'should still match — check the drift lines above rather than this table.',
    );
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('parity FAILED:', err);
  process.exit(1);
});
