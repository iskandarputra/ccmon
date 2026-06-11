/**
 * @file ActivityView.tsx
 * @brief Activity view — daily/cumulative/weekly/monthly spend with streaks.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Panel } from '../components/ui/Panel';
import { useUsageStore } from '../store/useUsageStore';
import { axisUSD, fmtUSD, fmtTok, fmtInt, shortModel, dayLabel, monthLabel } from '../lib/format';
import { ACCENTS, withAlpha } from '../lib/palette';
import type { MonthlyRow, WeeklyRow } from '../../shared/types';
import './activity.css';

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' };
const BAR_CURSOR = { fill: 'color-mix(in srgb, var(--text) 4%, transparent)' };
const RANGES = [7, 14, 35];
const OTHER_COLOR = ACCENTS[5];

const usdTick = axisUSD;

interface StackSeries {
  key: string;
  label: string;
  color: string;
}

/** one stacked-chart row: fixed fields + one dynamic cost key per series */
type StackRow = { date: string; cost: number; tokens: number; entries: number } & Record<
  string,
  number
>;

interface CumRow {
  date: string;
  cum: number;
  cost: number;
}

interface StackTipProps {
  active?: boolean;
  payload?: Array<{ payload: StackRow }>;
  series: StackSeries[];
}

/* tooltip for the stacked daily chart — one row per model active that day */
function StackTip({ active, payload, series }: StackTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{dayLabel(d.date)}</div>
      {series.map((s) =>
        d[s.key] > 0 ? (
          <div className="tip-row" key={s.key}>
            <span>
              <i className="tip-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
            <b>{fmtUSD(d[s.key])}</b>
          </div>
        ) : null
      )}
      <div className="tip-row"><span>total</span><b>{fmtUSD(d.cost)}</b></div>
      <div className="tip-row"><span>tokens</span><b>{fmtTok(d.tokens)}</b></div>
      <div className="tip-row"><span>entries</span><b>{fmtInt(d.entries)}</b></div>
    </div>
  );
}

interface CumTipProps {
  active?: boolean;
  payload?: Array<{ payload: CumRow }>;
}

function CumTip({ active, payload }: CumTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{dayLabel(d.date)}</div>
      <div className="tip-row"><span>cumulative</span><b>{fmtUSD(d.cum)}</b></div>
      <div className="tip-row"><span>that day</span><b>{fmtUSD(d.cost)}</b></div>
    </div>
  );
}

interface BucketTipProps<T> {
  active?: boolean;
  payload?: Array<{ payload: T }>;
  titleFor: (d: T) => string;
}

/* shared tooltip for the weekly / monthly bucket charts */
function BucketTip<T extends { cost: number; tokens: number; entries: number; days: number }>({
  active,
  payload,
  titleFor,
}: BucketTipProps<T>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{titleFor(d)}</div>
      <div className="tip-row"><span>est cost</span><b>{fmtUSD(d.cost)}</b></div>
      <div className="tip-row"><span>tokens</span><b>{fmtTok(d.tokens)}</b></div>
      <div className="tip-row"><span>entries</span><b>{fmtInt(d.entries)}</b></div>
      <div className="tip-row"><span>active days</span><b>{d.days}</b></div>
    </div>
  );
}

export function ActivityView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const [range, setRange] = useState(14);

  const { rows, series, cumRows, rangeCost } = useMemo(() => {
    const days = (snapshot.days || []).slice(-range);

    // rank models by total cost over the range; keep top 5, fold rest into "other"
    const totals = new Map<string, number>();
    for (const d of days) {
      for (const m of d.models || []) {
        totals.set(m.model, (totals.get(m.model) || 0) + m.cost);
      }
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
    const top = ranked.slice(0, 5);
    const keyFor = new Map(top.map((m, i) => [m, `m${i}`] as [string, string]));
    const series: StackSeries[] = top.map((m, i) => ({
      key: `m${i}`,
      label: shortModel(m),
      color: ACCENTS[i % ACCENTS.length],
    }));
    if (ranked.length > top.length) {
      series.push({ key: 'other', label: 'other', color: OTHER_COLOR });
    }

    let running = 0;
    const rows: StackRow[] = [];
    const cumRows: CumRow[] = [];
    for (const d of days) {
      const row = { date: d.date, cost: d.cost, tokens: d.tokens, entries: d.entries } as StackRow;
      for (const s of series) row[s.key] = 0;
      for (const m of d.models || []) {
        const key = keyFor.get(m.model) || 'other';
        row[key] = (row[key] || 0) + m.cost;
      }
      rows.push(row);
      running += d.cost;
      cumRows.push({ date: d.date, cum: running, cost: d.cost });
    }
    return { rows, series, cumRows, rangeCost: running };
  }, [snapshot.days, range]);

  const weekly = snapshot.weekly || [];
  const monthly = snapshot.monthly || [];
  const records = snapshot.records;

  const pills = (
    <div className="pills">
      {RANGES.map((r) => (
        <button
          key={r}
          className={`pill ${range === r ? 'is-active' : ''}`}
          onClick={() => setRange(r)}
        >
          {r}d
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid">
      {records && (
        <div className="g12">
          <div className="act-strip">
            <div className="act-stat">
              <span className="act-stat-label">avg daily cost</span>
              <span className="act-stat-value">{fmtUSD(records.avgDailyCost)}</span>
              <span className="act-stat-sub">per active day</span>
            </div>
            <div className="act-stat">
              <span className="act-stat-label">active days</span>
              <span className="act-stat-value">
                {fmtInt(records.activeDays)}
                <span className="act-dim"> / {fmtInt(records.totalDays)}</span>
              </span>
              <span className="act-stat-sub">of tracked span</span>
            </div>
            <div className="act-stat">
              <span className="act-stat-label">current streak</span>
              <span className="act-stat-value">{records.streak?.current ?? 0}d</span>
              <span className="act-stat-sub">consecutive active days</span>
            </div>
            <div className="act-stat">
              <span className="act-stat-label">longest streak</span>
              <span className="act-stat-value">{records.streak?.longest ?? 0}d</span>
              <span className="act-stat-sub">all time</span>
            </div>
            <div className="act-stat">
              <span className="act-stat-label">record day</span>
              <span className="act-stat-value">
                {records.maxDay ? fmtUSD(records.maxDay.cost) : '—'}
              </span>
              <span className="act-stat-sub">
                {records.maxDay ? dayLabel(records.maxDay.date) : 'no usage yet'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="g12">
        <Panel title="daily cost by model" right={pills}>
          {series.length ? (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={rows}
                  margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                  barCategoryGap="28%"
                >
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
                    width={46}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={usdTick}
                  />
                  <Tooltip cursor={BAR_CURSOR} content={<StackTip series={series} />} />
                  {series.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      stackId="cost"
                      fill={s.color}
                      maxBarSize={26}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="act-legend">
                {series.map((s) => (
                  <span className="act-legend-item" key={s.key}>
                    <i className="act-swatch" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="act-empty">no usage in the selected range</p>
          )}
        </Panel>
      </div>

      <div className="g12">
        <Panel
          title="cumulative cost"
          right={<span className="panel-note">{fmtUSD(rangeCost)} · last {range}d</span>}
        >
          {cumRows.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={cumRows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
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
                  width={46}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={usdTick}
                />
                <Tooltip cursor={{ stroke: 'var(--line)' }} content={<CumTip />} />
                <Area
                  type="monotone"
                  dataKey="cum"
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                  fill={withAlpha('var(--chart-2)', 0.16)}
                  dot={false}
                  activeDot={{ r: 3, fill: 'var(--chart-2)', stroke: 'none' }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="act-empty">no data yet</p>
          )}
        </Panel>
      </div>

      <div className="g6">
        <Panel
          title="weekly"
          right={<span className="panel-note">last {weekly.length} wk</span>}
        >
          {weekly.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={weekly}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis
                  dataKey="week"
                  tickFormatter={dayLabel}
                  tick={AXIS_TICK}
                  axisLine={{ stroke: 'var(--line)' }}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  width={46}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={usdTick}
                />
                <Tooltip
                  cursor={BAR_CURSOR}
                  content={<BucketTip titleFor={(d: WeeklyRow) => `wk of ${dayLabel(d.week)}`} />}
                />
                <Bar
                  dataKey="cost"
                  fill="var(--chart-2)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={30}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="act-empty">no weekly data yet</p>
          )}
        </Panel>
      </div>

      <div className="g6">
        <Panel
          title="monthly"
          right={<span className="panel-note">last {monthly.length} mo</span>}
        >
          {monthly.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={monthly}
                margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tick={AXIS_TICK}
                  axisLine={{ stroke: 'var(--line)' }}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  width={46}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={usdTick}
                />
                <Tooltip
                  cursor={BAR_CURSOR}
                  content={<BucketTip titleFor={(d: MonthlyRow) => monthLabel(d.month)} />}
                />
                <Bar
                  dataKey="cost"
                  fill="var(--chart-5)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={30}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="act-empty">no monthly data yet</p>
          )}
        </Panel>
      </div>

    </div>
  );
}
