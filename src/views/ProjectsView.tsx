/**
 * @file ProjectsView.tsx
 * @brief Projects view — per-project costs, cache hit, subagent share.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState } from 'react';
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
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={daily} margin={{ top: 3, right: 2, bottom: 1, left: 2 }}>
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

interface ProjectCardProps {
  p: ProjectRow;
  now: number;
}

function ProjectCard({ p, now }: ProjectCardProps) {
  return (
    <article className="prj-card">
      <div className="prj-title">
        <h4 className="prj-name">{projectName(p.path)}</h4>
        <div className="prj-path" title={p.path}>{tildify(p.path)}</div>
      </div>

      <div className="prj-spark">
        <Sparkline daily={p.daily} />
      </div>

      <dl className="prj-stats">
        <div className="prj-stat">
          <dt>today</dt>
          <dd className={p.todayCost > 0 ? 'prj-hot' : ''}>{fmtUSD(p.todayCost)}</dd>
        </div>
        <div className="prj-stat">
          <dt>7d</dt>
          <dd>{fmtUSD(p.weekCost)}</dd>
        </div>
        <div className="prj-stat">
          <dt>total</dt>
          <dd>{fmtUSD(p.cost)}</dd>
        </div>
        <div className="prj-stat">
          <dt>sessions</dt>
          <dd>{fmtInt(p.sessions)}</dd>
        </div>
        <div className="prj-stat">
          <dt>msgs</dt>
          <dd>{fmtInt(p.entries)}</dd>
        </div>
        <div className="prj-stat">
          <dt>tokens</dt>
          <dd>{fmtTok(p.tokens)}</dd>
        </div>
        <div className="prj-stat" title="cache hit: read ÷ (read + uncached input)">
          <dt>cache hit</dt>
          <dd>{p.read + p.in > 0 ? fmtPct((p.read / (p.read + p.in)) * 100) : '—'}</dd>
        </div>
        <div className="prj-stat" title="share of est cost from sidechain (subagent) turns">
          <dt>subagents</dt>
          <dd>{p.cost > 0 && p.sidechainCost > 0 ? fmtPct((p.sidechainCost / p.cost) * 100) : '—'}</dd>
        </div>
        <div className="prj-stat">
          <dt>last active</dt>
          <dd className="prj-dim">{relTime(p.lastTs, now)}</dd>
        </div>
      </dl>
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
              <input
                className="prj-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter by path…"
                spellCheck={false}
              />
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
            <p className="view-placeholder">no project activity yet</p>
          ) : filtered.length === 0 ? (
            <p className="view-placeholder">no projects match</p>
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
