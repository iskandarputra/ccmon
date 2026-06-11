/**
 * @file SessionsView.tsx
 * @brief Sessions view — sortable session table with context gauges.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState } from 'react';
import { Panel } from '../components/ui/Panel';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import {
  fmtUSD,
  fmtTok,
  fmtInt,
  fmtDuration,
  relTime,
  shortModel,
  projectName,
  tildify,
} from '../lib/format';
import type { SessionContext, SessionRow } from '../../shared/types';
import './sessions.css';

type ColumnKey =
  | 'project'
  | 'lastTs'
  | 'durationMs'
  | 'entries'
  | 'tokens'
  | 'cost'
  | 'models'
  | 'context';

type SortDir = 'asc' | 'desc';

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'project', label: 'project' },
  { key: 'lastTs', label: 'last active' },
  { key: 'durationMs', label: 'duration' },
  { key: 'entries', label: 'msgs' },
  { key: 'tokens', label: 'tokens' },
  { key: 'cost', label: 'cost' },
  { key: 'models', label: 'models' },
  { key: 'context', label: 'context' },
];

function sortValue(s: SessionRow, key: ColumnKey): string | number {
  switch (key) {
    case 'project':
      return projectName(s.project || '').toLowerCase();
    case 'tokens':
      return (s.in || 0) + (s.out || 0);
    case 'models':
      return s.models?.length || 0;
    case 'context':
      return s.context && Number.isFinite(s.context.pct) ? s.context.pct : -1;
    default:
      return s[key] || 0;
  }
}

const ctxColor = (pct: number) =>
  pct < 50 ? 'var(--ok)' : pct <= 80 ? 'var(--warn)' : 'var(--bad)';

interface ContextGaugeProps {
  ctx: SessionContext | null;
}

function ContextGauge({ ctx }: ContextGaugeProps) {
  if (!ctx) return <span className="ses-none">—</span>;
  const pct = Number.isFinite(ctx.pct) ? ctx.pct : 0;
  return (
    <div className="ses-ctx" title={`${pct.toFixed(1)}% of context window`}>
      <span className="ses-ctx-label">
        {fmtTok(ctx.tokens)} / {fmtTok(ctx.limit)}
      </span>
      <span className="ses-gauge">
        <i
          style={{
            width: `${Math.min(100, Math.max(pct, 2))}%`,
            background: ctxColor(pct),
          }}
        />
      </span>
    </div>
  );
}

interface ModelChipsProps {
  models?: string[];
}

function ModelChips({ models = [] }: ModelChipsProps) {
  if (!models.length) return <span className="ses-none">—</span>;
  const shown = models.slice(0, 3);
  const extra = models.length - shown.length;
  return (
    <div className="ses-chips" title={models.map(shortModel).join(' · ')}>
      {shown.map((m) => (
        <span key={m} className="ses-chip">
          {shortModel(m)}
        </span>
      ))}
      {extra > 0 && <span className="ses-chip ses-chip-more">+{extra}</span>}
    </div>
  );
}

export function SessionsView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const now = useNow(30000);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: ColumnKey; dir: SortDir }>({
    key: 'lastTs',
    dir: 'desc',
  });

  const sessions = snapshot.sessions || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s.project || '').toLowerCase().includes(q) ||
        (s.id || '').toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      return cmp * mul;
    });
  }, [filtered, sort]);

  const totalCost = useMemo(
    () => filtered.reduce((sum, s) => sum + (s.cost || 0), 0),
    [filtered]
  );

  const onSort = (key: ColumnKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'project' ? 'asc' : 'desc' }
    );

  if (!sessions.length) {
    return (
      <div className="grid">
        <div className="g12">
          <Panel title="sessions">
            <p className="ses-empty">no sessions recorded yet</p>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="g12">
        <Panel
          title="sessions"
          right={
            <div className="ses-head">
              <input
                className="ses-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter by project or session id"
                spellCheck={false}
                aria-label="filter sessions"
              />
              <span className="ses-meta">
                {filtered.length} of {sessions.length} sessions
              </span>
              <span className="ses-total">{fmtUSD(totalCost)}</span>
            </div>
          }
        >
          <div className="ses-tbl-wrap">
            <table className="tbl ses-tbl">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>
                      <button
                        className={`ses-th ${sort.key === c.key ? 'is-sorted' : ''}`}
                        onClick={() => onSort(c.key)}
                      >
                        {c.label}
                        {sort.key === c.key && (
                          <span className="ses-arrow">
                            {sort.dir === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={`${s.id}|${s.project}`}>
                    <td className="ses-proj" title={tildify(s.project || '')}>
                      <div className="ses-proj-name">{projectName(s.project)}</div>
                      <div className="ses-proj-id">{(s.id || '').slice(0, 8)}</div>
                    </td>
                    <td>{relTime(s.lastTs, now)}</td>
                    <td>{fmtDuration(s.durationMs)}</td>
                    <td>{fmtInt(s.entries)}</td>
                    <td>{fmtTok((s.in || 0) + (s.out || 0))}</td>
                    <td className="t-cost">{fmtUSD(s.cost)}</td>
                    <td>
                      <ModelChips models={s.models} />
                    </td>
                    <td>
                      <ContextGauge ctx={s.context} />
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length}>
                      <div className="ses-empty ses-empty-center">
                        no sessions match “{query.trim()}”
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
