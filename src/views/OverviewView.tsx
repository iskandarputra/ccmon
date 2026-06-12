/**
 * @file OverviewView.tsx
 * @brief Overview view — the at-a-glance dashboard.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../store/useUsageStore';
import { useScopedDirs } from '../hooks/useScopedDirs';
import { CountUp } from '../components/ui/CountUp';
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

export function OverviewView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const limits = useUsageStore((s) => s.limits);
  const scoped = useScopedDirs();
  // limits cover every account now — gate this overview card on the scoped one
  const haveLimits = scoped.some((d) => limits[d]);
  if (!snapshot) return null;
  const { today, totals } = snapshot;

  return (
    <div className="grid">
      <div className="g3">
        <StatCard
          label="today · est cost"
          value={<CountUp value={today.cost} format={fmtUSD} />}
          delta={today.vsYesterdayPct}
          sub={`${fmtTok(today.tokens)} tok · ${today.sessions} session${today.sessions === 1 ? '' : 's'}`}
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
          label="all time"
          value={<CountUp value={totals.cost} format={fmtUSD} />}
          sub={`${fmtTok(totals.tokens)} tok · ${fmtInt(totals.sessions)} sessions`}
          aside={
            totals.firstTs
              ? `since ${new Date(totals.firstTs).toLocaleDateString([], {
                  month: 'short',
                  year: 'numeric',
                })}`
              : null
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
      <div className="g8">
        <DailyChart />
      </div>
      <div className="g4">
        <ModelSplit />
      </div>

      {/* token row: when you work next to what the tokens were */}
      <div className="g8">
        <Heatmap />
      </div>
      <div className="g4">
        <TokenMix />
      </div>

      <div className="g7">
        <ProjectsTable />
      </div>
      <div className="g5">
        <LiveFeed />
      </div>
    </div>
  );
}
