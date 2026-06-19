/**
 * @file OverviewView.tsx
 * @brief Overview view — the at-a-glance dashboard.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

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

export function OverviewView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const limits = useUsageStore((s) => s.limits);
  const scoped = useScopedDirs();
  // limits cover every account now — gate this overview card on the scoped one
  const haveLimits = scoped.some((d) => limits[d]);
  if (!snapshot) return null;
  const { today, totals, range } = snapshot;
  const isAll = range.preset === 'all';

  return (
    <div className="grid">
      <div className="g3">
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
