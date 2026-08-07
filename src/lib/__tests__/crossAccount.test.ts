/**
 * @file crossAccount.test.ts
 * @brief Unit tests for the cross-account headroom derive and resume command.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import {
  accountRoot,
  crossAccountAdvice,
  crossResumeCommand,
  effectiveWrapperAccounts,
  isDefaultAccountRoot,
  suggestWrapperName,
} from '../crossAccount';
import type {
  AccountInfo,
  AccountWrapperPrefs,
  AccountsMap,
  LimitsMap,
  LimitsResult,
} from '../../../shared/types';

const PERSONAL = '/home/isz/.claude/projects';
const WORK = '/home/isz/.claude-work/projects';

const acct = (hasCredentials: boolean): AccountInfo => ({
  plan: 'max',
  tier: '5x',
  email: null,
  organization: null,
  hasCredentials,
  cleanupPeriodDays: 30,
});

const ok = (session: number | null, week: number | null = null): LimitsResult => ({
  ok: true,
  fetchedAt: 0,
  session: session == null ? null : { pct: session, resetsAt: null },
  week: week == null ? null : { pct: week, resetsAt: null },
  weekOpus: null,
});

const accounts: AccountsMap = { [PERSONAL]: acct(true), [WORK]: acct(true) };

describe('crossAccountAdvice — session window', () => {
  it('advises moving off the capping account when another has room (urgent)', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(12) };
    const [a] = crossAccountAdvice(accounts, limits);
    expect(a).toMatchObject({ kind: 'session', fromDir: PERSONAL, toDir: WORK, urgent: true });
    expect(Math.round(a.fromPct)).toBe(96);
    expect(Math.round(a.toPct)).toBe(12);
    expect(a.targets[0].hasRoom).toBe(true);
  });

  it('ranks every account with room, most headroom first', () => {
    const V1 = '/home/isz/.claude-work-v1/projects';
    const three: AccountsMap = { ...accounts, [V1]: acct(true) };
    // personal caps at 100; both work accounts have room (3% and 0%)
    const limits: LimitsMap = { [PERSONAL]: ok(100), [WORK]: ok(3), [V1]: ok(0) };
    const [a] = crossAccountAdvice(three, limits);
    expect(a.fromDir).toBe(PERSONAL);
    expect(a.targets.map((t) => t.dir)).toEqual([V1, WORK]); // 0% before 3%
    expect(a.toDir).toBe(V1); // best == first target
  });

  it('keeps every logged-in account as a target but flags which have real room', () => {
    const V1 = '/home/isz/.claude-work-v1/projects';
    const three: AccountsMap = { ...accounts, [V1]: acct(true) };
    // V1 is itself near its cap (>= ROOM) — still a valid manual target, but no room
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(12), [V1]: ok(85) };
    const [a] = crossAccountAdvice(three, limits);
    expect(a.targets.map((t) => t.dir)).toEqual([WORK, V1]); // 12% before 85%
    expect(a.targets.map((t) => t.hasRoom)).toEqual([true, false]);
  });

  it('still shows (non-urgent) when the gap is too small', () => {
    // 85% vs 70% is only a 15pt gap (< 25) — no headroom win, but still switchable
    const limits: LimitsMap = { [PERSONAL]: ok(85), [WORK]: ok(70) };
    const [a] = crossAccountAdvice(accounts, limits);
    expect(a).toMatchObject({ fromDir: PERSONAL, toDir: WORK, urgent: false });
    expect(a.targets[0].hasRoom).toBe(false);
  });

  it('is not urgent when the alternative has no real room', () => {
    // both high: 96 vs 80 — the "alternative" is itself near its cap (>= ROOM)
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(80) };
    const [a] = crossAccountAdvice(accounts, limits);
    expect(a).toMatchObject({ urgent: false });
    expect(a.targets[0].hasRoom).toBe(false);
  });

  it('is available even at low utilization (flexibility), just not urgent', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(40), [WORK]: ok(10) };
    const [a] = crossAccountAdvice(accounts, limits);
    expect(a).toMatchObject({ fromDir: PERSONAL, toDir: WORK, urgent: false });
    // 40→10 is a 30pt gap and 10 < ROOM, so this target genuinely has room…
    expect(a.targets[0].hasRoom).toBe(true);
    // …but the source is nowhere near a cap, so it's a calm manual switch
  });

  it('will not route to an account without a stored login', () => {
    const noLoginWork: AccountsMap = { [PERSONAL]: acct(true), [WORK]: acct(false) };
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(5) };
    expect(crossAccountAdvice(noLoginWork, limits)).toHaveLength(0);
  });

  it('stays empty with only one account (nowhere to switch to)', () => {
    const solo: AccountsMap = { [PERSONAL]: acct(true) };
    const limits: LimitsMap = { [PERSONAL]: ok(90) };
    expect(crossAccountAdvice(solo, limits)).toHaveLength(0);
  });
});

describe('crossAccountAdvice — weekly window', () => {
  it('advises on the weekly window too', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(20, 91), [WORK]: ok(5, 8) };
    const a = crossAccountAdvice(accounts, limits);
    expect(a.some((x) => x.kind === 'week' && x.fromDir === PERSONAL && x.toDir === WORK)).toBe(
      true,
    );
  });
});

describe('accountRoot + crossResumeCommand', () => {
  it('strips the trailing /projects to get the config root', () => {
    expect(accountRoot(PERSONAL)).toBe('/home/isz/.claude');
    expect(accountRoot(WORK)).toBe('/home/isz/.claude-work');
  });

  it('builds the canonical helper command from the roots', () => {
    expect(crossResumeCommand(PERSONAL, WORK, 'abc-123')).toBe(
      '~/.local/bin/claude-cross-resume /home/isz/.claude /home/isz/.claude-work abc-123',
    );
  });

  it('uses a placeholder when no session id is known yet', () => {
    expect(crossResumeCommand(PERSONAL, WORK)).toMatch(/<session-id>$/);
  });

  it('quotes roots that contain spaces', () => {
    const spaced = '/home/isz/My Claude/projects';
    expect(crossResumeCommand(spaced, WORK, 'x')).toBe(
      '~/.local/bin/claude-cross-resume "/home/isz/My Claude" /home/isz/.claude-work x',
    );
  });
});

describe('suggestWrapperName + effectiveWrapperAccounts', () => {
  it('names the default root claude-personal, others claude-<suffix>', () => {
    expect(suggestWrapperName('/home/isz/.claude')).toBe('claude-personal');
    expect(suggestWrapperName('/home/isz/.claude-work')).toBe('claude-work');
  });

  it('resolves every source dir to its root with the suggested name by default', () => {
    const accounts = effectiveWrapperAccounts([PERSONAL, WORK], {});
    expect(accounts).toEqual([
      { name: 'claude-personal', root: '/home/isz/.claude' },
      { name: 'claude-work', root: '/home/isz/.claude-work' },
    ]);
  });

  it('applies a custom name override', () => {
    const prefs: Record<string, AccountWrapperPrefs> = {
      '/home/isz/.claude-work': { name: 'claude-client-x' },
    };
    const accounts = effectiveWrapperAccounts([PERSONAL, WORK], prefs);
    expect(accounts.find((a) => a.root === '/home/isz/.claude-work')?.name).toBe('claude-client-x');
  });

  it('drops a disabled (untracked) account entirely', () => {
    const prefs: Record<string, AccountWrapperPrefs> = {
      '/home/isz/.claude-work': { disabled: true },
    };
    const accounts = effectiveWrapperAccounts([PERSONAL, WORK], prefs);
    expect(accounts.map((a) => a.root)).toEqual(['/home/isz/.claude']);
  });
});

describe('isDefaultAccountRoot', () => {
  it('is true only for the literal ~/.claude root', () => {
    expect(isDefaultAccountRoot('/home/isz/.claude')).toBe(true);
    expect(isDefaultAccountRoot('/home/isz/.claude-work')).toBe(false);
    expect(isDefaultAccountRoot('/home/isz/.claude-personal')).toBe(false);
  });
});

describe('effectiveWrapperAccounts — env survives a rename/untrack rewrite', () => {
  it('carries a saved env through, since this list regenerates the whole file', () => {
    const dirs = [PERSONAL, WORK];
    const prefs = {
      '/home/isz/.claude-work': {
        name: 'claude-deepseek',
        env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
      },
    };
    const out = effectiveWrapperAccounts(dirs, prefs);
    expect(out).toEqual([
      { name: 'claude-personal', root: '/home/isz/.claude' },
      {
        name: 'claude-deepseek',
        root: '/home/isz/.claude-work',
        env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
      },
    ]);
  });

  it('omits the key entirely when there is no env', () => {
    expect(effectiveWrapperAccounts([PERSONAL], {})[0]).toEqual({
      name: 'claude-personal',
      root: '/home/isz/.claude',
    });
  });
});
