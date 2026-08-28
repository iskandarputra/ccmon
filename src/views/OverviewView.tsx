/**
 * @file OverviewView.tsx
 * @brief Space-efficient, high-density Pulse Cockpit without wasted vertical headers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useState } from 'react';
import './overview.css';
import { useUsageStore } from '../store/useUsageStore';
import { useScopedDirs } from '../hooks/useScopedDirs';
import { CountUp } from '../components/ui/CountUp';
import { Hint } from '../components/ui/Hint';
import { Panel } from '../components/ui/Panel';
import { StatCard } from '../components/cards/StatCard';
import { PlanLimits } from '../components/cards/PlanLimits';
import { BlockCard } from '../components/cards/BlockCard';
import { WeekCard } from '../components/cards/WeekCard';
import { DailyChart } from '../components/charts/DailyChart';
import { TokenMix } from '../components/charts/TokenMix';
import { ModelSplit } from '../components/charts/ModelSplit';
import { Heatmap } from '../components/charts/Heatmap';
import { LiveFeed } from '../components/feed/LiveFeed';
import { ProjectsTable } from '../components/tables/ProjectsTable';
import { fmtUSD, fmtTok, fmtInt } from '../lib/format';

type BottomTab = 'projects' | 'heatmap';
type RightTab = 'feed' | 'models' | 'tokens';

export function OverviewView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const limits = useUsageStore((s) => s.limits);
  const toolLimits = useUsageStore((s) => s.toolLimits);
  const accounts = useUsageStore((s) => s.accounts);
  const scoped = useScopedDirs();
  const haveLimits = scoped.some((d) => limits[d] || toolLimits[d]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('heatmap');
  const [rightTab, setRightTab] = useState<RightTab>('feed');

  const retentionDays = Array.from(
    new Set(
      scoped
        .map((d) => accounts[d]?.cleanupPeriodDays)
        .filter((n): n is number => typeof n === 'number'),
    ),
  );
  const retentionNote =
    retentionDays.length === 1
      ? `${retentionDays[0]} days`
      : retentionDays.length > 1
        ? `${Math.min(...retentionDays)}–${Math.max(...retentionDays)} days, depending on the account`
        : '30 days by default';

  if (!snapshot) {
    return (
      <div className="grid">
        <div className="g12 ovr-empty">
          <svg
            className="ovr-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 13.5l4.5-4.5 3.5 3.5L18 5.5" />
            <path d="M14 5.5h4v4" />
            <path d="M3 19h18" />
          </svg>
          <p className="ovr-empty-lead">Scanning usage transcripts…</p>
          <p className="ovr-empty-sub">
            Reading ~/.claude and ~/.codex transcripts. This cockpit fills in once the scan
            finishes.
          </p>
        </div>
      </div>
    );
  }

  const { today, totals, range } = snapshot;
  const isAll = range.preset === 'all';

  return (
    <div className="grid">
      {/* 1. Realtime Headroom & Rate Limits (if configured) */}
      {haveLimits && (
        <div className="g12">
          <PlanLimits />
        </div>
      )}

      {/* 2. Key Metrics Row */}
      <div className="g3">
        <StatCard
          label="Today · Estimated Cost"
          value={<CountUp value={today.cost} format={fmtUSD} />}
          delta={today.vsYesterdayPct}
          sub={`${fmtTok(today.tokens)} tok · ${today.sessions} session${today.sessions === 1 ? '' : 's'}`}
          hint={
            <Hint label="how it's computed">
              Cost is estimated locally by multiplying your token usage by the active provider
              pricing sheet.
            </Hint>
          }
        />
      </div>
      <div className="g3">
        <BlockCard />
      </div>
      <div className="g3">
        <WeekCard />
      </div>
      <div className="g3">
        <StatCard
          label={isAll ? 'All Time Total' : range.label}
          value={<CountUp value={totals.cost} format={fmtUSD} />}
          sub={`${fmtTok(totals.tokens)} tok · ${fmtInt(totals.sessions)} sessions`}
          aside={
            isAll && totals.firstTs
              ? `since ${new Date(totals.firstTs).toLocaleDateString([], {
                  month: 'short',
                  year: 'numeric',
                })}`
              : isAll
                ? null
                : `${fmtInt(totals.entries)} entries`
          }
          hint={
            <Hint label="what is this?">
              {isAll
                ? `Your all-time total estimated spend and token usage from session transcripts on disk (${retentionNote}).`
                : `Estimated spend and token usage over the selected range (${range.label}).`}
            </Hint>
          }
        />
      </div>

      {/* 3. Main Operational 2-Column Cockpit */}
      {/* Left Column (7 cols): Velocity Chart + Tabbed Explorer */}
      <div className="g7" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <DailyChart />

        <Panel
          title={
            <div className="pulse-tab-header">
              <div className="pulse-tab-pills">
                <button
                  type="button"
                  className={`pulse-tab-btn ${bottomTab === 'heatmap' ? 'is-active' : ''}`}
                  onClick={() => setBottomTab('heatmap')}
                >
                  Activity Rhythm
                </button>
                <button
                  type="button"
                  className={`pulse-tab-btn ${bottomTab === 'projects' ? 'is-active' : ''}`}
                  onClick={() => setBottomTab('projects')}
                >
                  Workspaces
                </button>
              </div>
            </div>
          }
        >
          {bottomTab === 'projects' ? <ProjectsTable /> : <Heatmap />}
        </Panel>
      </div>

      {/* Right Column (5 cols): Realtime Feed & Model Splits */}
      <div className="g5" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Panel
          title={
            <div className="pulse-tab-header">
              <div className="pulse-tab-pills">
                <button
                  type="button"
                  className={`pulse-tab-btn ${rightTab === 'feed' ? 'is-active' : ''}`}
                  onClick={() => setRightTab('feed')}
                >
                  Live Feed
                </button>
                <button
                  type="button"
                  className={`pulse-tab-btn ${rightTab === 'models' ? 'is-active' : ''}`}
                  onClick={() => setRightTab('models')}
                >
                  Models
                </button>
                <button
                  type="button"
                  className={`pulse-tab-btn ${rightTab === 'tokens' ? 'is-active' : ''}`}
                  onClick={() => setRightTab('tokens')}
                >
                  Token Mix
                </button>
              </div>
            </div>
          }
        >
          {rightTab === 'feed' ? (
            <LiveFeed />
          ) : rightTab === 'models' ? (
            <ModelSplit />
          ) : (
            <TokenMix />
          )}
        </Panel>
      </div>
    </div>
  );
}
