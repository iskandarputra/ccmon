/**
 * @file DailyChart.tsx
 * @brief Stacked-by-model daily bar chart (house chart style).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { axisUSD, fmtUSD, fmtTok, dayLabel } from '../../lib/format';
import { TOKEN_COLORS } from '../../lib/palette';
import type { DayRow } from '../../../shared/types';

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' };

interface DayTipProps {
  active?: boolean;
  payload?: Array<{ payload: DayRow }>;
}

function DayTip({ active, payload }: DayTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{dayLabel(d.date)}</div>
      <div className="tip-row"><span>est cost</span><b>{fmtUSD(d.cost)}</b></div>
      <div className="tip-row">
        <span><i className="tip-swatch" style={{ background: TOKEN_COLORS.in }} />input</span>
        <b>{fmtTok(d.in)}</b>
      </div>
      <div className="tip-row">
        <span><i className="tip-swatch" style={{ background: TOKEN_COLORS.out }} />output</span>
        <b>{fmtTok(d.out)}</b>
      </div>
      <div className="tip-row">
        <span><i className="tip-swatch" style={{ background: TOKEN_COLORS.read }} />cache read</span>
        <b>{fmtTok(d.read)}</b>
      </div>
      <div className="tip-row">
        <span><i className="tip-swatch" style={{ background: TOKEN_COLORS.write }} />cache write</span>
        <b>{fmtTok(d.write)}</b>
      </div>
      <div className="tip-row"><span>sessions</span><b>{d.sessions}</b></div>
    </div>
  );
}

export function DailyChart() {
  const days = useUsageStore((s) => s.snapshot?.days) || [];
  const range = useUsageStore((s) => s.snapshot?.range);
  const [mode, setMode] = useState<'cost' | 'tokens'>('cost');
  // a bounded range already sizes the daily series; only the unbounded default
  // trims to the last 30 days for the at-a-glance chart
  const isAll = !range || range.preset === 'all';
  const data = isAll ? days.slice(-30) : days;

  const active = data.filter((d) => d.cost > 0);
  const avgCost = active.length
    ? active.reduce((s, d) => s + d.cost, 0) / active.length
    : 0;

  return (
    <Panel
      title={isAll ? 'last 30 days' : range.label}
      right={
        <div className="dc-head">
          {avgCost > 0 && (
            <span className="panel-note">avg {fmtUSD(avgCost)} / active day</span>
          )}
          <div className="pills">
            {(['cost', 'tokens'] as const).map((m) => (
              <button
                key={m}
                className={`pill ${mode === m ? 'is-active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={228}>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
          {/* vertical fade gives the bars a lit-from-above depth */}
          <defs>
            <linearGradient id="dc-cost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.4 }} />
            </linearGradient>
            <linearGradient id="dc-tokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.4 }} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line-soft)" />
          <XAxis
            dataKey="date"
            tickFormatter={dayLabel}
            tick={AXIS_TICK}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={false}
            minTickGap={26}
          />
          <YAxis
            width={56}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              mode === 'cost' ? axisUSD(v) : fmtTok(v)
            }
          />
          <Tooltip
            cursor={{ fill: 'color-mix(in srgb, var(--text) 4%, transparent)' }}
            content={<DayTip />}
          />
          {mode === 'cost' && avgCost > 0 && (
            <ReferenceLine
              y={avgCost}
              stroke="var(--text-faint)"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
          )}
          <Bar
            dataKey={mode === 'cost' ? 'cost' : 'tokens'}
            fill={mode === 'cost' ? 'url(#dc-cost)' : 'url(#dc-tokens)'}
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
