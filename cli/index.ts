/**
 * @file index.ts
 * @brief ccmon CLI entry — headless snapshot, CSV export and statusline.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Runs the same pipeline the desktop app runs (discover → parse → dedupe →
 * price → aggregate) with no Electron and no window, which is possible only
 * because `electron/services/` never imports Electron. `npm run smoke` has
 * always proved that; this turns it into a supported surface.
 *
 * Read-only by design:
 *   - settings come from the app's stored `settings.json`, flags override
 *   - plan limits are read from the app's persisted history, NEVER polled, so
 *     the CLI cannot touch or rotate the Claude Code login
 *   - the only possible network call is a pricing refresh, which `--offline`
 *     (and the app's `pricingOffline` setting) disables
 */

import path from 'path';
import { detectSourceRoots } from '../electron/services/adapters';
import { loadConfig } from '../electron/services/config';
import { Settings } from '../electron/services/settings';
import { createPricingEngine } from '../electron/services/pricing';
import { PricingArchive } from '../electron/services/pricing-archive';
import { UsageWatcher } from '../electron/services/watcher';
import { buildSnapshot } from '../electron/services/aggregate';
import { snapshotToCsv } from '../electron/services/export';
import { visibleAccountDirs } from '../electron/services/account-setup';
import { resolveRange } from '../shared/range';
import type { Snapshot, TimeRange } from '../shared/types';
import { DEFAULT_SCAN_DAYS, HELP, parseArgs, type ParsedArgs } from './args';
import { formatStatusline, parseHookPayload } from './statusline';
import { userDataDir } from './userdata';

/** package.json version, resolved at build time via the JSON import. */
import pkg from '../package.json';

/** Read all of stdin, or '' when nothing is piped (a TTY, or a closed pipe). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The time range to aggregate over: CLI flags win, else the app's setting. */
function rangeFor(args: ParsedArgs, stored: TimeRange | null): TimeRange {
  if (args.since || args.until) {
    return { preset: 'custom', customStart: args.since, customEnd: args.until };
  }
  if (args.range) return { preset: args.range };
  return stored ?? { preset: 'all' };
}

/** Keep only the requested top-level snapshot keys, erroring on unknown ones. */
function pickSections(snap: Snapshot, sections: string[]): Record<string, unknown> {
  const all = snap as unknown as Record<string, unknown>;
  const unknown = sections.filter((s) => !(s in all));
  if (unknown.length) {
    const known = Object.keys(all).sort().join(', ');
    throw new Error(`unknown section(s): ${unknown.join(', ')}\navailable: ${known}`);
  }
  const out: Record<string, unknown> = {};
  for (const s of sections) out[s] = all[s];
  return out;
}

/** The snapshot plus the display flags the caller needs but can't re-derive. */
interface CliBuild {
  snap: Snapshot;
  /** settings.privacyMode — masks money on the statusline, never in json/csv */
  privacy: boolean;
}

async function buildForCli(args: ParsedArgs): Promise<CliBuild> {
  const userData = userDataDir();
  const cfg = loadConfig();

  // The app's stored settings are the defaults so the CLI agrees with the UI.
  const settings = new Settings(path.join(userData, 'settings.json')).get();
  const costMode = args.costMode ?? settings.costMode;
  const timezone = args.timezone ?? settings.timezone ?? null;
  const offline = args.offline || settings.pricingOffline;

  // Every adapter's roots, not just Claude Code's — the CLI has to see exactly
  // what the app sees, or `ccmon json` silently under-reports next to the UI.
  // `--source` carries no tool, so it is offered to every adapter and the one
  // that recognises the layout claims it; the config keys stay tool-specific.
  const roots = detectSourceRoots({
    claude: [...args.sources, ...(cfg.claudeDirs || [])],
    codex: [...args.sources, ...(cfg.codexDirs || [])],
  });
  if (!roots.length) {
    throw new Error(
      'no coding-CLI data directories found — set CLAUDE_CONFIG_DIR or pass --source <dir>',
    );
  }
  // Respect the app's hidden-account preference: a root the user hid in the UI
  // must stay hidden here too, or the CLI reports spend the app does not show.
  const visible = new Set(
    visibleAccountDirs(
      roots.map((r) => r.dir),
      settings.accountWrapperPrefs ?? {},
    ),
  );
  const sourceRoots = roots.filter((r) => visible.has(r.dir));
  const dirs = sourceRoots.map((r) => r.dir);

  const pricing = await createPricingEngine({
    cacheDir: userData,
    offline,
    overrides: cfg.pricing || {},
    archive: new PricingArchive(userData),
  });

  // Only statusline windows the scan; json/csv must never be silently partial.
  const scanDays = args.command === 'statusline' ? (args.scanDays ?? DEFAULT_SCAN_DAYS) : 0;
  const sinceMs = scanDays > 0 ? Date.now() - scanDays * 86_400_000 : null;

  const watcher = new UsageWatcher({
    dirs: sourceRoots, // adapter-tagged, so a Codex root parses as Codex
    watch: false,
    sinceMs,
    timezone: timezone || null,
  });
  const entries = await watcher.start();

  const now = Date.now();
  const snap = buildSnapshot(entries, {
    now,
    sourceDirs: dirs,
    version: pkg.version,
    pricing,
    settings: {
      ...settings,
      costMode,
      timezone: timezone || '',
      blockHours: args.sessionLength ?? settings.blockHours ?? null,
    },
    resetTs: watcher.resetTs,
    compactions: watcher.compactions,
    toolResults: watcher.toolResultsFor(null),
    range: resolveRange(rangeFor(args, null), now, timezone || null),
  });
  return { snap, privacy: !!settings.privacyMode };
}

async function run(argv: string[]): Promise<number> {
  const { args, error } = parseArgs(argv);
  if (error || !args) {
    process.stderr.write(`ccmon: ${error}\n\nRun \`ccmon --help\`.\n`);
    return 2;
  }

  if (args.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.command === 'version') {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  // statusline reads stdin BEFORE the scan: Claude Code pipes the payload and
  // waits, and a scan can take seconds on a large corpus.
  const hookRaw = args.command === 'statusline' ? await readStdin() : '';

  const { snap, privacy } = await buildForCli(args);

  if (args.command === 'statusline') {
    process.stdout.write(`${formatStatusline(snap, parseHookPayload(hookRaw), privacy)}\n`);
    return 0;
  }
  if (args.command === 'csv') {
    const { csv } = snapshotToCsv(snap, args.kind!);
    process.stdout.write(csv);
    return 0;
  }

  const body = args.sections ? pickSections(snap, args.sections) : snap;
  process.stdout.write(`${JSON.stringify(body, null, args.pretty ? 2 : 0)}\n`);
  return 0;
}

/**
 * `statusline` must never break the user's prompt: on any failure it prints
 * nothing and exits 0, because a Claude Code statusline command that errors
 * leaves an error smeared across every prompt. Every other command reports
 * loudly and exits non-zero.
 */
function isStatusline(argv: string[]): boolean {
  return argv[0] === 'statusline';
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (isStatusline(process.argv.slice(2))) {
      process.exitCode = 0;
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ccmon: ${msg}\n`);
    process.exitCode = 1;
  });
