/**
 * @file ProjectsView.tsx
 * @brief Projects view — per-project costs, cache hit, subagent share.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import { fmtUSD, fmtTok, fmtInt, fmtPct, relTime, dayLabel, projectName, tildify } from '../lib/format';
import { withAlpha } from '../lib/palette';
import type { ProjectRow } from '../../shared/types';
import './projects.css';

type SortKey = 'recent' | 'total' | 'week';

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'recent' },
  { value: 'total', label: 'total cost' },
  { value: 'week', label: 'week cost' },
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

/** one per-project daily spend point (ProjectRow.daily item) */
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

interface SparklineProps {
  daily?: SparkPoint[];
}

function Sparkline({ daily }: SparklineProps) {
  if (!daily?.length) {
    return <div className="prj-spark-empty">no recent activity</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={daily} margin={{ top: 4, right: 0, bottom: 1, left: 0 }}>
        <Tooltip
          cursor={{ stroke: 'var(--line)', strokeDasharray: '3 3' }}
          content={<SparkTip />}
        />
        <Area
          type="linear"
          dataKey="cost"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          fill={withAlpha('var(--chart-1)', 0.16)}
          dot={false}
          activeDot={{ r: 2.5, fill: 'var(--chart-1)', stroke: 'none' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  title?: string;
  tone?: 'hot' | 'dim';
}

function StatTile({ label, value, title, tone }: StatTileProps) {
  return (
    <div className="prj-tile" title={title}>
      <span className="prj-tile-label">{label}</span>
      <span className={`prj-tile-value${tone ? ` prj-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

interface ProjectCardProps {
  p: ProjectRow;
  now: number;
}

function ProjectCard({ p, now }: ProjectCardProps) {
  const cacheHit = p.read + p.in > 0 ? fmtPct((p.read / (p.read + p.in)) * 100) : '—';
  const subagents = p.cost > 0 && p.sidechainCost > 0 ? fmtPct((p.sidechainCost / p.cost) * 100) : '—';

  return (
    <article className="prj-card">
      <header className="prj-head">
        <div className="prj-title">
          <h4 className="prj-name">{projectName(p.path)}</h4>
          <div className="prj-path" title={p.path}>{tildify(p.path)}</div>
        </div>
        <div className="prj-hero">
          <span className="prj-hero-label">total</span>
          <span className="prj-hero-value">{fmtUSD(p.cost)}</span>
        </div>
      </header>

      <div className="prj-spark">
        <Sparkline daily={p.daily} />
      </div>

      <div className="prj-stats">
        <StatTile label="today" value={fmtUSD(p.todayCost)} tone={p.todayCost > 0 ? 'hot' : undefined} />
        <StatTile label="7d" value={fmtUSD(p.weekCost)} />
        <StatTile label="sessions" value={fmtInt(p.sessions)} />
        <StatTile label="msgs" value={fmtInt(p.entries)} />
        <StatTile label="tokens" value={fmtTok(p.tokens)} />
        <StatTile
          label="cache hit"
          value={cacheHit}
          title="cache hit: read ÷ (read + uncached input)"
        />
        <StatTile
          label="subagents"
          value={subagents}
          title="share of est cost from sidechain (subagent) turns"
        />
        <StatTile label="last active" value={relTime(p.lastTs, now)} tone="dim" />
      </div>
    </article>
  );
}

export function ProjectsView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const now = useNow(30000);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');

  const projects = snapshot.projects || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter((p) => p.path.toLowerCase().includes(q))
      : projects.slice();
    if (sort === 'total') list.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    else if (sort === 'week') list.sort((a, b) => (b.weekCost || 0) - (a.weekCost || 0));
    else list.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    return list;
  }, [projects, query, sort]);

  const totalCost = useMemo(
    () => filtered.reduce((sum, p) => sum + (p.cost || 0), 0),
    [filtered],
  );

  return (
    <div className="grid">
      <div className="g12">
        <Panel
          title={<>projects <Hint label="what is this?">A breakdown of cost and activity scoped to individual project directories.</Hint></>}
          right={
            <div className="prj-controls">
              <label className="prj-search-wrap">
                <Glyph className="prj-search-icon">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.5" y2="16.5" />
                </Glyph>
                <input
                  className="prj-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="filter by path…"
                  spellCheck={false}
                />
              </label>
              <label className="prj-sortwrap">
                <select
                  className="prj-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <span className="prj-summary">
                {filtered.length} project{filtered.length === 1 ? '' : 's'} · {fmtUSD(totalCost)}
              </span>
            </div>
          }
        >
          {projects.length === 0 ? (
            <div className="prj-empty">
              <Glyph className="prj-empty-icon">
                <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2.5h8A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              </Glyph>
              <p className="prj-empty-lead">No project activity yet</p>
              <p className="prj-empty-sub">usage scoped to a project directory will appear here</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="prj-empty">
              <Glyph className="prj-empty-icon">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </Glyph>
              <p className="prj-empty-lead">No projects match</p>
              <p className="prj-empty-sub">try a different path fragment</p>
            </div>
          ) : (
            <div className="prj-grid">
              {filtered.map((p) => (
                <ProjectCard key={p.path} p={p} now={now} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
