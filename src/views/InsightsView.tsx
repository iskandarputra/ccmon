/**
 * @file InsightsView.tsx
 * @brief Insights view — derived analytics: trends, forecasts, plan value, cache economics.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import './insights.css';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { CountUp } from '../components/ui/CountUp';
import { StatCard } from '../components/cards/StatCard';
import { useUsageStore } from '../store/useUsageStore';
import {
  axisUSD,
  currencySymbol,
  dayLabel,
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtTok,
  fmtUSD,
  monthLabel,
  projectName,
  shortModel,
} from '../lib/format';
import { withAlpha } from '../lib/palette';
import { scopedDirs } from '../lib/limits';
import { PLAN_PRICES_USD } from '../../shared/plans';
import type { AccountInfo, AccountsMap, MonthlyRow, Snapshot, WeeklyRow } from '../../shared/types';

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface TrendPoint {
  date: string;
  cost: number;
  ma7: number;
  /** robust outlier vs the 35-day window (median + 3.5·1.4826·MAD) */
  spike: boolean;
}

/** Median of an ASCENDING-sorted array (0 when empty). */
function medianSorted(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface WeekdayPoint {
  wd: string;
  avg: number;
}

interface WeeklyPoint extends WeeklyRow {
  wowPct: number | null;
}

interface ModelEconRow {
  model: string;
  cost: number;
  share: number;
  perMTokOut: number | null;
  perMsg: number;
  entries: number;
}

/** 'mcp__server__tool' → 'server · tool' (raw names kept in the title). */
function toolLabel(name: string): string {
  return name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name;
}

interface PlanValue {
  /** summed monthly subscription price of the scoped, priced accounts */
  price: number;
  label: string;
  monthCost: number;
  multiple: number;
  projMultiple: number | null;
  saved: number;
}

/**
 * Monthly subscription price for a detected plan (docs/v2-spec.md §6).
 * Prices live in shared/plans.ts — max with an unknown tier assumes 5x;
 * team/enterprise are seat-priced by the org, so there is nothing to compare.
 */
function planPrice(plan: string | null, tier: string | null): number | null {
  const p = (plan || '').toLowerCase();
  if (p.includes('max')) return tier === '20x' ? PLAN_PRICES_USD.max20x : PLAN_PRICES_USD.max5x;
  if (p.includes('pro')) return PLAN_PRICES_USD.pro;
  return null;
}

/** API-equivalent month-to-date cost vs the scoped accounts' plan prices. */
function derivePlanValue(
  accounts: AccountsMap,
  dirs: string[],
  curMonth: MonthlyRow | null,
  projectedMonth: number | null,
): PlanValue | null {
  const priced = dirs
    .map((d) => accounts[d])
    .filter((a): a is AccountInfo => !!a)
    .map((a) => ({ a, price: planPrice(a.plan, a.tier) }))
    .filter((x): x is { a: AccountInfo; price: number } => x.price != null);
  if (!priced.length) return null;
  const price = priced.reduce((s, x) => s + x.price, 0);
  const label =
    priced.length === 1
      ? `${priced[0].a.plan}${priced[0].a.tier ? ` ${priced[0].a.tier}` : ''}`
      : `${priced.length} plans`;
  const monthCost = curMonth?.cost ?? 0;
  return {
    price,
    label,
    monthCost,
    multiple: monthCost / price,
    projMultiple: projectedMonth != null ? projectedMonth / price : null,
    saved: monthCost - price,
  };
}

/** Everything on this view derives from the snapshot in one pass. */
function deriveInsights(snapshot: Snapshot) {
  const days = snapshot.days;
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  const cost7 = last7.reduce((s, d) => s + d.cost, 0);
  const prevCost7 = prev7.reduce((s, d) => s + d.cost, 0);
  const wowPct = prevCost7 > 0 ? ((cost7 - prevCost7) / prevCost7) * 100 : null;

  // robust spike threshold over the window's active days (MAD-based — a
  // couple of huge days can't drag the cut the way a mean/std would)
  const nonzero = days.map((d) => d.cost).filter((c) => c > 0).sort((a, b) => a - b);
  const med = medianSorted(nonzero);
  const mad = medianSorted(nonzero.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
  const spikeCut = nonzero.length >= 5 && mad > 0 ? med + 3.5 * 1.4826 * mad : Infinity;
  const spikeDays = days.filter((d) => d.cost > spikeCut).length;

  // 30-day trend with a 7-day moving average
  const trend: TrendPoint[] = days.slice(-30).map((d, i) => {
    const idx = days.length - 30 + i;
    const win = days.slice(Math.max(0, idx - 6), idx + 1);
    return {
      date: d.date,
      cost: d.cost,
      ma7: win.reduce((s, w) => s + w.cost, 0) / win.length,
      spike: d.cost > spikeCut,
    };
  });

  // average spend per weekday (Monday-first, over the 35-day window)
  const wdTotals = new Array<number>(7).fill(0);
  const wdCounts = new Array<number>(7).fill(0);
  for (const d of days) {
    const wd = (new Date(`${d.date}T12:00:00`).getDay() + 6) % 7;
    wdTotals[wd] += d.cost;
    wdCounts[wd] += 1;
  }
  const wdAvg = wdTotals.map((t, i) => (wdCounts[i] ? t / wdCounts[i] : 0));
  const weekdays: WeekdayPoint[] = WEEKDAYS.map((wd, i) => ({ wd, avg: wdAvg[i] }));

  // month-end projection: weekday-adjusted with a ±1σ band (docs §6) —
  // each remaining calendar day contributes its weekday's 35-day average;
  // the band assumes independent daily residuals (σ_day × √remaining)
  const nowD = new Date(snapshot.generatedAt);
  const monthKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
  const curMonth = snapshot.monthly.find((m) => m.month === monthKey) ?? null;
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - nowD.getDate();
  let projectedMonth: number | null = null;
  let projLow: number | null = null;
  let projHigh: number | null = null;
  if (curMonth) {
    let mid = curMonth.cost;
    for (let day = nowD.getDate() + 1; day <= daysInMonth; day++) {
      mid += wdAvg[(new Date(nowD.getFullYear(), nowD.getMonth(), day).getDay() + 6) % 7];
    }
    let ss = 0;
    for (const d of days) {
      const wd = (new Date(`${d.date}T12:00:00`).getDay() + 6) % 7;
      ss += (d.cost - wdAvg[wd]) ** 2;
    }
    const sigma = Math.sqrt(ss / Math.max(1, days.length - 1));
    const band = sigma * Math.sqrt(Math.max(0, remainingDays));
    projectedMonth = mid;
    projLow = Math.max(curMonth.cost, mid - band);
    projHigh = mid + band;
  }

  const weekly: WeeklyPoint[] = snapshot.weekly.map((w, i, arr) => {
    const prev = i > 0 ? arr[i - 1] : null;
    return {
      ...w,
      wowPct: prev && prev.cost > 0 ? ((w.cost - prev.cost) / prev.cost) * 100 : null,
    };
  });

  // model economics over all time
  const totalCost = snapshot.totals.cost || 1;
  const models: ModelEconRow[] = snapshot.models.slice(0, 8).map((m) => ({
    model: m.model,
    cost: m.cost,
    share: (m.cost / totalCost) * 100,
    perMTokOut: m.out > 0 ? m.cost / (m.out / 1e6) : null,
    perMsg: m.entries > 0 ? m.cost / m.entries : 0,
    entries: m.entries,
  }));

  // blended output economics
  const blendedPerMTokOut =
    snapshot.totals.out > 0 ? snapshot.totals.cost / (snapshot.totals.out / 1e6) : null;

  // busiest weekday × hour cell of the 30-day rhythm
  let busiest: { wd: number; hour: number; v: number } | null = null;
  snapshot.hourly.forEach((row, wd) =>
    row.forEach((v, hour) => {
      if (v > 0 && (!busiest || v > busiest.v)) busiest = { wd, hour, v };
    }),
  );

  return {
    cost7,
    prevCost7,
    wowPct,
    trend,
    spikeDays,
    weekdays,
    curMonth,
    remainingDays,
    projectedMonth,
    projLow,
    projHigh,
    weekly,
    models,
    blendedPerMTokOut,
    busiest: busiest as { wd: number; hour: number; v: number } | null,
  };
}

interface TrendTipProps {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
}

function TrendTip({ active, payload }: TrendTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{dayLabel(d.date)}</div>
      <div className="tip-row"><span>est cost</span><b>{fmtUSD(d.cost)}</b></div>
      <div className="tip-row"><span>7-day avg</span><b>{fmtUSD(d.ma7)}</b></div>
      {d.spike && (
        <div className="tip-row">
          <span>flag</span>
          <b style={{ color: 'var(--warn)' }}>spike day · well above typical</b>
        </div>
      )}
    </div>
  );
}

interface WeeklyTipProps {
  active?: boolean;
  payload?: Array<{ payload: WeeklyPoint }>;
}

function WeeklyTip({ active, payload }: WeeklyTipProps) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">week of {dayLabel(w.week)}</div>
      <div className="tip-row"><span>est cost</span><b>{fmtUSD(w.cost)}</b></div>
      <div className="tip-row"><span>tokens</span><b>{fmtTok(w.tokens)}</b></div>
      <div className="tip-row"><span>active days</span><b>{w.days}</b></div>
      {w.wowPct != null && (
        <div className="tip-row">
          <span>vs prev week</span>
          <b>{w.wowPct >= 0 ? '+' : ''}{w.wowPct.toFixed(0)}%</b>
        </div>
      )}
    </div>
  );
}

interface WeekdayTipProps {
  active?: boolean;
  payload?: Array<{ payload: WeekdayPoint }>;
}

function WeekdayTip({ active, payload }: WeekdayTipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="tip-title">{d.wd}</div>
      <div className="tip-row"><span>avg est cost</span><b>{fmtUSD(d.avg)}</b></div>
    </div>
  );
}

export function InsightsView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const accounts = useUsageStore((s) => s.accounts);
  const settings = useUsageStore((s) => s.settings);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const ins = useMemo(() => (snapshot ? deriveInsights(snapshot) : null), [snapshot]);
  const plan = useMemo(
    () =>
      ins
        ? derivePlanValue(
            accounts,
            scopedDirs(settings?.sources ?? null, sourceDirs),
            ins.curMonth,
            ins.projectedMonth,
          )
        : null,
    [ins, accounts, settings, sourceDirs],
  );
  const costliest = useMemo(
    () =>
      snapshot && snapshot.sessions.length
        ? snapshot.sessions.reduce((m, s) => (s.cost > m.cost ? s : m))
        : null,
    [snapshot],
  );
  if (!snapshot || !ins) return null;

  const { cache, records } = snapshot;
  const cacheLeverage =
    cache.wouldHaveCostUSD > 0 ? (cache.savedUSD / cache.wouldHaveCostUSD) * 100 : 0;
  const idle = cache.idle;
  const planRef = plan ? Math.max(plan.monthCost, plan.price, 1) : 1;

  return (
    <div className="grid">
      <div className="g3">
        <StatCard
          label="last 7 days"
          value={<CountUp value={ins.cost7} format={fmtUSD} />}
          delta={ins.wowPct}
          sub={`prev 7d ${fmtUSD(ins.prevCost7)}`}
        />
      </div>
      <div className="g3">
        <StatCard
          label="month-end projection"
          value={
            ins.projectedMonth != null ? (
              <CountUp value={ins.projectedMonth} format={fmtUSD} />
            ) : (
              '—'
            )
          }
          sub={
            ins.curMonth ? (
              <span
                title={`weekday-adjusted ±1σ · spent ${fmtUSD(ins.curMonth.cost)} so far`}
              >
                {ins.projLow != null && ins.projHigh != null
                  ? `band ${fmtUSD(ins.projLow)}–${fmtUSD(ins.projHigh)} · ${ins.remainingDays}d left`
                  : `spent ${fmtUSD(ins.curMonth.cost)} · ${ins.remainingDays}d left`}
              </span>
            ) : (
              'no spend this month'
            )
          }
          aside={ins.curMonth ? monthLabel(ins.curMonth.month) : null}
        />
      </div>
      <div className="g3">
        <StatCard
          label="cache saved"
          value={<CountUp value={cache.savedUSD} format={fmtUSD} />}
          sub={`hit ${fmtPct(cache.hitRate * 100)} · ${fmtPct(cacheLeverage)} of would-be cost`}
        />
      </div>
      <div className="g3">
        <StatCard
          label={`blended ${currencySymbol()} / MTok out`}
          value={
            ins.blendedPerMTokOut != null ? (
              <CountUp value={ins.blendedPerMTokOut} format={fmtUSD} />
            ) : (
              '—'
            )
          }
          sub={`${fmtTok(snapshot.totals.out)} output tok all-time`}
        />
      </div>

      {/* spend trend + weekly rhythm */}
      <div className="g8">
        <Panel
          title="spend trend · 30 days"
          right={
            <span className="panel-note">
              bars daily · line 7-day average{ins.spikeDays > 0 ? ' · amber = spike day' : ''}
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={232}>
            <ComposedChart data={ins.trend} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ins-trend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.85 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.25 }} />
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
                width={46}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={axisUSD}
              />
              <Tooltip
                cursor={{ fill: 'color-mix(in srgb, var(--text) 4%, transparent)' }}
                content={<TrendTip />}
              />
              <Bar
                dataKey="cost"
                fill="url(#ins-trend)"
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              >
                {ins.trend.map((t) => (
                  <Cell key={t.date} fill={t.spike ? 'var(--warn)' : 'url(#ins-trend)'} />
                ))}
              </Bar>
              <Line
                dataKey="ma7"
                type="monotone"
                stroke="var(--chart-1)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <div className="g4">
        <Panel title="weekday rhythm" right={<span className="panel-note">avg est cost</span>}>
          <ResponsiveContainer width="100%" height={232}>
            <BarChart data={ins.weekdays} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ins-wd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--chart-4)', stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--chart-4)', stopOpacity: 0.4 }} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis
                dataKey="wd"
                tick={AXIS_TICK}
                axisLine={{ stroke: 'var(--line)' }}
                tickLine={false}
              />
              <YAxis
                width={42}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={axisUSD}
              />
              <Tooltip
                cursor={{ fill: 'color-mix(in srgb, var(--text) 4%, transparent)' }}
                content={<WeekdayTip />}
              />
              <Bar
                dataKey="avg"
                fill="url(#ins-wd)"
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* longer horizons */}
      <div className="g6">
        <Panel title="week over week" right={<span className="panel-note">≤12 weeks</span>}>
          <ResponsiveContainer width="100%" height={208}>
            <BarChart data={ins.weekly} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ins-wow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.4 }} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis
                dataKey="week"
                tickFormatter={dayLabel}
                tick={AXIS_TICK}
                axisLine={{ stroke: 'var(--line)' }}
                tickLine={false}
                minTickGap={22}
              />
              <YAxis
                width={46}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={axisUSD}
              />
              <Tooltip
                cursor={{ fill: 'color-mix(in srgb, var(--text) 4%, transparent)' }}
                content={<WeeklyTip />}
              />
              <Bar
                dataKey="cost"
                fill="url(#ins-wow)"
                radius={[3, 3, 0, 0]}
                maxBarSize={30}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <div className="g6">
        <Panel
          title="plan value"
          right={
            <span className="panel-note">
              {ins.curMonth ? `${monthLabel(ins.curMonth.month)} · ` : ''}
              api-equivalent vs subscription
            </span>
          }
        >
          {plan ? (
            <div className="ins-cache">
              <div className="ins-cache-row">
                <span className="ins-cache-label">api-equivalent</span>
                <div className="ins-cache-track">
                  <div
                    className="ins-cache-fill"
                    style={{
                      width: `${Math.max(2, (plan.monthCost / planRef) * 100)}%`,
                      background: 'var(--chart-1)',
                    }}
                  />
                </div>
                <b>{fmtUSD(plan.monthCost)}</b>
              </div>
              <div className="ins-cache-row">
                <span className="ins-cache-label">plan price</span>
                <div className="ins-cache-track">
                  <div
                    className="ins-cache-fill"
                    style={{
                      width: `${Math.max(2, (plan.price / planRef) * 100)}%`,
                      background: withAlpha('var(--chart-3)', 0.55),
                    }}
                  />
                </div>
                <b>{fmtUSD(plan.price)}</b>
              </div>
              <ul className="ins-facts">
                <li>
                  <span>plan</span>
                  <b>{plan.label}</b>
                </li>
                <li>
                  <span>value multiple</span>
                  <b style={{ color: plan.multiple >= 1 ? 'var(--ok)' : 'var(--text)' }}>
                    ×{plan.multiple.toFixed(1)}
                  </b>
                </li>
                <li>
                  <span>{plan.saved >= 0 ? 'saved vs api' : 'under plan price'}</span>
                  <b>{fmtUSD(Math.abs(plan.saved))}</b>
                </li>
                <li>
                  <span>proj month end</span>
                  <b>{plan.projMultiple != null ? `×${plan.projMultiple.toFixed(1)}` : '—'}</b>
                </li>
              </ul>
              <Hint label="how it's computed">
                api-equivalent is this month's usage priced at api rates under the
                current cost mode. plan prices assumed: pro $20 · max 5x $100 ·
                max 20x $200, with the tier read from your stored login.
                team/enterprise seats have no public price and are excluded.
              </Hint>
            </div>
          ) : (
            <div className="ins-empty">
              <span>no subscription detected</span>
              <Hint label="what is this?">
                plan value compares this month's api-equivalent spend to your
                subscription price (pro $20 · max 5x $100 · max 20x $200). it appears
                once a Claude Code login with one of those plans is found in the
                scoped accounts.
              </Hint>
            </div>
          )}
        </Panel>
      </div>
      <div className="g6">
        <Panel title="cache economics" right={<span className="panel-note">all-time</span>}>
          <div className="ins-cache">
            <div className="ins-cache-row">
              <span className="ins-cache-label">actual spend</span>
              <div className="ins-cache-track">
                <div
                  className="ins-cache-fill"
                  style={{
                    width: `${Math.min(100, (snapshot.totals.cost / (cache.wouldHaveCostUSD || 1)) * 100)}%`,
                    background: 'var(--chart-2)',
                  }}
                />
              </div>
              <b>{fmtUSD(snapshot.totals.cost)}</b>
            </div>
            <div className="ins-cache-row">
              <span className="ins-cache-label">without caching</span>
              <div className="ins-cache-track">
                <div
                  className="ins-cache-fill"
                  style={{ width: '100%', background: withAlpha('var(--chart-3)', 0.55) }}
                />
              </div>
              <b>{fmtUSD(cache.wouldHaveCostUSD)}</b>
            </div>
            <ul className="ins-facts">
              <li>
                <span>cache read</span>
                <b>{fmtTok(cache.readTokens)} tok</b>
              </li>
              <li>
                <span>cache write</span>
                <b>{fmtTok(cache.writeTokens)} tok</b>
              </li>
              <li>
                <span>hit rate</span>
                <b>{fmtPct(cache.hitRate * 100, 1)}</b>
              </li>
              <li>
                <span>saved</span>
                <b style={{ color: 'var(--ok)' }}>{fmtUSD(cache.savedUSD)}</b>
              </li>
            </ul>
          </div>
        </Panel>
      </div>
      <div className="g6">
        <Panel
          title="cache ttl · cost of walking away"
          right={<span className="panel-note">all-time</span>}
        >
          <div className="ins-cache">
            <ul className="ins-facts ins-facts-top">
              <li>
                <span>extra spent</span>
                <b style={{ color: idle.extraUSD > 0 ? 'var(--warn)' : 'var(--text)' }}>
                  {fmtUSD(idle.extraUSD)}
                </b>
              </li>
              <li>
                <span>of total spend</span>
                <b>
                  {fmtPct(
                    snapshot.totals.cost > 0 ? (idle.extraUSD / snapshot.totals.cost) * 100 : 0,
                    1,
                  )}
                </b>
              </li>
              <li>
                <span>re-written</span>
                <b>{fmtTok(idle.tokens)} tok</b>
              </li>
              <li>
                <span>occurrences</span>
                <b>{fmtInt(idle.events)}×</b>
              </li>
            </ul>
            <Hint label="why?">
              stepping away past a cache tier's ttl (5 min / 1 h) expires the
              session's prompt cache, so the next turn re-writes it at write rates
              instead of reading it back. extra spent = those writes minus what
              reads would have cost. prompt edits can also invalidate caches, so
              treat this as an upper bound on idle cost.
            </Hint>
          </div>
        </Panel>
      </div>

      {/* economics table + records */}
      <div className="g7">
        <Panel title="model economics" right={<span className="panel-note">all-time · top 8</span>}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>model</th>
                  <th>share</th>
                  <th>est cost</th>
                  <th>{currencySymbol()} / mtok out</th>
                  <th>{currencySymbol()} / msg</th>
                  <th>msgs</th>
                </tr>
              </thead>
              <tbody>
                {ins.models.map((m) => (
                  <tr key={m.model}>
                    <td className="t-name" title={m.model}>{shortModel(m.model)}</td>
                    <td>
                      <span className="ins-share">
                        <i style={{ width: `${Math.max(2, m.share)}%` }} />
                        {fmtPct(m.share)}
                      </span>
                    </td>
                    <td className="t-cost">{fmtUSD(m.cost)}</td>
                    <td>{m.perMTokOut != null ? fmtUSD(m.perMTokOut) : '—'}</td>
                    <td>{fmtUSD(m.perMsg)}</td>
                    <td>{fmtInt(m.entries)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="g5">
        <Panel title="records" right={<span className="panel-note">all-time</span>}>
          <ul className="ins-records">
            <li>
              <span>best day</span>
              <b>
                {records.maxDay
                  ? `${fmtUSD(records.maxDay.cost)} · ${dayLabel(records.maxDay.date)}`
                  : '—'}
              </b>
            </li>
            <li>
              <span>longest session</span>
              <b>
                {records.longestSession
                  ? `${fmtDuration(records.longestSession.durationMs)} · ${projectName(records.longestSession.project)}`
                  : '—'}
              </b>
            </li>
            <li>
              <span>biggest 5h block</span>
              <b>{fmtTok(records.maxBlockTokens)} tok</b>
            </li>
            <li>
              <span>streak</span>
              <b>{records.streak.current}d now · {records.streak.longest}d best</b>
            </li>
            <li>
              <span>active days</span>
              <b>
                {records.activeDays} of {records.totalDays}
                {records.totalDays > 0
                  ? ` (${Math.round((records.activeDays / records.totalDays) * 100)}%)`
                  : ''}
              </b>
            </li>
            <li>
              <span>avg / active day</span>
              <b>{fmtUSD(records.avgDailyCost)}</b>
            </li>
            <li>
              <span>busiest hour · 30d</span>
              <b>
                {ins.busiest
                  ? `${WEEKDAYS[ins.busiest.wd]} ${String(ins.busiest.hour).padStart(2, '0')}:00 · ${fmtTok(ins.busiest.v)} tok`
                  : '—'}
              </b>
            </li>
            <li title="days above median + 3.5 robust σ of the 35-day window">
              <span>spike days · 35d</span>
              <b style={ins.spikeDays > 0 ? { color: 'var(--warn)' } : undefined}>
                {ins.spikeDays > 0 ? ins.spikeDays : 'none'}
              </b>
            </li>
            <li title="among the most recent 150 sessions">
              <span>costliest session</span>
              <b>
                {costliest
                  ? `${fmtUSD(costliest.cost)} · ${projectName(costliest.project)}`
                  : '—'}
              </b>
            </li>
            <li title="entries still flagged sidechain after dedupe — a floor on true subagent spend">
              <span>subagent share</span>
              <b>
                {snapshot.sidechain.cost > 0 && snapshot.totals.cost > 0
                  ? `${fmtPct((snapshot.sidechain.cost / snapshot.totals.cost) * 100, 1)} · ${fmtUSD(snapshot.sidechain.cost)}`
                  : '—'}
              </b>
            </li>
            <li title="responses cut off by the output-token ceiling (stop_reason max_tokens)">
              <span>truncated · max_tokens</span>
              <b style={(snapshot.stopReasons.max_tokens || 0) > 0 ? { color: 'var(--warn)' } : undefined}>
                {snapshot.stopReasons.max_tokens
                  ? `${fmtInt(snapshot.stopReasons.max_tokens)} turn${snapshot.stopReasons.max_tokens === 1 ? '' : 's'}`
                  : 'none'}
              </b>
            </li>
            <li title="context compactions across all scoped sessions">
              <span>compactions</span>
              <b>{snapshot.compactions ? fmtInt(snapshot.compactions) : 'none'}</b>
            </li>
          </ul>
        </Panel>
      </div>

      {/* tool usage */}
      {snapshot.toolUse.rows.length > 0 && (
        <div className="g12">
          <Panel
            title="tool usage"
            right={
              <span className="panel-note">
                {fmtInt(snapshot.toolUse.invocations)} invocations ·{' '}
                {fmtPct(
                  snapshot.totals.entries > 0
                    ? (snapshot.toolUse.turns / snapshot.totals.entries) * 100
                    : 0,
                )}{' '}
                of turns use tools · all-time
              </span>
            }
          >
            <div className="ins-tools">
              {snapshot.toolUse.rows.map((t) => {
                const maxInv = snapshot.toolUse.rows[0].invocations || 1;
                return (
                  <div className="ins-tool" key={t.name} title={t.name}>
                    <span className="ins-tool-name">{toolLabel(t.name)}</span>
                    <span className="ins-tool-track">
                      <i style={{ width: `${Math.max(2, (t.invocations / maxInv) * 100)}%` }} />
                    </span>
                    <b>{fmtInt(t.invocations)}</b>
                    <span className="ins-tool-cost">{fmtUSD(t.cost)}</span>
                  </div>
                );
              })}
            </div>
            <Hint label="how to read this">
              invocations count tool_use blocks in your transcripts; the cost is
              the estimated cost of the turns where the tool appears. a turn that
              uses several tools counts fully toward each, so the cost column
              overlaps — it shows where tokens go, not an exact split.
            </Hint>
          </Panel>
        </div>
      )}
    </div>
  );
}
