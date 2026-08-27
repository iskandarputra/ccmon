/**
 * @file accounts.test.ts
 * @brief Unit tests for limit-window parsing from the OAuth usage endpoint.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { accountLabel, accountInfo, capAlerts, limitWindow } from '../accounts';
import type { LimitsResult } from '../../../shared/types';

describe('limitWindow — utilization scale', () => {
  it('reads utilization as a 0–100 percent directly', () => {
    expect(limitWindow({ utilization: 11 })?.pct).toBe(11);
    expect(limitWindow({ utilization: 73.5 })?.pct).toBe(73.5);
  });

  it('does NOT inflate a low single-digit percent (the 1% → 100% regression)', () => {
    // Endpoint reports a weekly all-models window at 1%; it must stay 1%,
    // not get multiplied to 100% by a fraction-detection heuristic.
    expect(limitWindow({ utilization: 1 })?.pct).toBe(1);
    expect(limitWindow({ utilization: 0.5 })?.pct).toBe(0.5);
    expect(limitWindow({ utilization: 0 })?.pct).toBe(0);
  });

  it('clamps out-of-range values into 0–100', () => {
    expect(limitWindow({ utilization: 142 })?.pct).toBe(100);
    expect(limitWindow({ utilization: -3 })?.pct).toBe(0);
  });

  it('parses resets_at to an epoch and tolerates a missing utilization', () => {
    const w = limitWindow({ resets_at: '2026-06-15T02:59:00Z' });
    expect(w?.pct).toBeNull();
    expect(w?.resetsAt).toBe(Date.parse('2026-06-15T02:59:00Z'));
  });

  it('keeps pct with a malformed resets_at', () => {
    const w = limitWindow({ utilization: 42, resets_at: 'not-a-date' });
    expect(w?.pct).toBe(42);
    expect(w?.resetsAt).toBeNull();
  });

  it('returns null when neither a numeric utilization nor a valid reset exists', () => {
    expect(limitWindow(undefined)).toBeNull();
    expect(limitWindow({})).toBeNull();
    expect(limitWindow({ resets_at: 'not-a-date' })).toBeNull();
    expect(limitWindow({ utilization: Number.NaN })).toBeNull();
  });
});

describe('accountInfo — cleanupPeriodDays', () => {
  let root: string;
  let projectDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-account-'));
    projectDir = path.join(root, 'projects');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'x' } }),
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("falls back to Claude Code's default (30) when settings.json is absent", () => {
    expect(accountInfo(projectDir)?.cleanupPeriodDays).toBe(30);
  });

  it('reads a custom cleanupPeriodDays from <root>/settings.json', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 90 }));
    expect(accountInfo(projectDir)?.cleanupPeriodDays).toBe(90);
  });

  it('falls back to the default on an invalid value (0, negative, non-numeric)', () => {
    for (const bad of [0, -5, 'never']) {
      fs.writeFileSync(
        path.join(root, 'settings.json'),
        JSON.stringify({ cleanupPeriodDays: bad }),
      );
      expect(accountInfo(projectDir)?.cleanupPeriodDays).toBe(30);
    }
  });
});

describe('accountLabel', () => {
  it('names the standard root "default"', () => {
    expect(accountLabel('/home/u/.claude/projects')).toBe('default');
  });

  it('strips the .claude- prefix from a sibling root', () => {
    expect(accountLabel('/home/u/.claude-work/projects')).toBe('work');
    expect(accountLabel('/home/u/.claude-work-team/projects')).toBe('work-team');
  });

  it('falls back to the directory name for an unconventional root', () => {
    expect(accountLabel('/opt/shared/projects')).toBe('shared');
  });

  it('never returns an empty label', () => {
    expect(accountLabel('/home/u/.claude-/projects')).toBe('.claude-');
  });

  it('keeps the tool in a Codex label so tray rows stay unambiguous', () => {
    // With both CLIs installed, a bare "work" would appear twice in the tray
    // context menu — the only readable surface on Linux.
    expect(accountLabel('/home/u/.codex/sessions')).toBe('codex');
    expect(accountLabel('/home/u/.codex/archived_sessions')).toBe('codex');
    expect(accountLabel('/home/u/.codex-work/sessions')).toBe('codex:work');
  });
});

describe('capAlerts', () => {
  const ok = (over: Partial<LimitsResult> = {}): LimitsResult =>
    ({
      ok: true,
      session: { pct: 20, resetsAt: 1000 },
      week: { pct: 20, resetsAt: 2000 },
      ...over,
    }) as LimitsResult;
  const none = new Map<string, number>();

  it('says nothing below the threshold', () => {
    expect(capAlerts('/d', ok(), none)).toEqual([]);
  });

  it('alerts on a window at or above the threshold', () => {
    const out = capAlerts('/d', ok({ session: { pct: 94, resetsAt: 1000 } }), none);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ window: 'session', pct: 94, key: '/d:session' });
  });

  it('alerts on both windows independently', () => {
    const out = capAlerts(
      '/d',
      ok({ session: { pct: 91, resetsAt: 1000 }, week: { pct: 99, resetsAt: 2000 } }),
      none,
    );
    expect(out.map((a) => a.window)).toEqual(['session', 'week']);
  });

  /**
   * The whole point of the reset-keyed dedupe: an account sitting at 94% for
   * three hours is polled ~180 times and must alert exactly once.
   */
  it('stays silent for the rest of the window once alerted', () => {
    const r = ok({ session: { pct: 94, resetsAt: 1000 } });
    const notified = new Map([['/d:session', 1000]]);
    expect(capAlerts('/d', r, notified)).toEqual([]);
  });

  it('re-arms when the window rolls over to a new resetsAt', () => {
    const notified = new Map([['/d:session', 1000]]);
    const r = ok({ session: { pct: 94, resetsAt: 5000 } }); // new cycle
    expect(capAlerts('/d', r, notified)).toHaveLength(1);
  });

  it('keys per account, so one account alerting does not mute another', () => {
    const notified = new Map([['/a:session', 1000]]);
    const r = ok({ session: { pct: 94, resetsAt: 1000 } });
    expect(capAlerts('/a', r, notified)).toEqual([]);
    expect(capAlerts('/b', r, notified)).toHaveLength(1);
  });

  it('says nothing for a failed limits fetch', () => {
    expect(capAlerts('/d', { ok: false, error: 'token expired' }, none)).toEqual([]);
  });

  it('ignores a window with no percentage', () => {
    expect(capAlerts('/d', ok({ session: null, week: null }), none)).toEqual([]);
  });

  it('honours a custom threshold', () => {
    const r = ok({ session: { pct: 55, resetsAt: 1000 } });
    expect(capAlerts('/d', r, none, 50)).toHaveLength(1);
    expect(capAlerts('/d', r, none, 60)).toEqual([]);
  });
});
