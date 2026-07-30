/**
 * @file args.test.ts
 * @brief Unit tests for CLI argv parsing — commands, options, and refusals.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_DAYS, parseArgs, normalizeDayKey } from '../args';

/** Parse and assert success, returning the args. */
function good(argv: string[]) {
  const { args, error } = parseArgs(argv);
  expect(error).toBeNull();
  if (!args) throw new Error('expected args');
  return args;
}

/** Parse and assert failure, returning the message. */
function bad(argv: string[]): string {
  const { args, error } = parseArgs(argv);
  expect(args).toBeNull();
  expect(error).toBeTruthy();
  return error!;
}

describe('normalizeDayKey', () => {
  it('accepts both YYYY-MM-DD and ccusage-style YYYYMMDD', () => {
    expect(normalizeDayKey('2026-07-30')).toBe('2026-07-30');
    expect(normalizeDayKey('20260730')).toBe('2026-07-30');
  });

  it('rejects anything else', () => {
    for (const v of ['', '2026-7-30', '30-07-2026', 'today', '202607', '2026073012']) {
      expect(normalizeDayKey(v)).toBeNull();
    }
  });
});

describe('parseArgs — commands', () => {
  it('defaults to help with no argv', () => {
    expect(good([]).command).toBe('help');
  });

  it('honours --help/-h and --version/-v anywhere, even beside bad input', () => {
    expect(good(['--help']).command).toBe('help');
    expect(good(['-h']).command).toBe('help');
    expect(good(['--version']).command).toBe('version');
    expect(good(['-v']).command).toBe('version');
    // help wins over what would otherwise be a parse error
    expect(good(['json', '--range', 'nope', '--help']).command).toBe('help');
  });

  it('accepts each real command', () => {
    expect(good(['json']).command).toBe('json');
    expect(good(['statusline']).command).toBe('statusline');
    expect(good(['csv', 'days']).command).toBe('csv');
  });

  it('rejects an unknown command and a leading flag', () => {
    expect(bad(['nope'])).toContain('unknown command');
    expect(bad(['--range', '7d'])).toContain('expected a command');
  });
});

describe('parseArgs — csv', () => {
  it('takes the table as a positional', () => {
    expect(good(['csv', 'sessions']).kind).toBe('sessions');
  });

  it('needs a table, and rejects an unknown one', () => {
    expect(bad(['csv'])).toContain('csv needs a table');
    expect(bad(['csv', '--pretty'])).toContain('csv needs a table');
    expect(bad(['csv', 'nope'])).toContain('unknown csv table');
  });
});

describe('parseArgs — options', () => {
  it('parses flags and valued options together', () => {
    const a = good(['json', '--range', '30d', '--cost-mode', 'calculate', '--offline', '--pretty']);
    expect(a).toMatchObject({
      range: '30d',
      costMode: 'calculate',
      offline: true,
      pretty: true,
    });
  });

  it('accumulates --source and --section', () => {
    const a = good(['json', '--source', '/a', '--source', '/b', '--section', 'totals,models']);
    expect(a.sources).toEqual(['/a', '/b']);
    expect(a.sections).toEqual(['totals', 'models']);
  });

  it('normalizes --since/--until into a custom range', () => {
    const a = good(['json', '--since', '20260101', '--until', '2026-01-31']);
    expect(a.since).toBe('2026-01-01');
    expect(a.until).toBe('2026-01-31');
    expect(a.range).toBeNull();
  });

  it('rejects missing values rather than swallowing the next flag', () => {
    expect(bad(['json', '--range'])).toContain('--range needs a value');
    expect(bad(['json', '--range', '--pretty'])).toContain('--range needs a value');
    expect(bad(['json', '--section'])).toContain('--section needs');
    expect(bad(['json', '--source'])).toContain('--source needs');
  });

  it('rejects unknown options and invalid enum values', () => {
    expect(bad(['json', '--nope'])).toContain('unknown option');
    expect(bad(['json', '--range', 'weekly'])).toContain('unknown range');
    expect(bad(['json', '--cost-mode', 'guess'])).toContain('unknown cost mode');
  });

  it('rejects contradictory or inverted ranges', () => {
    expect(bad(['json', '--range', '7d', '--since', '20260101'])).toContain('cannot be combined');
    expect(bad(['json', '--since', '2026-02-01', '--until', '2026-01-01'])).toContain(
      'is after',
    );
  });
});

describe('parseArgs — option scoping', () => {
  it('confines --section to json', () => {
    expect(bad(['csv', 'days', '--section', 'totals'])).toContain('only applies to');
    expect(bad(['statusline', '--section', 'totals'])).toContain('only applies to');
  });

  it('confines --scan-days to statusline, so json/csv can never be partial', () => {
    expect(good(['statusline', '--scan-days', '7']).scanDays).toBe(7);
    expect(good(['statusline', '--scan-days', '0']).scanDays).toBe(0);
    expect(bad(['json', '--scan-days', '7'])).toContain('only applies to');
    expect(bad(['csv', 'days', '--scan-days', '7'])).toContain('only applies to');
  });

  it('rejects a non-integer --scan-days', () => {
    expect(bad(['statusline', '--scan-days', '2.5'])).toContain('not a whole number');
    expect(bad(['statusline', '--scan-days', '-1'])).toContain('not a whole number');
    expect(bad(['statusline', '--scan-days'])).toContain('--scan-days needs');
  });

  it('leaves scanDays null so the runner can apply the default', () => {
    expect(good(['statusline']).scanDays).toBeNull();
    expect(DEFAULT_SCAN_DAYS).toBeGreaterThan(1); // must span a midnight boundary
  });
});

describe('parseArgs — timezone', () => {
  it('accepts a real IANA zone, long and short form', () => {
    expect(good(['json', '--timezone', 'Asia/Tokyo']).timezone).toBe('Asia/Tokyo');
    expect(good(['json', '-z', 'UTC']).timezone).toBe('UTC');
  });

  it('rejects a typo instead of silently bucketing elsewhere', () => {
    expect(bad(['json', '--timezone', 'Asia/Toyko'])).toContain('not a zone');
    expect(bad(['json', '-z', 'Nope'])).toContain('not a zone');
  });

  it('needs a value', () => {
    expect(bad(['json', '--timezone'])).toContain('--timezone needs');
  });

  it('applies to every data command, not just one', () => {
    expect(good(['csv', 'days', '-z', 'UTC']).timezone).toBe('UTC');
    expect(good(['statusline', '-z', 'UTC']).timezone).toBe('UTC');
  });

  it('leaves timezone null so the app setting wins by default', () => {
    expect(good(['json']).timezone).toBeNull();
  });
});
