/**
 * @file scope.test.ts
 * @brief Unit tests for source-scope resolution and visible-entry filtering.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * These rules decide which accounts' money the user is shown. Until they were
 * lifted out of `electron/main.ts` they could not be tested at all, and the
 * failure mode of the hidden-account rule is silent: the totals just quietly
 * include an account the user removed from the view.
 */

import { describe, expect, it } from 'vitest';
import { dirsChanged, primaryDir, resolveSourceScope, visibleEntries } from '../scope';
import { makeEntry } from './helpers';

const MAIN = '/home/u/.claude/projects';
const WORK = '/home/u/.claude-work/projects';
const TEAM = '/home/u/.claude-team/projects';

describe('primaryDir', () => {
  it('prefers the standard ~/.claude root wherever it sits in the list', () => {
    expect(primaryDir([WORK, MAIN, TEAM])).toBe(MAIN);
  });

  it('falls back to the first root when there is no standard one', () => {
    expect(primaryDir([WORK, TEAM])).toBe(WORK);
  });

  it('is null with no roots at all', () => {
    expect(primaryDir([])).toBeNull();
  });

  it('recognises a Windows-style path', () => {
    const win = 'C:\\Users\\u\\.claude\\projects';
    expect(primaryDir(['C:\\Users\\u\\.claude-work\\projects', win])).toBe(win);
  });
});

describe('resolveSourceScope', () => {
  it('does not filter at all for a single account with nothing hidden', () => {
    expect(resolveSourceScope({ visible: [MAIN], all: [MAIN], selected: null })).toBeNull();
  });

  it('defaults to the primary account when several are visible', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK, TEAM],
      all: [MAIN, WORK, TEAM],
      selected: null,
    });
    // extra roots are opt-in — summing work and personal by default would
    // misreport spend for anyone who deliberately keeps them apart
    expect(scope).toEqual(new Set([MAIN]));
  });

  it('honours an explicit narrower selection', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK, TEAM],
      all: [MAIN, WORK, TEAM],
      selected: [WORK, TEAM],
    });
    expect(scope).toEqual(new Set([WORK, TEAM]));
  });

  it('treats selecting every visible root as "all"', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK],
      all: [MAIN, WORK],
      selected: [MAIN, WORK],
    });
    expect(scope).toBeNull();
  });

  it('ignores selected roots that no longer exist', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK],
      all: [MAIN, WORK],
      selected: [WORK, '/home/u/.claude-renamed/projects'],
    });
    expect(scope).toEqual(new Set([WORK]));
  });

  it('never filters down to nothing when the whole selection is stale', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK],
      all: [MAIN, WORK],
      selected: ['/gone/a', '/gone/b'],
    });
    expect(scope).toEqual(new Set([MAIN])); // the default, not an empty set
  });

  /**
   * The leak this file exists for. With an account hidden, "all" cannot be
   * `null`, because null means "skip the filter" — and the hidden account's
   * entries would be back in the totals the user just removed them from.
   */
  it('returns the explicit visible set — never null — while an account is hidden', () => {
    const scope = resolveSourceScope({
      visible: [MAIN, WORK],
      all: [MAIN, WORK, TEAM],
      selected: [MAIN, WORK], // "all" of what is visible
    });
    expect(scope).not.toBeNull();
    expect(scope).toEqual(new Set([MAIN, WORK]));
    expect(scope!.has(TEAM)).toBe(false);
  });

  it('still excludes the hidden account with no selection at all', () => {
    const scope = resolveSourceScope({ visible: [MAIN], all: [MAIN, WORK], selected: null });
    expect(scope).toEqual(new Set([MAIN]));
  });
});

describe('visibleEntries', () => {
  const entries = [
    makeEntry({ source: MAIN, in: 1 }),
    makeEntry({ source: WORK, in: 2 }),
    makeEntry({ source: TEAM, in: 3 }),
  ];

  it('returns the SAME array when nothing is hidden', () => {
    // identity matters: this runs over the whole entry list on every recompute
    expect(visibleEntries(entries, [MAIN, WORK, TEAM], [MAIN, WORK, TEAM])).toBe(entries);
  });

  it('drops entries belonging to a hidden account', () => {
    const out = visibleEntries(entries, [MAIN, WORK], [MAIN, WORK, TEAM]);
    expect(out.map((e) => e.in)).toEqual([1, 2]);
  });

  it('drops entries with no source when their root is not visible', () => {
    const orphan = [...entries, makeEntry({ source: undefined, in: 9 })];
    const out = visibleEntries(orphan, [MAIN], [MAIN, WORK, TEAM]);
    expect(out.map((e) => e.in)).toEqual([1]);
  });
});

describe('dirsChanged', () => {
  it('is false for the same list', () => {
    expect(dirsChanged([MAIN, WORK], [MAIN, WORK])).toBe(false);
  });

  it('is true when order changes', () => {
    expect(dirsChanged([MAIN, WORK], [WORK, MAIN])).toBe(true);
  });

  it('is true when a root is added or removed', () => {
    expect(dirsChanged([MAIN], [MAIN, WORK])).toBe(true);
  });

  /** A space-joined comparison would call these two lists equal. */
  it('distinguishes lists that a space-joined key would collide', () => {
    expect(dirsChanged(['/a b', '/c'], ['/a', 'b /c'])).toBe(true);
  });
});
