/**
 * @file args.ts
 * @brief Pure argv → parsed-command for the ccmon CLI.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Kept free of IO so it is unit-testable: every failure is a returned error
 * string, never a throw or a process.exit.
 */

import { isValidZone } from '../shared/daykey';
import type { CostMode, ExportKind, RangePreset } from '../shared/types';

export const COMMANDS = ['json', 'csv', 'statusline', 'help', 'version'] as const;
export type Command = (typeof COMMANDS)[number];

const RANGE_PRESETS: RangePreset[] = ['today', '7d', '30d', '90d', 'month', 'lastMonth', 'all'];
const COST_MODES: CostMode[] = ['auto', 'calculate', 'display'];
const EXPORT_KINDS: ExportKind[] = ['days', 'sessions', 'projects', 'models'];

export interface ParsedArgs {
  command: Command;
  /** `csv` only — which table to serialize */
  kind: ExportKind | null;
  /** null = use the app's stored setting */
  range: RangePreset | null;
  since: string | null;
  until: string | null;
  costMode: CostMode | null;
  offline: boolean;
  pretty: boolean;
  /** `json` only — top-level snapshot keys to keep; null = the whole snapshot */
  sections: string[] | null;
  /** extra data roots, on top of what discovery finds */
  sources: string[];
  /** IANA zone for day bucketing; null = use the app's stored setting */
  timezone: string | null;
  /** block window in hours; null = use the app's stored setting (default 5) */
  sessionLength: number | null;
  /**
   * `statusline` only — how many days back to read transcripts. A prompt hook
   * has to answer in well under a second, and today's spend plus the active
   * 5-hour block can only live in recently-touched files. 0 = no window.
   */
  scanDays: number | null;
}

const DEFAULTS: ParsedArgs = {
  command: 'help',
  kind: null,
  range: null,
  since: null,
  until: null,
  costMode: null,
  offline: false,
  pretty: false,
  sections: null,
  sources: [],
  timezone: null,
  sessionLength: null,
  scanDays: null,
};

/** Default `statusline` scan window: wide enough to cover today across a
 *  midnight boundary and any 5-hour block, narrow enough to stay fast. */
export const DEFAULT_SCAN_DAYS = 2;

/** Accept `YYYY-MM-DD` and ccusage's `YYYYMMDD`; normalize to the day-key form. */
export function normalizeDayKey(raw: string): string | null {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export interface ParseResult {
  args: ParsedArgs | null;
  error: string | null;
}

const ok = (args: ParsedArgs): ParseResult => ({ args, error: null });
const fail = (error: string): ParseResult => ({ args: null, error });

/**
 * Parse `argv` (already stripped of node + script). The first non-flag token is
 * the command; `--help`/`--version` win wherever they appear so they work even
 * alongside an otherwise invalid line.
 */
export function parseArgs(argv: string[]): ParseResult {
  if (argv.includes('--help') || argv.includes('-h')) return ok({ ...DEFAULTS, command: 'help' });
  if (argv.includes('--version') || argv.includes('-v')) {
    return ok({ ...DEFAULTS, command: 'version' });
  }
  if (!argv.length) return ok({ ...DEFAULTS, command: 'help' });

  const out: ParsedArgs = { ...DEFAULTS, sources: [] };
  const rest = [...argv];

  const head = rest[0];
  if (!head || head.startsWith('-')) {
    return fail(`expected a command, got "${head ?? ''}" — try: ${COMMANDS.join(', ')}`);
  }
  if (!(COMMANDS as readonly string[]).includes(head)) {
    return fail(`unknown command "${head}" — try: ${COMMANDS.join(', ')}`);
  }
  out.command = head as Command;
  rest.shift();

  // `csv` takes a positional kind
  if (out.command === 'csv') {
    const kind = rest[0];
    if (!kind || kind.startsWith('-')) {
      return fail(`csv needs a table: ${EXPORT_KINDS.join(' | ')}`);
    }
    if (!(EXPORT_KINDS as string[]).includes(kind)) {
      return fail(`unknown csv table "${kind}" — try: ${EXPORT_KINDS.join(' | ')}`);
    }
    out.kind = kind as ExportKind;
    rest.shift();
  }

  /** The value following the flag at `i`, or null when it's missing/another flag. */
  const takeValue = (i: number): string | null => {
    const v = rest[i + 1];
    return v === undefined || v.startsWith('--') ? null : v;
  };

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    switch (a) {
      case '--offline':
        out.offline = true;
        break;
      case '--pretty':
        out.pretty = true;
        break;
      case '--range': {
        const v = takeValue(i);
        if (!v) return fail(`--range needs a value: ${RANGE_PRESETS.join(' | ')}`);
        if (!(RANGE_PRESETS as string[]).includes(v)) {
          return fail(`unknown range "${v}" — try: ${RANGE_PRESETS.join(' | ')}`);
        }
        out.range = v as RangePreset;
        i += 1;
        break;
      }
      case '--since':
      case '--until': {
        const v = takeValue(i);
        if (!v) return fail(`${a} needs a date (YYYY-MM-DD or YYYYMMDD)`);
        const key = normalizeDayKey(v);
        if (!key) return fail(`${a}: "${v}" is not a date (YYYY-MM-DD or YYYYMMDD)`);
        if (a === '--since') out.since = key;
        else out.until = key;
        i += 1;
        break;
      }
      case '--cost-mode': {
        const v = takeValue(i);
        if (!v) return fail(`--cost-mode needs a value: ${COST_MODES.join(' | ')}`);
        if (!(COST_MODES as string[]).includes(v)) {
          return fail(`unknown cost mode "${v}" — try: ${COST_MODES.join(' | ')}`);
        }
        out.costMode = v as CostMode;
        i += 1;
        break;
      }
      case '--section': {
        const v = takeValue(i);
        if (!v) return fail('--section needs a comma-separated list of snapshot keys');
        const keys = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!keys.length) return fail('--section needs at least one key');
        out.sections = [...(out.sections ?? []), ...keys];
        i += 1;
        break;
      }
      case '--source': {
        const v = takeValue(i);
        if (!v) return fail('--source needs a directory');
        out.sources.push(v);
        i += 1;
        break;
      }
      case '--timezone':
      case '-z': {
        const v = takeValue(i);
        if (!v) return fail('--timezone needs an IANA zone name, e.g. UTC or Asia/Tokyo');
        if (!isValidZone(v)) return fail(`--timezone: "${v}" is not a zone this runtime knows`);
        out.timezone = v;
        i += 1;
        break;
      }
      case '--session-length': {
        const v = takeValue(i);
        if (!v) return fail('--session-length needs a whole number of hours (1-24)');
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 24) {
          return fail(`--session-length: "${v}" is not a whole number of hours in 1-24`);
        }
        out.sessionLength = Number(v);
        i += 1;
        break;
      }
      case '--scan-days': {
        const v = takeValue(i);
        if (!v) return fail('--scan-days needs a whole number of days (0 = no window)');
        if (!/^\d+$/.test(v)) return fail(`--scan-days: "${v}" is not a whole number of days`);
        out.scanDays = Number(v);
        i += 1;
        break;
      }
      default:
        return fail(`unknown option "${a}"`);
    }
  }

  // --since/--until imply a custom range; an explicit --range would be ambiguous
  if ((out.since || out.until) && out.range) {
    return fail('--range cannot be combined with --since/--until');
  }
  if (out.since && out.until && out.since > out.until) {
    return fail(`--since ${out.since} is after --until ${out.until}`);
  }
  if (out.sections && out.command !== 'json') {
    return fail('--section only applies to `ccmon json`');
  }
  // json/csv must never be silently partial — a windowed scan would understate
  // lifetime totals with no way for the reader to tell.
  if (out.scanDays != null && out.command !== 'statusline') {
    return fail('--scan-days only applies to `ccmon statusline`');
  }
  return ok(out);
}

export const HELP = `ccmon — Claude Code usage, headless

USAGE
  ccmon <command> [options]

COMMANDS
  json                    the full analytics snapshot as JSON
  csv <table>             one table as CSV (${EXPORT_KINDS.join(' | ')})
  statusline              one compact line; reads the Claude Code
                          statusline hook payload on stdin
  help, version

OPTIONS
  --range <preset>        ${RANGE_PRESETS.join(' | ')}
  --since <date>          YYYY-MM-DD or YYYYMMDD (implies a custom range)
  --until <date>          same
  --cost-mode <mode>      ${COST_MODES.join(' | ')}
  --section <keys>        json only: comma-separated snapshot keys to keep
  --timezone <zone>, -z   IANA zone for day bucketing (default: the app's
                          setting, which defaults to the system zone)
  --session-length <h>    block window in hours (default 5 — only 5 matches
                          Anthropic's real billing window)
  --scan-days <n>         statusline only: read transcripts touched in the last
                          n days (default ${DEFAULT_SCAN_DAYS}, 0 = whole history)
  --source <dir>          extra data root (repeatable)
  --offline               never touch the network for pricing
  --pretty                indent JSON output
  -h, --help / -v, --version

NOTES
  Settings come from the desktop app's stored settings; flags override them.
  Nothing is written and no network call is made unless pricing needs a refresh
  (--offline disables that too). Live plan limits are read from the app's
  persisted history rather than polled, so the CLI never touches your login.

  \`statusline\` reads only recently-touched transcripts so it can answer inside
  a shell prompt. Today's spend and the active block are exact under that
  window; the per-session figure covers the window only, so a session older
  than --scan-days reads low. \`json\` and \`csv\` always read everything.

EXAMPLES
  ccmon json --range 30d --section totals,models --pretty
  ccmon json | jq '.totals.cost'
  ccmon csv days --since 20260101 > days.csv
  ccmon statusline   # in ~/.claude/settings.json statusLine.command
`;
