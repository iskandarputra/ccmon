/**
 * @file range.test.ts
 * @brief Unit tests for the global time-range resolver.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { dayKeyInRange, isBoundedRange, resolveRange } from '../../../shared/range';
import type { ResolvedRange } from '../../../shared/types';

// Fixed reference: Fri 19 Jun 2026, local noon (tz-agnostic via local ctor).
const NOW = new Date(2026, 5, 19, 12, 0, 0).getTime();

describe('resolveRange — rolling presets', () => {
  it('today is a single day', () => {
    expect(resolveRange({ preset: 'today' }, NOW)).toEqual({
      preset: 'today',
      startKey: '2026-06-19',
      endKey: '2026-06-19',
      label: 'today',
    });
  });
  it('7d spans 7 inclusive days ending today', () => {
    expect(resolveRange({ preset: '7d' }, NOW)).toMatchObject({
      startKey: '2026-06-13',
      endKey: '2026-06-19',
      label: 'last 7 days',
    });
  });
  it('30d spans 30 inclusive days', () => {
    expect(resolveRange({ preset: '30d' }, NOW)).toMatchObject({
      startKey: '2026-05-21',
      endKey: '2026-06-19',
      label: 'last 30 days',
    });
  });
  it('90d spans 90 inclusive days', () => {
    expect(resolveRange({ preset: '90d' }, NOW)).toMatchObject({
      startKey: '2026-03-22',
      endKey: '2026-06-19',
    });
  });
});

describe('resolveRange — calendar presets', () => {
  it('month is first-of-month through today', () => {
    expect(resolveRange({ preset: 'month' }, NOW)).toEqual({
      preset: 'month',
      startKey: '2026-06-01',
      endKey: '2026-06-19',
      label: 'Jun 2026',
    });
  });
  it('lastMonth snaps to the full previous calendar month', () => {
    expect(resolveRange({ preset: 'lastMonth' }, NOW)).toEqual({
      preset: 'lastMonth',
      startKey: '2026-05-01',
      endKey: '2026-05-31',
      label: 'May 2026',
    });
  });
  it('lastMonth handles the year boundary', () => {
    const jan = new Date(2026, 0, 10, 12, 0, 0).getTime();
    expect(resolveRange({ preset: 'lastMonth' }, jan)).toMatchObject({
      startKey: '2025-12-01',
      endKey: '2025-12-31',
      label: 'Dec 2025',
    });
  });
});

describe('resolveRange — all + custom', () => {
  it('all is unbounded', () => {
    expect(resolveRange({ preset: 'all' }, NOW)).toEqual({
      preset: 'all',
      startKey: null,
      endKey: null,
      label: 'all time',
    });
  });
  it('custom keeps explicit bounds and labels them', () => {
    expect(
      resolveRange({ preset: 'custom', customStart: '2026-01-05', customEnd: '2026-02-10' }, NOW),
    ).toEqual({
      preset: 'custom',
      startKey: '2026-01-05',
      endKey: '2026-02-10',
      label: 'Jan 5 – Feb 10',
    });
  });
  it('custom normalizes reversed bounds', () => {
    expect(
      resolveRange({ preset: 'custom', customStart: '2026-02-10', customEnd: '2026-01-05' }, NOW),
    ).toMatchObject({
      startKey: '2026-01-05',
      endKey: '2026-02-10',
    });
  });
  it('custom with one open end labels directionally', () => {
    expect(
      resolveRange({ preset: 'custom', customStart: '2026-03-01', customEnd: null }, NOW).label,
    ).toBe('since Mar 1');
  });
});

describe('dayKeyInRange + isBoundedRange', () => {
  const r: ResolvedRange = {
    preset: '30d',
    startKey: '2026-05-21',
    endKey: '2026-06-19',
    label: 'last 30 days',
  };
  it('includes the inclusive edges', () => {
    expect(dayKeyInRange('2026-05-21', r)).toBe(true);
    expect(dayKeyInRange('2026-06-19', r)).toBe(true);
  });
  it('excludes outside the bounds', () => {
    expect(dayKeyInRange('2026-05-20', r)).toBe(false);
    expect(dayKeyInRange('2026-06-20', r)).toBe(false);
  });
  it('all-time accepts everything and is unbounded', () => {
    const all: ResolvedRange = { preset: 'all', startKey: null, endKey: null, label: 'all time' };
    expect(dayKeyInRange('2000-01-01', all)).toBe(true);
    expect(isBoundedRange(all)).toBe(false);
    expect(isBoundedRange(r)).toBe(true);
  });
});
