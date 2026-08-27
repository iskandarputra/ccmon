/**
 * @file SessionsView.tsx
 * @brief Sessions view — sortable session table with context gauges.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
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
  'project' | 'lastTs' | 'durationMs' | 'entries' | 'tokens' | 'cost' | 'models' | 'context';

type SortDir = 'asc' | 'desc';

const SES_ROW_H = 49; // fixed row height (px) the virtualizer assumes — see sessions.css

// right-aligned numeric columns share a class so headers + cells line up on the
// decimal/units edge; everything else stays left-aligned text.
const NUMERIC: ReadonlySet<ColumnKey> = new Set([
  'durationMs',
  'entries',
  'tokens',
  'cost',
  'models',
  'context',
]);

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

/** small inline SVG wrapper so all glyphs share stroke styling */
function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

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
      (s) => (s.project || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      return cmp * mul;
    });
  }, [filtered, sort]);

  const totalCost = useMemo(() => filtered.reduce((sum, s) => sum + (s.cost || 0), 0), [filtered]);

  const onSort = (key: ColumnKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'project' ? 'asc' : 'desc' },
    );

  // virtualize the table body — only visible rows hit the DOM, so the list
  // stays smooth even at the 500-session cap (rows are a fixed SES_ROW_H tall)
  const vr = useVirtualRows(sorted.length, SES_ROW_H);
  const visible = sorted.slice(vr.start, vr.end);

  if (!sessions.length) {
    return (
      <div className="grid">
        <div className="g12">
          <Panel
            title={
              <>
                sessions{' '}
                <Hint label="what is this?">
                  A complete, searchable list of all your local Claude Code sessions.
                </Hint>
              </>
            }
          >
            <div className="ses-empty">
              <Glyph className="ses-empty-icon">
                <path d="M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2z" />
                <path d="M4 7v10c0 1.1 3.6 2 8 2s8-.9 8-2V7" />
                <path d="M4 12c0 1.1 3.6 2 8 2s8-.9 8-2" />
              </Glyph>
              <p className="ses-empty-lead">no sessions recorded yet</p>
              <p className="ses-empty-sub">start a Claude Code session and it will appear here</p>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="g12">
        <Panel
          title={
            <>
              sessions{' '}
              <Hint label="what is this?">
                A complete, searchable list of all your local Claude Code sessions.
              </Hint>
            </>
          }
          right={
            <div className="ses-head">
              <label className="ses-search">
                <Glyph className="ses-search-icon">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.5" y2="16.5" />
                </Glyph>
                <input
                  className="ses-search-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="filter by project or session id"
                  spellCheck={false}
                  aria-label="filter sessions"
                />
              </label>
              <span className="ses-meta">
                {filtered.length} of {sessions.length} sessions
              </span>
              <span className="ses-total">{fmtUSD(totalCost)}</span>
            </div>
          }
        >
          <div className="ses-tbl-wrap" ref={vr.ref}>
            <table className="tbl ses-tbl">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={NUMERIC.has(c.key) ? 'ses-num' : undefined}>
                      <button
                        className={`ses-th ${sort.key === c.key ? 'is-sorted' : ''}`}
                        onClick={() => onSort(c.key)}
                      >
                        {c.label}
                        {sort.key === c.key && (
                          <Glyph className="ses-arrow">
                            {sort.dir === 'asc' ? (
                              <path d="M6 14l6-6 6 6" />
                            ) : (
                              <path d="M6 10l6 6 6-6" />
                            )}
                          </Glyph>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vr.padTop > 0 && (
                  <tr aria-hidden style={{ height: vr.padTop }}>
                    <td colSpan={COLUMNS.length} />
                  </tr>
                )}
                {visible.map((s) => (
                  <tr key={`${s.id}|${s.project}`}>
                    <td className="ses-proj" title={tildify(s.project || '')}>
                      <div className="ses-proj-name">{projectName(s.project)}</div>
                      <div className="ses-proj-id">{(s.id || '').slice(0, 8)}</div>
                    </td>
                    <td>{relTime(s.lastTs, now)}</td>
                    <td className="ses-num">{fmtDuration(s.durationMs)}</td>
                    <td className="ses-num">{fmtInt(s.entries)}</td>
                    <td className="ses-num">{fmtTok((s.in || 0) + (s.out || 0))}</td>
                    <td className="ses-num t-cost">{fmtUSD(s.cost)}</td>
                    <td className="ses-num">
                      <ModelChips models={s.models} />
                    </td>
                    <td className="ses-num">
                      <ContextGauge ctx={s.context} />
                    </td>
                  </tr>
                ))}
                {vr.padBottom > 0 && (
                  <tr aria-hidden style={{ height: vr.padBottom }}>
                    <td colSpan={COLUMNS.length} />
                  </tr>
                )}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length}>
                      <div className="ses-empty ses-empty-center">
                        <Glyph className="ses-empty-icon">
                          <circle cx="11" cy="11" r="7" />
                          <line x1="21" y1="21" x2="16.5" y2="16.5" />
                        </Glyph>
                        <p className="ses-empty-lead">no matching sessions</p>
                        <p className="ses-empty-sub">nothing matches “{query.trim()}”</p>
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
