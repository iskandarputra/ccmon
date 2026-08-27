/**
 * @file daykey.test.ts
 * @brief Unit tests for zone-aware day bucketing — the conversion everything trusts.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { dayKeyFor, isValidZone, resetZoneCaches, systemZone, zonedParts } from '../daykey';

afterEach(() => resetZoneCaches());

/** 2026-07-30T23:30:00Z — late enough in UTC to land on different days east/west. */
const LATE_UTC = Date.parse('2026-07-30T23:30:00Z');

describe('dayKeyFor — the documented ccusage example', () => {
  it('buckets 23:30 UTC per zone', () => {
    expect(dayKeyFor(LATE_UTC, 'UTC')).toBe('2026-07-30');
    expect(dayKeyFor(LATE_UTC, 'America/New_York')).toBe('2026-07-30'); // 19:30 EDT
    expect(dayKeyFor(LATE_UTC, 'Asia/Tokyo')).toBe('2026-07-31'); // 08:30 next day
  });

  it('handles a 45-minute offset zone, where whole-hour math would be wrong', () => {
    // 18:20 UTC + 05:45 = 00:05 next day in Kathmandu
    const ts = Date.parse('2026-07-30T18:20:00Z');
    expect(dayKeyFor(ts, 'UTC')).toBe('2026-07-30');
    expect(dayKeyFor(ts, 'Asia/Kathmandu')).toBe('2026-07-31');
    expect(zonedParts(ts, 'Asia/Kathmandu')).toMatchObject({ hour: 0, day: 31 });
  });

  it('handles a half-hour offset zone', () => {
    const ts = Date.parse('2026-07-30T18:45:00Z');
    expect(zonedParts(ts, 'Asia/Kolkata')).toMatchObject({ hour: 0, day: 31 }); // +05:30
    expect(dayKeyFor(ts, 'Asia/Kolkata')).toBe('2026-07-31');
  });

  it('handles a negative offset crossing back a day', () => {
    const ts = Date.parse('2026-07-30T04:00:00Z');
    expect(dayKeyFor(ts, 'Pacific/Honolulu')).toBe('2026-07-29'); // −10:00
  });
});

describe('dayKeyFor — system zone', () => {
  it('null, undefined and empty all mean the system zone', () => {
    const viaLocal = dayKeyFor(LATE_UTC);
    expect(dayKeyFor(LATE_UTC, null)).toBe(viaLocal);
    expect(dayKeyFor(LATE_UTC, undefined)).toBe(viaLocal);
    expect(dayKeyFor(LATE_UTC, '')).toBe(viaLocal);
  });

  it('matches what plain local getters would produce', () => {
    const d = new Date(LATE_UTC);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    expect(dayKeyFor(LATE_UTC, null)).toBe(expected);
  });

  it('agrees with the explicit system zone name', () => {
    expect(dayKeyFor(LATE_UTC, null)).toBe(dayKeyFor(LATE_UTC, systemZone()));
  });
});

describe('zonedParts', () => {
  it('reports a Monday-first weekday', () => {
    // 2026-07-30 is a Thursday → Monday-first index 3
    expect(zonedParts(Date.parse('2026-07-30T12:00:00Z'), 'UTC').weekday).toBe(3);
    // Sunday must be 6, not 0
    expect(zonedParts(Date.parse('2026-08-02T12:00:00Z'), 'UTC').weekday).toBe(6);
    // Monday must be 0
    expect(zonedParts(Date.parse('2026-08-03T12:00:00Z'), 'UTC').weekday).toBe(0);
  });

  it('rolls the weekday over with the day when the zone shifts it', () => {
    // Thu 23:30 UTC is already Fri in Tokyo
    expect(zonedParts(LATE_UTC, 'UTC').weekday).toBe(3);
    expect(zonedParts(LATE_UTC, 'Asia/Tokyo').weekday).toBe(4);
  });

  it('renders midnight as hour 0, never 24', () => {
    expect(zonedParts(Date.parse('2026-07-30T00:00:00Z'), 'UTC').hour).toBe(0);
    // midnight in Tokyo = 15:00Z the day before
    expect(zonedParts(Date.parse('2026-07-29T15:00:00Z'), 'Asia/Tokyo')).toMatchObject({
      hour: 0,
      day: 30,
    });
  });

  it('gives full calendar fields', () => {
    expect(zonedParts(Date.parse('2026-01-05T09:07:00Z'), 'UTC')).toEqual({
      year: 2026,
      month: 1,
      day: 5,
      hour: 9,
      weekday: 0, // Monday
    });
  });
});

describe('DST transitions', () => {
  it('uses the pre- and post-transition offsets on the right sides of a spring-forward', () => {
    // US DST 2026 begins 08 Mar 07:00Z (02:00 EST → 03:00 EDT)
    const before = Date.parse('2026-03-08T06:30:00Z'); // 01:30 EST
    const after = Date.parse('2026-03-08T07:30:00Z'); //  03:30 EDT
    expect(zonedParts(before, 'America/New_York').hour).toBe(1);
    expect(zonedParts(after, 'America/New_York').hour).toBe(3);
    expect(dayKeyFor(before, 'America/New_York')).toBe('2026-03-08');
    expect(dayKeyFor(after, 'America/New_York')).toBe('2026-03-08');
  });

  it('keeps a fall-back hour repeat on the same calendar day', () => {
    // US DST 2026 ends 01 Nov 06:00Z (02:00 EDT → 01:00 EST)
    const first = Date.parse('2026-11-01T05:30:00Z'); // 01:30 EDT
    const second = Date.parse('2026-11-01T06:30:00Z'); // 01:30 EST
    expect(zonedParts(first, 'America/New_York').hour).toBe(1);
    expect(zonedParts(second, 'America/New_York').hour).toBe(1);
    expect(dayKeyFor(first, 'America/New_York')).toBe('2026-11-01');
    expect(dayKeyFor(second, 'America/New_York')).toBe('2026-11-01');
  });

  it('does not leak a cached offset across a transition boundary', () => {
    // both sides resolved in one run, cache live between them
    const beforeKey = dayKeyFor(Date.parse('2026-03-08T06:59:00Z'), 'America/New_York');
    const afterKey = dayKeyFor(Date.parse('2026-03-08T07:01:00Z'), 'America/New_York');
    expect(beforeKey).toBe('2026-03-08');
    expect(afterKey).toBe('2026-03-08');
    expect(zonedParts(Date.parse('2026-03-08T06:59:00Z'), 'America/New_York').hour).toBe(1);
    expect(zonedParts(Date.parse('2026-03-08T07:01:00Z'), 'America/New_York').hour).toBe(3);
  });
});

describe('caching', () => {
  it('returns identical results warm and cold', () => {
    const zones = ['UTC', 'Asia/Tokyo', 'Asia/Kathmandu', 'America/New_York'];
    const stamps = [LATE_UTC, LATE_UTC + 60_000, LATE_UTC + 3_600_000];
    const cold = zones.flatMap((z) => stamps.map((t) => dayKeyFor(t, z)));
    const warm = zones.flatMap((z) => stamps.map((t) => dayKeyFor(t, z)));
    resetZoneCaches();
    const again = zones.flatMap((z) => stamps.map((t) => dayKeyFor(t, z)));
    expect(warm).toEqual(cold);
    expect(again).toEqual(cold);
  });
});

describe('isValidZone / systemZone', () => {
  it('accepts real zones and the empty system marker', () => {
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Asia/Tokyo')).toBe(true);
    expect(isValidZone('')).toBe(true);
  });

  it('rejects a typo instead of silently bucketing somewhere else', () => {
    expect(isValidZone('Asia/Toyko')).toBe(false);
    expect(isValidZone('Not/AZone')).toBe(false);
  });

  it('reports a resolvable system zone', () => {
    expect(isValidZone(systemZone())).toBe(true);
  });
});

describe('an unresolvable zone must never crash the caller', () => {
  it('falls back to UTC-ish behaviour rather than throwing', () => {
    expect(() => dayKeyFor(LATE_UTC, 'Not/AZone')).not.toThrow();
    // offset 0 → reads as UTC
    expect(dayKeyFor(LATE_UTC, 'Not/AZone')).toBe('2026-07-30');
  });
});
