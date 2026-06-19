/**
 * @file export.test.ts
 * @brief Unit tests for snapshot → CSV serialization (headers, escaping, rows).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { snapshotToCsv } from '../export';
import { buildSnapshot } from '../aggregate';
import { makeEntry, HOUR } from './helpers';

const NOW = Date.parse('2026-06-10T12:00:00');

const snap = (entries = [makeEntry({ ts: NOW - HOUR, in: 100, out: 50, costUSD: 3, project: '/p/a, b' })]) =>
  buildSnapshot([...entries].sort((a, b) => a.ts - b.ts), { now: NOW, settings: { startOfWeek: 'monday' } });

describe('snapshotToCsv', () => {
  it('emits a header row + one row per record for each kind', () => {
    const s = snap();
    for (const kind of ['days', 'sessions', 'projects', 'models'] as const) {
      const { csv, rows } = snapshotToCsv(s, kind);
      const lines = csv.trimEnd().split('\n');
      expect(lines.length).toBe(rows + 1); // header + data
      expect(lines[0]).toContain('cost_usd');
    }
  });

  it('quotes fields that contain commas and doubles inner quotes', () => {
    const s = snap([makeEntry({ ts: NOW - HOUR, costUSD: 1, project: '/p/a, "x"' })]);
    const { csv } = snapshotToCsv(s, 'projects');
    expect(csv).toContain('"/p/a, ""x"""');
  });

  it('days export has 35 rows (the zero-filled window) and raw numbers', () => {
    const { csv, rows } = snapshotToCsv(snap(), 'days');
    expect(rows).toBe(35);
    // a real cost value appears un-formatted (no $ or thousands separators)
    expect(csv).toMatch(/,3,/); // the $3 entry's cost column, raw
  });
});
