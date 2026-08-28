/**
 * @file ProjectsView.tsx
 * @brief Executive Projects & Sessions Explorer — Master-Detail split view, grid/table modes, session context telemetry.
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
  fmtDuration,
  relTime,
  dayLabel,
  projectName,
  tildify,
  projectAlias,
  shortModel,
} from '../lib/format';
import { withAlpha } from '../lib/palette';
import { KnowledgeGraphCanvas } from '../components/knowledge/KnowledgeGraphCanvas';
import type { ProjectRow } from '../../shared/types';
import './projects.css';

type SortKey = 'recent' | 'total' | 'week' | 'sessions' | 'cache';
type ViewMode = 'split' | 'grid' | 'table' | 'graph';

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

function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'is-copied' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy to clipboard"
    >
      {copied ? 'copied!' : label}
    </button>
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
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={daily} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
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

function pathLabel(p = ''): string {
  return projectAlias(p) ?? tildify(p);
}

const ctxColor = (pct: number) =>
  pct < 50 ? 'var(--ok)' : pct <= 80 ? 'var(--warn)' : 'var(--bad)';

function ProjectCard({ p, now, onSelect }: { p: ProjectRow; now: number; onSelect?: () => void }) {
  const cacheHit = p.read + p.in > 0 ? (p.read / (p.read + p.in)) * 100 : null;
  const subagentPct = p.cost > 0 && p.sidechainCost > 0 ? (p.sidechainCost / p.cost) * 100 : 0;

  return (
    <article
      className="prj-card"
      onClick={onSelect}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
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
            {pathLabel(p.path)}
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
  const [sessionQuery, setSessionQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [mode, setMode] = useState<ViewMode>('split');
  const [projGraphMode, setProjGraphMode] = useState<'chips' | 'graph'>('graph');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [graphProjectScope, setGraphProjectScope] = useState<'project' | 'all'>('project');

  const projects = snapshot.projects || [];
  const allSessions = snapshot.sessions || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter(
          (p) => p.path.toLowerCase().includes(q) || projectName(p.path).toLowerCase().includes(q),
        )
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

  // Active selected project
  const activeProject = useMemo(() => {
    if (!filtered.length) return null;
    if (selectedPath) {
      const match = filtered.find((p) => p.path === selectedPath);
      if (match) return match;
    }
    return filtered[0];
  }, [filtered, selectedPath]);

  // Filtered sessions for the selected project
  const activeSessions = useMemo(() => {
    if (!activeProject) return [];
    const base = allSessions.filter((s) => s.project === activeProject.path);
    const sq = sessionQuery.trim().toLowerCase();
    if (!sq) return base;
    return base.filter(
      (s) =>
        (s.id || '').toLowerCase().includes(sq) ||
        (s.models || []).some((m) => m.toLowerCase().includes(sq)),
    );
  }, [allSessions, activeProject, sessionQuery]);

  const summary = useMemo(() => {
    const totalCost = filtered.reduce((s, p) => s + (p.cost || 0), 0);
    const weekCost = filtered.reduce((s, p) => s + (p.weekCost || 0), 0);
    const totalSessions = filtered.reduce((s, p) => s + (p.sessions || 0), 0);
    const totalTokens = filtered.reduce((s, p) => s + (p.tokens || 0), 0);
    const topProject = filtered.length
      ? [...filtered].sort((a, b) => (b.cost || 0) - (a.cost || 0))[0]
      : null;

    return { totalCost, weekCost, totalSessions, totalTokens, topProject };
  }, [filtered]);

  return (
    <div className="grid">
      {/* 1. Hero KPI Telemetry Deck */}
      <div className="g12">
        <div className="prj-hero-banner">
          <div className="prj-hero-card">
            <span className="prj-h-lbl">Total Project Spend</span>
            <span className="prj-h-val">{fmtUSD(summary.totalCost)}</span>
            <span className="prj-h-sub">{filtered.length} active workspace directories</span>
          </div>

          <div className="prj-hero-card">
            <span className="prj-h-lbl">7-Day Velocity</span>
            <span className="prj-h-val">{fmtUSD(summary.weekCost)}</span>
            <span className="prj-h-sub">across all workspace projects</span>
          </div>

          <div className="prj-hero-card">
            <span className="prj-h-lbl">Total Sessions &amp; Runs</span>
            <span className="prj-h-val">{fmtInt(summary.totalSessions)}</span>
            <span className="prj-h-sub">{fmtTok(summary.totalTokens)} total tokens</span>
          </div>

          <div className="prj-hero-card">
            <span className="prj-h-lbl">Primary Spender</span>
            <span className="prj-h-val prj-h-top">
              {summary.topProject ? projectName(summary.topProject.path) : '—'}
            </span>
            <span className="prj-h-sub">
              {summary.topProject ? fmtUSD(summary.topProject.cost) : 'No project data'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Main Directory Table / Grid / Master-Detail Panel */}
      <div className="g12">
        <Panel
          title={
            <>
              project &amp; session explorer
              <Hint label="what is this?">
                Unified workspace directory and session explorer. Inspect LLM costs, cache
                efficiency, context limits, and session runs.
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
                  placeholder="Filter projects…"
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
                  className={`pill${mode === 'split' ? ' is-active' : ''}`}
                  onClick={() => setMode('split')}
                  title="Master-Detail split view"
                >
                  split
                </button>
                <button
                  type="button"
                  className={`pill${mode === 'grid' ? ' is-active' : ''}`}
                  onClick={() => setMode('grid')}
                  title="Grid cards"
                >
                  grid
                </button>
                <button
                  type="button"
                  className={`pill${mode === 'table' ? ' is-active' : ''}`}
                  onClick={() => setMode('table')}
                  title="Table view"
                >
                  table
                </button>
                <button
                  type="button"
                  className={`pill${mode === 'graph' ? ' is-active' : ''}`}
                  onClick={() => setMode('graph')}
                  title="Obsidian-style Force-Directed Knowledge Graph"
                >
                  knowledge graph
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
              <p className="prj-empty-sub">
                Usage in local project directories will automatically appear here
              </p>
            </div>
          ) : mode === 'graph' ? (
            <div
              style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              {/* Project Focus Toolbar */}
              <div className="prj-graph-selector-bar">
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--text-faint)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Project Focus:
                  </span>
                  <select
                    className="prj-select"
                    value={
                      graphProjectScope === 'all'
                        ? 'all'
                        : (selectedPath ?? activeProject?.path ?? 'all')
                    }
                    onChange={(e) => {
                      if (e.target.value === 'all') {
                        setGraphProjectScope('all');
                      } else {
                        setGraphProjectScope('project');
                        setSelectedPath(e.target.value);
                      }
                    }}
                    style={{ minWidth: '220px' }}
                  >
                    <option value="all">
                      ⚡ All Projects Combined ({snapshot.knowledge?.hotspots?.length ?? 0} files)
                    </option>
                    {filtered.map((p) => (
                      <option key={p.path} value={p.path}>
                        📁 {projectName(p.path)} ({p.hotspots?.length ?? 0} files · {fmtUSD(p.cost)}
                        )
                      </option>
                    ))}
                  </select>

                  <div
                    className="pills"
                    style={{ overflowX: 'auto', maxWidth: 'calc(100vw - 480px)' }}
                  >
                    {filtered.slice(0, 6).map((p) => {
                      const isSel =
                        graphProjectScope !== 'all' &&
                        (selectedPath === p.path ||
                          (!selectedPath && activeProject?.path === p.path));
                      return (
                        <button
                          key={p.path}
                          type="button"
                          className={`pill${isSel ? ' is-active' : ''}`}
                          onClick={() => {
                            setGraphProjectScope('project');
                            setSelectedPath(p.path);
                          }}
                        >
                          {projectName(p.path)}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`pill${graphProjectScope === 'all' ? ' is-active' : ''}`}
                      onClick={() => setGraphProjectScope('all')}
                    >
                      all projects
                    </button>
                  </div>
                </div>

                {/* Active Project Meta Pill */}
                {graphProjectScope !== 'all' && activeProject && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '12px',
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span>
                      <b>{activeProject.hotspots?.length ?? 0}</b> files
                    </span>
                    <span>·</span>
                    <span>
                      <b>{activeProject.layers?.length ?? 0}</b> domains
                    </span>
                    <span>·</span>
                    <span>
                      <b>{fmtUSD(activeProject.cost)}</b> spend
                    </span>
                    <span>·</span>
                    <span>
                      <b>{fmtInt(activeProject.sessions)}</b> sessions
                    </span>
                  </div>
                )}
              </div>

              <KnowledgeGraphCanvas
                hotspots={
                  graphProjectScope === 'all'
                    ? (snapshot.knowledge?.hotspots ?? [])
                    : (activeProject?.hotspots ?? [])
                }
                layers={
                  graphProjectScope === 'all'
                    ? (snapshot.knowledge?.layers ?? [])
                    : (activeProject?.layers ?? [])
                }
                title={
                  graphProjectScope === 'all'
                    ? 'All Projects Combined Knowledge Graph'
                    : `${projectName(activeProject?.path ?? '')} Knowledge Graph`
                }
                height={620}
              />
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
          ) : mode === 'split' ? (
            <div className="prj-split-layout">
              {/* Left Pane: Master Projects List */}
              <div className="prj-master-list">
                {filtered.map((p) => {
                  const isSel = activeProject?.path === p.path;
                  const cacheHit = p.read + p.in > 0 ? (p.read / (p.read + p.in)) * 100 : null;
                  return (
                    <div
                      key={p.path}
                      className={`prj-master-item${isSel ? ' is-selected' : ''}`}
                      onClick={() => setSelectedPath(p.path)}
                    >
                      <div className="prj-m-head">
                        <div className="prj-m-title">
                          <span
                            className="dot"
                            style={{
                              background: p.todayCost > 0 ? 'var(--amber)' : 'var(--text-faint)',
                            }}
                          />
                          <b title={projectName(p.path)}>{projectName(p.path)}</b>
                        </div>
                        <span className="prj-m-cost">{fmtUSD(p.cost)}</span>
                      </div>
                      <div className="prj-m-foot">
                        <span>
                          {fmtInt(p.sessions)} sessions ·{' '}
                          {cacheHit != null ? `${fmtPct(cacheHit)} cache` : '—'}
                        </span>
                        <span>{relTime(p.lastTs, now)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Pane: Detail Project & Sessions View */}
              {activeProject ? (
                <div className="prj-detail-pane">
                  <div className="prj-detail-head">
                    <div className="prj-d-info">
                      <h3>{projectName(activeProject.path)}</h3>
                      <div className="prj-d-path">{pathLabel(activeProject.path)}</div>
                    </div>
                    <div className="prj-d-actions">
                      <button
                        type="button"
                        className="sb-btn"
                        onClick={() => {
                          setGraphProjectScope('project');
                          setSelectedPath(activeProject.path);
                          setMode('graph');
                        }}
                        title="Open in full knowledge graph visualizer"
                      >
                        view in graph
                      </button>
                      <button
                        type="button"
                        className="sb-btn"
                        onClick={() => window.ccmon?.openDataDir()}
                        title="Open project data folder"
                      >
                        open dir
                      </button>
                    </div>
                  </div>

                  <div className="prj-d-stats">
                    <div className="prj-d-stat">
                      <span className="prj-d-lbl">Total Spend</span>
                      <span className="prj-d-val">{fmtUSD(activeProject.cost)}</span>
                    </div>
                    <div className="prj-d-stat">
                      <span className="prj-d-lbl">Today's Spend</span>
                      <span
                        className={`prj-d-val ${activeProject.todayCost > 0 ? 'is-amber' : ''}`}
                      >
                        {fmtUSD(activeProject.todayCost)}
                      </span>
                    </div>
                    <div className="prj-d-stat">
                      <span className="prj-d-lbl">7-Day Spend</span>
                      <span className="prj-d-val">{fmtUSD(activeProject.weekCost)}</span>
                    </div>
                    <div className="prj-d-stat">
                      <span className="prj-d-lbl">Cache Hit Rate</span>
                      <span className="prj-d-val">
                        {activeProject.read + activeProject.in > 0
                          ? fmtPct(
                              (activeProject.read / (activeProject.read + activeProject.in)) * 100,
                            )
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* 30-Day Activity Sparkline */}
                  <div className="prj-spark-wrap">
                    <Sparkline daily={activeProject.daily} />
                  </div>

                  {/* Project Architecture Layer Allocation & Knowledge Graph */}
                  {activeProject.layers && activeProject.layers.length > 0 && (
                    <div className="prj-knowledge-sec">
                      <div className="prj-knowledge-title">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>Architecture &amp; Knowledge</span>
                          <div className="pills">
                            <button
                              type="button"
                              className={`pill${projGraphMode === 'graph' ? ' is-active' : ''}`}
                              onClick={() => setProjGraphMode('graph')}
                            >
                              graph
                            </button>
                            <button
                              type="button"
                              className={`pill${projGraphMode === 'chips' ? ' is-active' : ''}`}
                              onClick={() => setProjGraphMode('chips')}
                            >
                              layers
                            </button>
                          </div>
                        </div>
                        <span className="prj-knowledge-sub">
                          {activeProject.layers.length} layers ·{' '}
                          {fmtInt(activeProject.layers.reduce((s, l) => s + l.touches, 0))} ops
                        </span>
                      </div>

                      {projGraphMode === 'graph' ? (
                        <KnowledgeGraphCanvas
                          hotspots={activeProject.hotspots || []}
                          layers={activeProject.layers || []}
                          title={projectName(activeProject.path)}
                          height={420}
                        />
                      ) : (
                        <div className="prj-layers-row">
                          {activeProject.layers.map((l) => (
                            <div className="prj-layer-chip" key={l.key}>
                              <div className="prj-layer-chip-top">
                                <span className="prj-layer-dot" style={{ background: l.color }} />
                                <span className="prj-layer-label">{l.label}</span>
                                <span className="prj-layer-pct">{fmtPct(l.pct, 0)}</span>
                              </div>
                              <div className="prj-layer-chip-bot">
                                <span className="prj-layer-cost">{fmtUSD(l.cost)}</span>
                                <span className="prj-layer-ops">{fmtInt(l.touches)} ops</span>
                              </div>
                              <div className="prj-layer-bar">
                                <i
                                  style={{
                                    width: `${Math.max(4, l.pct)}%`,
                                    background: l.color,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Project Hotspot Files */}
                  {activeProject.hotspots && activeProject.hotspots.length > 0 && (
                    <div className="prj-hotspots-sec">
                      <div className="prj-knowledge-title">
                        <span>Top Hotspot Files ({activeProject.hotspots.length})</span>
                        <span className="prj-knowledge-sub">most touched files in this repo</span>
                      </div>
                      <div className="prj-hotspots-list">
                        {activeProject.hotspots.slice(0, 8).map((h) => (
                          <div className="prj-hotspot-item" key={h.file}>
                            <div className="prj-hotspot-main" title={h.file}>
                              <span className="prj-hotspot-path">{h.shortPath}</span>
                              <span
                                className="prj-hotspot-layer"
                                style={{
                                  background: withAlpha(
                                    activeProject.layers?.find((l) => l.key === h.layer)?.color ||
                                      'var(--line)',
                                    0.15,
                                  ),
                                  color:
                                    activeProject.layers?.find((l) => l.key === h.layer)?.color ||
                                    'var(--text-dim)',
                                }}
                              >
                                {h.layer}
                              </span>
                            </div>
                            <div className="prj-hotspot-meta">
                              <span>{fmtInt(h.touches)} ops</span>
                              <span>{fmtInt(h.sessions)} ses</span>
                              <b>{fmtUSD(h.cost)}</b>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="prj-sessions-sec">
                    <div className="prj-ses-head">
                      <span>Sessions in this project ({activeSessions.length})</span>
                      <input
                        type="text"
                        className="prj-input"
                        style={{ width: '180px', padding: '4px 8px', fontSize: '11px' }}
                        placeholder="Search sessions..."
                        value={sessionQuery}
                        onChange={(e) => setSessionQuery(e.target.value)}
                      />
                    </div>

                    <div className="prj-ses-list">
                      {activeSessions.length === 0 ? (
                        <div className="prj-spark-empty">No sessions matching query</div>
                      ) : (
                        activeSessions.map((s) => {
                          const pct = s.context?.pct ?? 0;
                          return (
                            <div className="prj-ses-item" key={s.id}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  minWidth: 0,
                                }}
                              >
                                <span className="prj-ses-id" title={s.id}>
                                  #{s.id.slice(0, 8)}
                                </span>
                                <CopyButton text={s.id} label="copy" />
                              </div>
                              <div className="prj-ses-ctx">
                                <div className="prj-ses-ctx-meta">
                                  <span>
                                    {s.context
                                      ? `${fmtTok(s.context.tokens)} / ${fmtTok(s.context.limit)}`
                                      : `${fmtTok((s.in || 0) + (s.out || 0))} tok`}
                                  </span>
                                  <span>{s.context ? `${pct.toFixed(0)}% ctx` : ''}</span>
                                </div>
                                {s.context && (
                                  <div className="prj-ses-ctx-bar">
                                    <i
                                      style={{
                                        width: `${Math.min(100, Math.max(pct, 2))}%`,
                                        background: ctxColor(pct),
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                              <span title={(s.models || []).join(', ')}>
                                {s.models && s.models.length ? shortModel(s.models[0]) : '—'}
                              </span>
                              <span>{fmtDuration(s.durationMs || 0)}</span>
                              <b style={{ textAlign: 'right' }}>{fmtUSD(s.cost || 0)}</b>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : mode === 'grid' ? (
            <div className="prj-grid-container">
              {filtered.map((p) => (
                <ProjectCard
                  key={p.path}
                  p={p}
                  now={now}
                  onSelect={() => {
                    setSelectedPath(p.path);
                    setMode('split');
                  }}
                />
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
                      <tr
                        key={p.path}
                        onClick={() => {
                          setSelectedPath(p.path);
                          setMode('split');
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="t-name">
                          <div className="tbl-prj-title">
                            <b>{projectName(p.path)}</b>
                            <span>{pathLabel(p.path)}</span>
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
