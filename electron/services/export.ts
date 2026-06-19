/**
 * @file export.ts
 * @brief Snapshot → CSV serialization for the data-export feature.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { ExportKind, Snapshot } from '../../shared/types';

/** RFC 4180 field: quote when it contains a comma, quote, or newline. */
function csvField(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ISO-8601 for an epoch ms, or '' for nullish. */
const iso = (ts: number | null | undefined): string => (ts ? new Date(ts).toISOString() : '');

interface Column<T> {
  header: string;
  value: (row: T) => string | number;
}

function table<T>(rows: T[], cols: Column<T>[]): { csv: string; rows: number } {
  const head = cols.map((c) => csvField(c.header)).join(',');
  const body = rows.map((r) => cols.map((c) => csvField(c.value(r))).join(','));
  return { csv: [head, ...body].join('\n') + '\n', rows: rows.length };
}

/**
 * Serialize one snapshot table to CSV. Pure and synchronous — main handles the
 * save dialog and file write. Numbers are emitted raw (full precision); the
 * renderer's display formatting is intentionally NOT applied so the data stays
 * analyzable in a spreadsheet.
 */
export function snapshotToCsv(snapshot: Snapshot, kind: ExportKind): { csv: string; rows: number } {
  switch (kind) {
    case 'days':
      return table(snapshot.days, [
        { header: 'date', value: (d) => d.date },
        { header: 'cost_usd', value: (d) => d.cost },
        { header: 'input', value: (d) => d.in },
        { header: 'output', value: (d) => d.out },
        { header: 'cache_read', value: (d) => d.read },
        { header: 'cache_write', value: (d) => d.write },
        { header: 'tokens', value: (d) => d.tokens },
        { header: 'all_tokens', value: (d) => d.allTokens },
        { header: 'entries', value: (d) => d.entries },
        { header: 'sessions', value: (d) => d.sessions },
      ]);
    case 'sessions':
      return table(snapshot.sessions, [
        { header: 'session_id', value: (s) => s.id },
        { header: 'project', value: (s) => s.project },
        { header: 'first', value: (s) => iso(s.firstTs) },
        { header: 'last', value: (s) => iso(s.lastTs) },
        { header: 'duration_ms', value: (s) => s.durationMs },
        { header: 'cost_usd', value: (s) => s.cost },
        { header: 'input', value: (s) => s.in },
        { header: 'output', value: (s) => s.out },
        { header: 'cache_read', value: (s) => s.read },
        { header: 'cache_write', value: (s) => s.write },
        { header: 'entries', value: (s) => s.entries },
      ]);
    case 'projects':
      return table(snapshot.projects, [
        { header: 'project', value: (p) => p.path },
        { header: 'cost_usd', value: (p) => p.cost },
        { header: 'today_usd', value: (p) => p.todayCost },
        { header: 'week_usd', value: (p) => p.weekCost },
        { header: 'tokens', value: (p) => p.tokens },
        { header: 'entries', value: (p) => p.entries },
        { header: 'sessions', value: (p) => p.sessions },
        { header: 'last', value: (p) => iso(p.lastTs) },
      ]);
    case 'models':
      return table(snapshot.models, [
        { header: 'model', value: (m) => m.model },
        { header: 'cost_usd', value: (m) => m.cost },
        { header: 'input', value: (m) => m.in },
        { header: 'output', value: (m) => m.out },
        { header: 'cache_read', value: (m) => m.read },
        { header: 'cache_write', value: (m) => m.write },
        { header: 'entries', value: (m) => m.entries },
        { header: 'sessions', value: (m) => m.sessions },
      ]);
  }
}
