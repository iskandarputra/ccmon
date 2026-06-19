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
} from '../crossAccount';
import type { AccountInfo, AccountsMap, LimitsMap, LimitsResult } from '../../../shared/types';

const PERSONAL = '/home/isz/.claude/projects';
const WORK = '/home/isz/.claude-work/projects';

const acct = (hasCredentials: boolean): AccountInfo => ({
  plan: 'max',
  tier: '5x',
  email: null,
  organization: null,
  hasCredentials,
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
  it('advises moving off the capping account when another has room', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(12) };
    const [a] = crossAccountAdvice(accounts, limits);
    expect(a).toMatchObject({ kind: 'session', fromDir: PERSONAL, toDir: WORK });
    expect(Math.round(a.fromPct)).toBe(96);
    expect(Math.round(a.toPct)).toBe(12);
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

  it('omits accounts without real room from the ranked targets', () => {
    const V1 = '/home/isz/.claude-work-v1/projects';
    const three: AccountsMap = { ...accounts, [V1]: acct(true) };
    // V1 is itself near its cap (>= ROOM) — only WORK qualifies
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(12), [V1]: ok(85) };
    const [a] = crossAccountAdvice(three, limits);
    expect(a.targets.map((t) => t.dir)).toEqual([WORK]);
  });

  it('stays silent when the gap is too small', () => {
    // 85% vs 70% is only a 15pt gap (< 25) — not worth a switch
    const limits: LimitsMap = { [PERSONAL]: ok(85), [WORK]: ok(70) };
    expect(crossAccountAdvice(accounts, limits)).toHaveLength(0);
  });

  it('stays silent when the alternative has no real room', () => {
    // both high: 96 vs 80 — the "alternative" is itself near its cap (>= ROOM)
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(80) };
    expect(crossAccountAdvice(accounts, limits)).toHaveLength(0);
  });

  it('stays silent when nothing is near a cap', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(40), [WORK]: ok(10) };
    expect(crossAccountAdvice(accounts, limits)).toHaveLength(0);
  });

  it('will not route to an account without a stored login', () => {
    const noLoginWork: AccountsMap = { [PERSONAL]: acct(true), [WORK]: acct(false) };
    const limits: LimitsMap = { [PERSONAL]: ok(96), [WORK]: ok(5) };
    expect(crossAccountAdvice(noLoginWork, limits)).toHaveLength(0);
  });
});

describe('crossAccountAdvice — weekly window', () => {
  it('advises on the weekly window too', () => {
    const limits: LimitsMap = { [PERSONAL]: ok(20, 91), [WORK]: ok(5, 8) };
    const a = crossAccountAdvice(accounts, limits);
    expect(a.some((x) => x.kind === 'week' && x.fromDir === PERSONAL && x.toDir === WORK)).toBe(true);
  });
});

describe('accountRoot + crossResumeCommand', () => {
  it('strips the trailing /projects to get the config root', () => {
    expect(accountRoot(PERSONAL)).toBe('/home/isz/.claude');
    expect(accountRoot(WORK)).toBe('/home/isz/.claude-work');
  });

  it('builds the canonical helper command from the roots', () => {
    expect(crossResumeCommand(PERSONAL, WORK, 'abc-123')).toBe(
      'claude-cross-resume /home/isz/.claude /home/isz/.claude-work abc-123',
    );
  });

  it('uses a placeholder when no session id is known yet', () => {
    expect(crossResumeCommand(PERSONAL, WORK)).toMatch(/<session-id>$/);
  });

  it('quotes roots that contain spaces', () => {
    const spaced = '/home/isz/My Claude/projects';
    expect(crossResumeCommand(spaced, WORK, 'x')).toBe(
      'claude-cross-resume "/home/isz/My Claude" /home/isz/.claude-work x',
    );
  });
});
