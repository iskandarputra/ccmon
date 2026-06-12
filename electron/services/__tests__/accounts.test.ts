/**
 * @file accounts.test.ts
 * @brief Unit tests for limit-window parsing from the OAuth usage endpoint.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { limitWindow } from '../accounts';

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
