/**
 * @file format.test.ts
 * @brief Unit tests for the display helpers that name accounts and durations.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { countdown, resetTime, sourceLabel } from '../format';

describe('sourceLabel — names an account from its source dir', () => {
  /**
   * The bug: this stripped the literal `projects` and nothing else, so a
   * Codex home — whose usage lives in `<home>/sessions` — was labelled
   * "sessions". That name then appeared as the card title, the scope-picker
   * tab and the plan-limits row, so the account read as though it were a
   * category of thing rather than someone's Codex login.
   */
  it('names a Codex account after its home, not its data dir', () => {
    expect(sourceLabel('/home/u/.codex/sessions')).toBe('codex');
    expect(sourceLabel('/home/u/.codex/archived_sessions')).toBe('codex');
    expect(sourceLabel('/home/u/.codex-work/sessions')).toBe('codex-work');
  });

  it('leaves Claude labels exactly as they were', () => {
    expect(sourceLabel('/home/u/.claude/projects')).toBe('claude');
    expect(sourceLabel('/home/u/.claude-work-ind/projects')).toBe('claude-work-ind');
    expect(sourceLabel('/opt/shared/projects')).toBe('shared');
  });

  it('never returns an empty label', () => {
    expect(sourceLabel('')).toBe('');
    expect(sourceLabel('/home/u/.claude/projects/')).toBe('claude');
  });
});

describe('countdown — how long is left', () => {
  it('reads minutes and hours as before', () => {
    expect(countdown(0)).toBe('0m');
    expect(countdown(90 * 1000)).toBe('2m');
    expect(countdown(2 * 3600_000 + 7 * 60_000)).toBe('2h 07m');
  });

  it('carries days, because a Codex free window resets MONTHLY', () => {
    // 437h is what the old hours-only format printed for an 18-day window
    expect(countdown(18 * 24 * 3600_000 + 4 * 3600_000 + 12 * 60_000)).toBe('18d 4h 12m');
  });

  it('crosses into days exactly at 24h', () => {
    expect(countdown(23 * 3600_000 + 59 * 60_000)).toBe('23h 59m');
    expect(countdown(24 * 3600_000)).toBe('1d 0h 00m');
  });
});

describe('resetTime — when a window clears', () => {
  const at = (iso: string) => Date.parse(iso);

  it('gives just the clock time for today', () => {
    const now = at('2026-08-27T10:00:00');
    expect(resetTime(at('2026-08-27T20:46:00'), now)).not.toContain(' on ');
  });

  it('names the day for a reset further out', () => {
    const now = at('2026-08-27T10:00:00');
    expect(resetTime(at('2026-09-14T20:46:00'), now)).toContain(' on ');
  });
});
