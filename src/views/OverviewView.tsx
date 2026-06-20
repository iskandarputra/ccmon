/**
 * @file OverviewView.tsx
 * @brief Overview view — the at-a-glance dashboard.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './overview.css';
import type { ReactNode } from 'react';
import { useUsageStore } from '../store/useUsageStore';
import { useScopedDirs } from '../hooks/useScopedDirs';
import { CountUp } from '../components/ui/CountUp';
import { Hint } from '../components/ui/Hint';
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

/** small inline SVG wrapper so all section glyphs share stroke styling */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ovr-sec-icon"
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

/** full-width labeled divider that names a row group of the dashboard */
function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="g12 ovr-section">
      <Glyph>{icon}</Glyph>
      <span className="ovr-section-label">{children}</span>
      <span className="ovr-section-rule" aria-hidden />
    </div>
  );
}

export function OverviewView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const limits = useUsageStore((s) => s.limits);
  const scoped = useScopedDirs();
  // limits cover every account now — gate this overview card on the scoped one
  const haveLimits = scoped.some((d) => limits[d]);

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
          <p className="ovr-empty-lead">Scanning your usage…</p>
          <p className="ovr-empty-sub">Reading ~/.claude transcripts. This view fills in once the first scan finishes.</p>
        </div>
      </div>
    );
  }

  const { today, totals, range } = snapshot;
  const isAll = range.preset === 'all';

  return (
    <div className="grid">
      <SectionLabel
        icon={
          <>
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
          </>
        }
      >
        summary
      </SectionLabel>

      <div className="g3 ovr-hero-slot">
        <StatCard
          label="today · est cost"
          value={<CountUp value={today.cost} format={fmtUSD} />}
          delta={today.vsYesterdayPct}
          sub={`${fmtTok(today.tokens)} tok · ${today.sessions} session${today.sessions === 1 ? '' : 's'}`}
          hint={
            <Hint label="how it's computed">
              Cost is estimated locally by taking your token usage from the CLI and multiplying it by the bundled Anthropic pricing sheet.
            </Hint>
          }
        />
      </div>
      <div className="g3">
        <WeekCard />
      </div>
      <div className="g3">
        <BlockCard />
      </div>
      <div className="g3">
        <StatCard
          label={isAll ? 'all time' : range.label}
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
                ? 'Your all-time total estimated spend and token usage recorded by the local CLI since you began tracking.'
                : `Estimated spend and token usage over the selected range (${range.label}). Change it from the range control in the title bar.`}
            </Hint>
          }
        />
      </div>

      {/* the real plan limits, front and center — the first thing to check */}
      {haveLimits && (
        <div className="g12">
          <PlanLimits />
        </div>
      )}

      {/* cost row: daily spend next to where it went (per model) */}
      <SectionLabel
        icon={
          <>
            <path d="M12 7.5v9M14.5 9.5c0-1.1-1.1-1.8-2.5-1.8s-2.5.7-2.5 1.7 1 1.5 2.5 1.8 2.5.8 2.5 1.9-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.8" />
            <circle cx="12" cy="12" r="8.5" />
          </>
        }
      >
        cost breakdown
      </SectionLabel>
      <div className="g8">
        <DailyChart />
      </div>
      <div className="g4">
        <ModelSplit />
      </div>

      {/* token row: when you work next to what the tokens were */}
      <SectionLabel
        icon={
          <>
            <path d="M3 13a9 9 0 1 0 9-9" />
            <path d="M12 7v5l3 2" />
          </>
        }
      >
        activity &amp; tokens
      </SectionLabel>
      <div className="g8">
        <Heatmap />
      </div>
      <div className="g4">
        <TokenMix />
      </div>

      {/* detail row: per-project spend next to the live feed */}
      <SectionLabel
        icon={
          <>
            <path d="M4 5h16M4 12h16M4 19h10" />
          </>
        }
      >
        projects &amp; live feed
      </SectionLabel>
      <div className="g7">
        <ProjectsTable />
      </div>
      <div className="g5">
        <LiveFeed />
      </div>
    </div>
  );
}
