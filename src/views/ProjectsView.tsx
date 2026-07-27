/**
 * @file ProjectsView.tsx
 * @brief Executive Projects Intelligence View — grid & table view modes, sparklines, telemetry.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import {
  fmtUSD,
  fmtTok,
  fmtInt,
  fmtPct,
  relTime,
  dayLabel,
  projectName,
  tildify,
} from '../lib/format';
import { withAlpha } from '../lib/palette';
import type { ProjectRow } from '../../shared/types';
import './projects.css';

type SortKey = 'recent' | 'total' | 'week' | 'sessions' | 'cache';
type ViewMode = 'grid' | 'table';

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'most recent' },
  { value: 'total', label: 'highest cost' },
  { value: 'week', label: '7-day cost' },
  { value: 'sessions', label: 'session count' },
  { value: 'cache', label: 'cache hit %' },
];

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

interface SparkPoint {
  date: string;
  cost: number;
}

interface SparkTipProps {
  active?: boolean;
  payload?: Array<{ payload: SparkPoint }>;
}

function SparkTip({ active, payload }: SparkTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-row">
        <span>{dayLabel(d.date)}</span>
        <b>{fmtUSD(d.cost)}</b>
      </div>
    </div>
  );
}

function Sparkline({ daily }: { daily?: SparkPoint[] }) {
  if (!daily?.length) {
    return <div className="prj-spark-empty">no recent activity</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={daily} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Tooltip
          cursor={{ stroke: 'var(--line)', strokeDasharray: '3 3' }}
          content={<SparkTip />}
        />
        <Area
          type="monotone"
          dataKey="cost"
          stroke="var(--amber)"
          strokeWidth={1.5}
          fill={withAlpha('var(--amber)', 0.12)}
          dot={false}
          activeDot={{ r: 3, fill: 'var(--amber)', stroke: 'none' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ProjectCard({ p, now }: { p: ProjectRow; now: number }) {
  const cacheHit = p.read + p.in > 0 ? (p.read / (p.read + p.in)) * 100 : null;
  const subagentPct = p.cost > 0 && p.sidechainCost > 0 ? (p.sidechainCost / p.cost) * 100 : 0;

  return (
    <article className="prj-card">
      <div className="prj-card-top">
        <div className="prj-icon-box">
          <Glyph className="prj-folder-icon">
            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2.5h8A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
          </Glyph>
        </div>
        <div className="prj-meta">
          <h4 className="prj-name" title={projectName(p.path)}>
            {projectName(p.path)}
          </h4>
          <div className="prj-path" title={p.path}>
            {tildify(p.path)}
          </div>
        </div>
        <div className="prj-hero-cost">
          <span className="prj-cost-val">{fmtUSD(p.cost)}</span>
          <span className="prj-cost-lbl">total spend</span>
        </div>
      </div>

      <div className="prj-spark-wrap">
        <Sparkline daily={p.daily} />
      </div>

      <div className="prj-metrics-grid">
        <div className="prj-metric">
          <span className="prj-m-lbl">Today</span>
          <span className={`prj-m-val ${p.todayCost > 0 ? 'is-amber' : ''}`}>
            {fmtUSD(p.todayCost)}
          </span>
        </div>
        <div className="prj-metric">
          <span className="prj-m-lbl">7-Day</span>
          <span className="prj-m-val">{fmtUSD(p.weekCost)}</span>
        </div>
        <div className="prj-metric">
          <span className="prj-m-lbl">Sessions</span>
          <span className="prj-m-val">{fmtInt(p.sessions)}</span>
        </div>
        <div className="prj-metric">
          <span className="prj-m-lbl">Cache Hit</span>
          <span className="prj-m-val">{cacheHit != null ? fmtPct(cacheHit) : '—'}</span>
        </div>
      </div>

      <footer className="prj-card-foot">
        <div className="prj-foot-left">
          <span className="prj-tokens">{fmtTok(p.tokens)} tok</span>
          {subagentPct > 0 && (
            <span className="prj-sub-tag" title={`${fmtPct(subagentPct)} of cost from subagents`}>
              subagents {fmtPct(subagentPct)}
            </span>
          )}
        </div>
        <span className="prj-last-active">{relTime(p.lastTs, now)}</span>
      </footer>
    </article>
  );
}

export function ProjectsView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const now = useNow(30000);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [mode, setMode] = useState<ViewMode>('grid');

  const projects = snapshot.projects || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter((p) => p.path.toLowerCase().includes(q) || projectName(p.path).toLowerCase().includes(q))
      : projects.slice();

    if (sort === 'total') list.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    else if (sort === 'week') list.sort((a, b) => (b.weekCost || 0) - (a.weekCost || 0));
    else if (sort === 'sessions') list.sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
    else if (sort === 'cache') {
      list.sort((a, b) => {
        const ca = a.read + a.in > 0 ? a.read / (a.read + a.in) : 0;
        const cb = b.read + b.in > 0 ? b.read / (b.read + b.in) : 0;
        return cb - ca;
      });
    } else {
      list.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    }
    return list;
  }, [projects, query, sort]);

  const summary = useMemo(() => {
    const totalCost = filtered.reduce((s, p) => s + (p.cost || 0), 0);
    const totalSessions = filtered.reduce((s, p) => s + (p.sessions || 0), 0);
    const totalTokens = filtered.reduce((s, p) => s + (p.tokens || 0), 0);
    const topProject = filtered.length ? [...filtered].sort((a, b) => (b.cost || 0) - (a.cost || 0))[0] : null;

    return { totalCost, totalSessions, totalTokens, topProject };
  }, [filtered]);

  return (
    <div className="grid">
      {/* Top Intelligence Hero Summary */}
      <div className="g12">
        <div className="prj-hero-banner">
          <div className="prj-hero-card">
            <span className="prj-h-lbl">Total Project Spend</span>
            <span className="prj-h-val">{fmtUSD(summary.totalCost)}</span>
            <span className="prj-h-sub">{filtered.length} active workspace directories</span>
          </div>

          <div className="prj-hero-card">
            <span className="prj-h-lbl">Total Sessions</span>
            <span className="prj-h-val">{fmtInt(summary.totalSessions)}</span>
            <span className="prj-h-sub">{fmtTok(summary.totalTokens)} total tokens</span>
          </div>

          <div className="prj-hero-card">
            <span className="prj-h-lbl">Top Spender Workspace</span>
            <span className="prj-h-val prj-h-top">
              {summary.topProject ? projectName(summary.topProject.path) : '—'}
            </span>
            <span className="prj-h-sub">
              {summary.topProject ? fmtUSD(summary.topProject.cost) : 'No project data'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Directory Table / Grid Panel */}
      <div className="g12">
        <Panel
          title={
            <>
              project directories
              <Hint label="what is this?">
                Breakdown of LLM usage, cost estimates, and cache efficiency grouped by workspace directory.
              </Hint>
            </>
          }
          right={
            <div className="prj-toolbar">
              <label className="prj-search-box">
                <Glyph className="prj-search-icon">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.5" y2="16.5" />
                </Glyph>
                <input
                  className="prj-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by project or path…"
                  spellCheck={false}
                />
              </label>

              <select
                className="prj-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>

              <div className="pills">
                <button
                  type="button"
                  className={`pill${mode === 'grid' ? ' is-active' : ''}`}
                  onClick={() => setMode('grid')}
                >
                  grid
                </button>
                <button
                  type="button"
                  className={`pill${mode === 'table' ? ' is-active' : ''}`}
                  onClick={() => setMode('table')}
                >
                  table
                </button>
              </div>
            </div>
          }
        >
          {projects.length === 0 ? (
            <div className="prj-empty">
              <Glyph className="prj-empty-icon">
                <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2.5h8A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              </Glyph>
              <p className="prj-empty-lead">No project directories detected</p>
              <p className="prj-empty-sub">Usage in local project directories will automatically appear here</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="prj-empty">
              <Glyph className="prj-empty-icon">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </Glyph>
              <p className="prj-empty-lead">No matching projects found</p>
              <p className="prj-empty-sub">Try searching for a different directory name or path</p>
            </div>
          ) : mode === 'grid' ? (
            <div className="prj-grid-container">
              {filtered.map((p) => (
                <ProjectCard key={p.path} p={p} now={now} />
              ))}
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Project Workspace</th>
                    <th>Total Cost</th>
                    <th>Today</th>
                    <th>7-Day</th>
                    <th>Sessions</th>
                    <th>Tokens</th>
                    <th>Cache Hit</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const cacheHit = p.read + p.in > 0 ? (p.read / (p.read + p.in)) * 100 : null;
                    return (
                      <tr key={p.path}>
                        <td className="t-name">
                          <div className="tbl-prj-title">
                            <b>{projectName(p.path)}</b>
                            <span>{tildify(p.path)}</span>
                          </div>
                        </td>
                        <td className="t-cost">{fmtUSD(p.cost)}</td>
                        <td>{fmtUSD(p.todayCost)}</td>
                        <td>{fmtUSD(p.weekCost)}</td>
                        <td>{fmtInt(p.sessions)}</td>
                        <td>{fmtTok(p.tokens)}</td>
                        <td>{cacheHit != null ? fmtPct(cacheHit) : '—'}</td>
                        <td>{relTime(p.lastTs, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
