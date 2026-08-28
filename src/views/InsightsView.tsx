/**
 * @file InsightsView.tsx
 * @brief Insights view — derived analytics: trends, forecasts, plan value, cache economics.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import './insights.css';
import './activity.css';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { DayDrilldown } from '../components/insights/DayDrilldown';
import { CountUp } from '../components/ui/CountUp';
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
import { ACCENTS, withAlpha } from '../lib/palette';
import { accountRootFor } from '../../shared/tools';
import { planPriceUSD } from '../lib/plans';
import { detectProvider, isApiKeyOnly } from '../../shared/providers';
import {
  DRIFT_ALERT,
  deriveRunway,
  driftLabel,
  nativeToUSD,
  runwayColor,
  runwayLabel,
} from '../lib/deepseek';
import type {
  AccountInfo,
  AccountsMap,
  ModelRow,
  MonthlyRow,
  Snapshot,
  WeeklyRow,
} from '../../shared/types';

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIMELINE_RANGES = [7, 14, 35];
const BAR_CURSOR = { fill: 'color-mix(in srgb, var(--text) 4%, transparent)' };

interface StackSeries {
  key: string;
  label: string;
  color: string;
}

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
        ) : null,
      )}
      <div className="tip-row">
        <span>total</span>
        <b>{fmtUSD(d.cost)}</b>
      </div>
      <div className="tip-row">
        <span>tokens</span>
        <b>{fmtTok(d.tokens)}</b>
      </div>
      <div className="tip-row">
        <span>entries</span>
        <b>{fmtInt(d.entries)}</b>
      </div>
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
      <div className="tip-row">
        <span>cumulative</span>
        <b>{fmtUSD(d.cum)}</b>
      </div>
      <div className="tip-row">
        <span>that day</span>
        <b>{fmtUSD(d.cost)}</b>
      </div>
    </div>
  );
}

interface BucketTipProps<T> {
  active?: boolean;
  payload?: Array<{ payload: T }>;
  titleFor: (d: T) => string;
}

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
      <div className="tip-row">
        <span>est cost</span>
        <b>{fmtUSD(d.cost)}</b>
      </div>
      <div className="tip-row">
        <span>tokens</span>
        <b>{fmtTok(d.tokens)}</b>
      </div>
      <div className="tip-row">
        <span>entries</span>
        <b>{fmtInt(d.entries)}</b>
      </div>
      <div className="tip-row">
        <span>active days</span>
        <b>{d.days}</b>
      </div>
    </div>
  );
}

const CADENCE_ICONS = {
  avg: (
    <>
      <path d="M3.5 16.5 9 11l3.5 3.5L20.5 6" />
      <path d="M3.5 20.5h17" />
    </>
  ),
  active: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2.5" />
      <path d="M4 9.5h16M8 3.5v3M16 3.5v3" />
      <path d="M8.5 14.5l2 2 4-4.5" />
    </>
  ),
  streak: (
    <path d="M12 3c1.5 3 4.5 4.2 4.5 8a4.5 4.5 0 0 1-9 0c0-1.6.7-2.6 1.4-3.4.4 1 1.1 1.6 1.9 1.8C10.6 7.3 11 5 12 3z" />
  ),
  longest: (
    <>
      <path d="M7 4h10v3a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5a2.5 2.5 0 0 0 3 2.4M17 5h2.5a2.5 2.5 0 0 1-3 2.4" />
      <path d="M12 12v4M9 20h6M10 16h4" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="M12 6.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2L8.6 8.6l2-.3z" />
      <path d="M9 14.5 7.5 21l4.5-2.5 4.5 2.5L15 14.5" />
    </>
  ),
} as const;

/** shared inline SVG wrapper so every glyph carries the same stroke styling */
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

/** one small line icon per record row, keyed by label (neutral --text-dim) */
const RECORD_ICONS: ReactNode[] = [
  <path key="best" d="M5 4h14v4a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5zM9 17h6M12 13v4M8 20h8" />, // best day (trophy)
  <path key="dur" d="M12 7v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" />, // longest session (clock)
  <path key="block" d="M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z" />, // biggest block (bars)
  <path key="streak" d="M13 3l-2 8h4l-2 10M5 8l3 3M19 8l-3 3" />, // streak (flame/spark)
  <path key="active" d="M5 5h14v14H5zM5 9h14M9 13h2M13 13h2M9 16h2" />, // active days (calendar)
  <path key="avg" d="M4 17l5-5 4 3 7-7M4 20h16" />, // avg / day (trend)
  <path key="ctx" d="M4 6h16M4 12h16M4 18h10" />, // avg context (lines)
  <path key="costturn" d="M12 4v16M9 8h4.5a2 2 0 0 1 0 4H10a2 2 0 0 0 0 4H15" />, // avg cost / turn ($)
  <path key="busy" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l2.5 1.5" />, // busiest hour (clock)
  <path key="start" d="M5 12l4 4L19 6" />, // best time to start (check)
  <path key="spike" d="M4 16l4-7 4 5 3-9 5 11" />, // spike days (jagged)
  <path key="costly" d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z" />, // costliest (star)
  <path key="sub" d="M9 6l6 6-6 6M4 6v12" />, // subagent share (branch)
  <path key="trunc" d="M5 12h14M16 7l5 5-5 5M3 7v10" />, // truncated (cut/arrow)
  <path key="compact" d="M7 9l5-5 5 5M7 15l5 5 5-5" />, // compactions (compress)
  <path key="reread" d="M5 12a7 7 0 1 1 2 5M5 17v-5h5" />, // compaction re-reads (refresh)
  <path
    key="tool"
    d="M14.5 5.5a3.5 3.5 0 0 1-4.6 4.6L5 15v4h4l4.9-4.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2z"
  />, // tool output (wrench)
];

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

/** API-equivalent month-to-date cost vs the scoped accounts' plan prices. */
function derivePlanValue(
  accounts: AccountsMap,
  dirs: string[],
  curMonth: MonthlyRow | null,
  projectedMonth: number | null,
): PlanValue | null {
  // A Codex home feeds two source dirs and would otherwise have its
  // subscription counted twice; dedupe on the account root before summing.
  const seen = new Set<string>();
  const priced = dirs
    .filter((d) => {
      const root = accountRootFor(d);
      if (seen.has(root)) return false;
      seen.add(root);
      return true;
    })
    .map((d) => accounts[d])
    .filter((a): a is AccountInfo => !!a)
    // the tool selects the price table — Claude Pro is $20, ChatGPT Pro $200
    .map((a) => ({ a, price: planPriceUSD(a.plan, a.tier, a.tool) }))
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

interface BillingSummary {
  totalCost: number;
  providers: Array<{
    id: string;
    label: string;
    cost: number;
    share: number;
    effectiveOutRate: number | null;
  }>;
}

/** Per-provider cost summary for API-key users (no subscription to compare against). */
function deriveBillingSummary(models: ModelRow[]): BillingSummary | null {
  if (!models.length) return null;
  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  const byProvider = new Map<string, { label: string; cost: number; out: number }>();
  for (const m of models) {
    const p = detectProvider(m.model);
    const id = p?.id ?? 'other';
    const label = p?.label ?? 'Other';
    const cur = byProvider.get(id) || { label, cost: 0, out: 0 };
    cur.cost += m.cost;
    cur.out += m.out;
    byProvider.set(id, cur);
  }
  const providers = [...byProvider.entries()]
    .map(([id, v]) => ({
      id,
      label: v.label,
      cost: v.cost,
      share: totalCost > 0 ? v.cost / totalCost : 0,
      effectiveOutRate: v.out > 0 ? v.cost / (v.out / 1e6) : null,
    }))
    .sort((a, b) => b.cost - a.cost);
  return { totalCost, providers };
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
  const nonzero = days
    .map((d) => d.cost)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
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

  // "best time to start": the lightest ACTIVE hour-of-day (summed across
  // weekdays for stability) — when your session/weekly windows have seen the
  // least competing usage, so a fresh heavy task has the most headroom.
  const hourTotals = new Array<number>(24).fill(0);
  snapshot.hourly.forEach((row) => row.forEach((v, h) => (hourTotals[h] += v)));
  let bestStartHour: number | null = null;
  let lightest = Infinity;
  hourTotals.forEach((v, h) => {
    if (v > 0 && v < lightest) {
      lightest = v;
      bestStartHour = h;
    }
  });

  return {
    bestStartHour: bestStartHour as number | null,
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
      <div className="tip-row">
        <span>est cost</span>
        <b>{fmtUSD(d.cost)}</b>
      </div>
      <div className="tip-row">
        <span>7-day avg</span>
        <b>{fmtUSD(d.ma7)}</b>
      </div>
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
      <div className="tip-row">
        <span>est cost</span>
        <b>{fmtUSD(w.cost)}</b>
      </div>
      <div className="tip-row">
        <span>tokens</span>
        <b>{fmtTok(w.tokens)}</b>
      </div>
      <div className="tip-row">
        <span>active days</span>
        <b>{w.days}</b>
      </div>
      {w.wowPct != null && (
        <div className="tip-row">
          <span>vs prev week</span>
          <b>
            {w.wowPct >= 0 ? '+' : ''}
            {w.wowPct.toFixed(0)}%
          </b>
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
      <div className="tip-row">
        <span>avg est cost</span>
        <b>{fmtUSD(d.avg)}</b>
      </div>
    </div>
  );
}

function Empty({ lead, sub }: { lead: string; sub: string }) {
  return (
    <div className="act-empty">
      <Glyph className="act-empty-icon">
        <path d="M3.5 18 9 12l3.5 3.5L20.5 7" />
        <path d="M3.5 21h17" />
        <path d="M16 7h4.5v4.5" />
      </Glyph>
      <p className="act-empty-lead">{lead}</p>
      <p className="act-empty-sub">{sub}</p>
    </div>
  );
}

export function InsightsView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  // Gated on `compared > 0`: current Claude Code does not write a per-message
  // cost, so on most installs there is nothing to reconcile. An always-empty
  // panel would be worse than no panel — it would imply a clean bill.
  const recon = snapshot?.reconcile ?? null;
  const accounts = useUsageStore((s) => s.accounts);
  const settings = useUsageStore((s) => s.settings);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const ins = useMemo(() => (snapshot ? deriveInsights(snapshot) : null), [snapshot]);
  const [drillDay, setDrillDay] = useState<string | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<'intelligence' | 'timeline' | 'all'>(
    'intelligence',
  );
  const [actRange, setActRange] = useState(14);
  const plan = useMemo(
    () =>
      ins
        ? derivePlanValue(
            accounts,
            settings?.sources && settings.sources.length > 0 ? settings.sources : sourceDirs,
            ins.curMonth,
            ins.projectedMonth,
          )
        : null,
    [ins, accounts, settings, sourceDirs],
  );
  const billingSummary = useMemo(
    () => (snapshot?.models?.length ? deriveBillingSummary(snapshot.models) : null),
    [snapshot],
  );
  const apiKey = useMemo(
    () => (snapshot ? isApiKeyOnly(snapshot.models.map((m) => m.model)) : false),
    [snapshot],
  );
  const deepseek = useUsageStore((s) => s.deepseek);
  const rates = useUsageStore((s) => s.currency);
  // the live balance is the one number here that isn't derived from the
  // transcripts — it's what the provider says is actually left
  const dsBalanceUSD = deepseek?.ok
    ? nativeToUSD(deepseek.primary.total, deepseek.primary.currency, rates)
    : null;
  const dsRunway = useMemo(
    () => deriveRunway(deepseek, rates, snapshot?.days ?? []),
    [deepseek, rates, snapshot],
  );
  const costliest = useMemo(
    () =>
      snapshot && snapshot.sessions.length
        ? snapshot.sessions.reduce((m, s) => (s.cost > m.cost ? s : m))
        : null,
    [snapshot],
  );

  const bounded = snapshot?.range?.preset !== 'all';
  const { timelineRows, modelSeries, cumRows, timelineCost } = useMemo(() => {
    if (!snapshot) return { timelineRows: [], modelSeries: [], cumRows: [], timelineCost: 0 };
    const days = bounded ? snapshot.days || [] : (snapshot.days || []).slice(-actRange);
    const totals = new Map<string, number>();
    for (const d of days) {
      for (const m of d.models || []) {
        totals.set(m.model, (totals.get(m.model) || 0) + m.cost);
      }
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
    const top = ranked.slice(0, 5);
    const keyFor = new Map(top.map((m, i) => [m, `m${i}`] as [string, string]));
    const modelSeries: StackSeries[] = top.map((m, i) => ({
      key: `m${i}`,
      label: shortModel(m),
      color: ACCENTS[i % ACCENTS.length],
    }));
    if (ranked.length > top.length) {
      modelSeries.push({ key: 'other', label: 'other', color: ACCENTS[5] });
    }

    let running = 0;
    const timelineRows: StackRow[] = [];
    const cumRows: CumRow[] = [];
    for (const d of days) {
      const row = { date: d.date, cost: d.cost, tokens: d.tokens, entries: d.entries } as StackRow;
      for (const s of modelSeries) row[s.key] = 0;
      for (const m of d.models || []) {
        const key = keyFor.get(m.model) || 'other';
        row[key] = (row[key] || 0) + m.cost;
      }
      timelineRows.push(row);
      running += d.cost;
      cumRows.push({ date: d.date, cum: running, cost: d.cost });
    }
    return { timelineRows, modelSeries, cumRows, timelineCost: running };
  }, [snapshot, actRange, bounded]);

  const weekly = snapshot?.weekly || [];
  const monthly = snapshot?.monthly || [];

  if (!snapshot || !ins) return null;

  // range-aware labels: 'all' keeps each panel's natural window wording, a
  // bounded range substitutes its own label so captions never lie
  const range = snapshot.range;
  const isAll = range.preset === 'all';
  const winLabel = (def: string) => (isAll ? def : range.label);
  // the month-end forecast only makes sense for a range that reaches today;
  // for past/closed ranges we show the range total instead
  const now = new Date();
  const tk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const endsToday = !range.endKey || range.endKey >= tk;

  const { cache, records } = snapshot;
  const cacheLeverage =
    cache.wouldHaveCostUSD > 0 ? (cache.savedUSD / cache.wouldHaveCostUSD) * 100 : 0;
  const idle = cache.idle;
  const planRef = plan ? Math.max(plan.monthCost, plan.price, 1) : 1;

  const timelinePills = bounded ? (
    <span className="panel-note">{snapshot.range.label}</span>
  ) : (
    <div className="pills">
      {TIMELINE_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={`pill ${actRange === r ? 'is-active' : ''}`}
          onClick={() => setActRange(r)}
        >
          {r}d
        </button>
      ))}
    </div>
  );

  const showIntelligence = analyticsTab === 'intelligence' || analyticsTab === 'all';
  const showTimeline = analyticsTab === 'timeline' || analyticsTab === 'all';

  return (
    <div className="grid">
      {/* Analytics Sub-Navigation Hub */}
      <div className="g12">
        <div className="ins-tab-toolbar">
          <div className="pills">
            <button
              type="button"
              className={`pill${analyticsTab === 'intelligence' ? ' is-active' : ''}`}
              onClick={() => setAnalyticsTab('intelligence')}
            >
              intelligence &amp; roi
            </button>
            <button
              type="button"
              className={`pill${analyticsTab === 'timeline' ? ' is-active' : ''}`}
              onClick={() => setAnalyticsTab('timeline')}
            >
              timelines &amp; burn
            </button>
            <button
              type="button"
              className={`pill${analyticsTab === 'all' ? ' is-active' : ''}`}
              onClick={() => setAnalyticsTab('all')}
            >
              all views
            </button>
          </div>
          <span className="panel-note">
            {analyticsTab === 'intelligence'
              ? 'Economics, ROI & Forecasting'
              : analyticsTab === 'timeline'
                ? 'Daily Model Stack & Cumulative Burn'
                : 'Complete Analytics & Economics Suite'}
          </span>
        </div>
      </div>
      {/* Timeline: Cadence & Streak Deck */}
      {showTimeline && records && (
        <div className="g12">
          <div className="act-strip">
            <div className="act-stat">
              <div className="act-stat-head">
                <span className="act-stat-label">Avg Daily Cost</span>
                <span className="act-stat-icon">
                  <Glyph>{CADENCE_ICONS.avg}</Glyph>
                </span>
              </div>
              <span className="act-stat-value">{fmtUSD(records.avgDailyCost)}</span>
              <span className="act-stat-sub">per active day</span>
            </div>

            <div className="act-stat">
              <div className="act-stat-head">
                <span className="act-stat-label">Active Days</span>
                <span className="act-stat-icon">
                  <Glyph>{CADENCE_ICONS.active}</Glyph>
                </span>
              </div>
              <span className="act-stat-value">
                {fmtInt(records.activeDays)}
                <span className="act-dim"> / {fmtInt(records.totalDays)}</span>
              </span>
              <span className="act-stat-sub">of tracked span</span>
            </div>

            <div className="act-stat">
              <div className="act-stat-head">
                <span className="act-stat-label">Current Streak</span>
                <span className="act-stat-icon">
                  <Glyph>{CADENCE_ICONS.streak}</Glyph>
                </span>
              </div>
              <span className="act-stat-value">{records.streak?.current ?? 0}d</span>
              <span className="act-stat-sub">consecutive active days</span>
            </div>

            <div className="act-stat">
              <div className="act-stat-head">
                <span className="act-stat-label">Longest Streak</span>
                <span className="act-stat-icon">
                  <Glyph>{CADENCE_ICONS.longest}</Glyph>
                </span>
              </div>
              <span className="act-stat-value">{records.streak?.longest ?? 0}d</span>
              <span className="act-stat-sub">all time</span>
            </div>

            <div className="act-stat">
              <div className="act-stat-head">
                <span className="act-stat-label">Record Day</span>
                <span className="act-stat-icon">
                  <Glyph>{CADENCE_ICONS.record}</Glyph>
                </span>
              </div>
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

      {/* Timeline: Daily Cost by Model Stack */}
      {showTimeline && (
        <div className="g12">
          <Panel
            title={
              <>
                daily cost by model{' '}
                <Hint label="how is this stacked?">
                  Costs are grouped by model for the selected range. The top 5 models are shown
                  explicitly, and the rest are grouped into &quot;other&quot;.
                </Hint>
              </>
            }
            right={timelinePills}
          >
            {modelSeries.length ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={timelineRows}
                    margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                    barCategoryGap="28%"
                    onClick={(state) => {
                      if (state?.activeLabel) setDrillDay(state.activeLabel);
                    }}
                    style={{ cursor: 'pointer' }}
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
                      width={56}
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={axisUSD}
                    />
                    <Tooltip cursor={BAR_CURSOR} content={<StackTip series={modelSeries} />} />
                    {modelSeries.map((s) => (
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
                  <span className="act-legend-cap">models</span>
                  {modelSeries.map((s) => (
                    <span className="act-legend-item" key={s.key}>
                      <i className="act-swatch" style={{ background: s.color }} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <Empty
                lead="No usage in the selected range"
                sub="adjust the range or start a session"
              />
            )}
          </Panel>
        </div>
      )}

      {/* Timeline: Cumulative Cost */}
      {showTimeline && (
        <div className="g12">
          <Panel
            title={
              <>
                cumulative cost{' '}
                <Hint label="what is this?">
                  A running total of your estimated spend over the selected date range.
                </Hint>
              </>
            }
            right={
              <span className="panel-note">
                {fmtUSD(timelineCost)} · {bounded ? snapshot.range.label : `last ${actRange}d`}
              </span>
            }
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
                    width={56}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={axisUSD}
                  />
                  <Tooltip cursor={{ stroke: 'var(--line)' }} content={<CumTip />} />
                  <Area
                    type="linear"
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
              <Empty lead="No data yet" sub="spend will accumulate here over time" />
            )}
          </Panel>
        </div>
      )}

      {/* Timeline: Weekly & Monthly Buckets */}
      {showTimeline && (
        <>
          <div className="g6">
            <Panel
              title={
                <>
                  weekly{' '}
                  <Hint label="how to read this">
                    Data rolls up to the start of each week. The current week is still accumulating.
                  </Hint>
                </>
              }
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
                      width={56}
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={axisUSD}
                    />
                    <Tooltip
                      cursor={BAR_CURSOR}
                      content={
                        <BucketTip titleFor={(d: WeeklyRow) => `wk of ${dayLabel(d.week)}`} />
                      }
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
                <Empty lead="No weekly data yet" sub="rolls up once a week completes" />
              )}
            </Panel>
          </div>

          <div className="g6">
            <Panel
              title={
                <>
                  monthly{' '}
                  <Hint label="how to read this">
                    Data rolls up to the start of each month. The current month is still
                    accumulating.
                  </Hint>
                </>
              }
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
                      width={56}
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={axisUSD}
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
                <Empty lead="No monthly data yet" sub="rolls up once a month completes" />
              )}
            </Panel>
          </div>
        </>
      )}

      {/* Intelligence: Hero KPI Telemetry Deck */}
      {showIntelligence && (
        <div className="g12">
          <div className="ins-kpi-grid">
            <div className="ins-kpi-card">
              <span className="ins-kpi-lbl">
                Last 7 Days Spend
                {ins.wowPct != null && (
                  <span className={`ins-kpi-delta ${ins.wowPct > 0 ? 'is-up' : 'is-down'}`}>
                    {ins.wowPct > 0 ? '+' : ''}
                    {fmtPct(ins.wowPct)}
                  </span>
                )}
              </span>
              <div className="ins-kpi-val">
                <CountUp value={ins.cost7} format={fmtUSD} />
              </div>
              <span className="ins-kpi-sub">prev 7d {fmtUSD(ins.prevCost7)}</span>
            </div>

            <div className="ins-kpi-card">
              <span className="ins-kpi-lbl">
                {endsToday ? 'Month-End Projection' : `Spend · ${range.label}`}
                {endsToday && ins.curMonth && (
                  <span className="ins-kpi-aside">{monthLabel(ins.curMonth.month)}</span>
                )}
              </span>
              <div className="ins-kpi-val">
                {endsToday ? (
                  ins.projectedMonth != null ? (
                    <CountUp value={ins.projectedMonth} format={fmtUSD} />
                  ) : (
                    '—'
                  )
                ) : (
                  <CountUp value={snapshot.totals.cost} format={fmtUSD} />
                )}
              </div>
              <span className="ins-kpi-sub">
                {endsToday
                  ? ins.curMonth
                    ? ins.projLow != null && ins.projHigh != null
                      ? `band ${fmtUSD(ins.projLow)}–${fmtUSD(ins.projHigh)} · ${ins.remainingDays}d left`
                      : `spent ${fmtUSD(ins.curMonth.cost)} · ${ins.remainingDays}d left`
                    : 'no spend this month'
                  : `${fmtInt(snapshot.totals.sessions)} sessions · ${fmtInt(snapshot.totals.entries)} entries`}
              </span>
            </div>

            <div className="ins-kpi-card">
              <span className="ins-kpi-lbl">Prompt Cache Saved</span>
              <div className="ins-kpi-val" style={{ color: 'var(--ok)' }}>
                <CountUp value={cache.savedUSD} format={fmtUSD} />
              </div>
              <span className="ins-kpi-sub">
                hit {fmtPct(cache.hitRate * 100)} · {fmtPct(cacheLeverage)} of would-be cost
              </span>
            </div>

            <div className="ins-kpi-card">
              <span className="ins-kpi-lbl">Blended Output Rate</span>
              <div className="ins-kpi-val">
                {ins.blendedPerMTokOut != null ? (
                  <CountUp value={ins.blendedPerMTokOut} format={fmtUSD} />
                ) : (
                  '—'
                )}
                <span style={{ fontSize: '13px', color: 'var(--text-dim)', fontWeight: 500 }}>
                  / MTok
                </span>
              </div>
              <span className="ins-kpi-sub">
                {fmtTok(snapshot.totals.out)} output tok · {winLabel('all-time')}
              </span>
            </div>
          </div>
        </div>
      )}

      {showIntelligence && (
        <>
          {/* spend trend + weekly rhythm */}
          <div className="g8">
            <Panel
              title={
                <>
                  spend trend · {winLabel('30 days')}{' '}
                  <Hint label="how to read this">
                    Daily cost over the selected range. The line is a 7-day moving average. Spikes
                    are identified using a robust statistical threshold to flag days that are
                    significantly above your typical usage pattern.
                  </Hint>
                </>
              }
              right={
                <span className="panel-note">
                  click a day for its breakdown · line 7-day average
                  {ins.spikeDays > 0 ? ' · amber = spike day' : ''}
                </span>
              }
            >
              <ResponsiveContainer width="100%" height={232}>
                <ComposedChart
                  data={ins.trend}
                  margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                  onClick={(s: { activeLabel?: string }) =>
                    s?.activeLabel && setDrillDay(s.activeLabel)
                  }
                  style={{ cursor: 'pointer' }}
                >
                  <defs>
                    <linearGradient id="ins-trend" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.85 }}
                      />
                      <stop
                        offset="100%"
                        style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.25 }}
                      />
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
                    type="linear"
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
            <Panel
              title={
                <>
                  weekday rhythm{' '}
                  <Hint label="what is this?">
                    Averages your daily spend by day of the week over the last 35 days, revealing
                    which days you are most active.
                  </Hint>
                </>
              }
              right={<span className="panel-note">avg est cost</span>}
            >
              <ResponsiveContainer width="100%" height={232}>
                <BarChart data={ins.weekdays} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ins-wd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: 'var(--chart-4)', stopOpacity: 1 }} />
                      <stop
                        offset="100%"
                        style={{ stopColor: 'var(--chart-4)', stopOpacity: 0.4 }}
                      />
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
                    width={56}
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
            <Panel
              title={
                <>
                  week over week{' '}
                  <Hint label="how to read this">
                    Weekly spend totals for up to the last 12 weeks. The percentage shown in the
                    tooltip is the change compared to the previous week.
                  </Hint>
                </>
              }
              right={<span className="panel-note">≤12 weeks</span>}
            >
              <ResponsiveContainer width="100%" height={208}>
                <BarChart data={ins.weekly} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ins-wow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: 'var(--chart-2)', stopOpacity: 1 }} />
                      <stop
                        offset="100%"
                        style={{ stopColor: 'var(--chart-2)', stopOpacity: 0.4 }}
                      />
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
                    width={56}
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
              title={
                <>
                  {plan ? 'plan value' : apiKey ? 'billing' : 'plan value'}{' '}
                  <Hint label="how it's computed">
                    {plan
                      ? "api-equivalent is this month's usage priced at api rates under the current cost mode. plan prices assumed: pro $20 · max 5x $100 · max 20x $200, with the tier read from your stored login. team/enterprise seats have no public price and are excluded."
                      : apiKey
                        ? "api-key billing — you pay per token at the provider's published rates. effective rates are blended (total cost ÷ output tokens) and include input + cache costs, so they read higher than the pure output rate. balance left, runway and the cost check come from your connected deepseek key (accounts view): runway is balance ÷ burn, measured from the balance actually falling once there are a few hours of polls and estimated from local transcripts before that. the cost check compares real balance consumption against ccmon's computed cost over the same span — a large gap usually means usage on the same key from another tool or machine."
                        : "api-equivalent is this month's usage priced at api rates under the current cost mode. plan prices assumed: pro $20 · max 5x $100 · max 20x $200, with the tier read from your stored login. team/enterprise seats have no public price and are excluded."}
                  </Hint>
                </>
              }
              right={
                <span className="panel-note">
                  {ins.curMonth ? `${monthLabel(ins.curMonth.month)} · ` : ''}
                  {plan
                    ? 'api-equivalent vs subscription'
                    : apiKey
                      ? 'per-provider spend'
                      : 'api-equivalent vs subscription'}
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
                </div>
              ) : apiKey && billingSummary ? (
                <div className="ins-cache">
                  {/* with a live balance the bar becomes a real gauge — spend so
                  far against spend + what's left — instead of a lone total
                  filling its own track to 100% and meaning nothing */}
                  <div className="ins-cache-row">
                    <span className="ins-cache-label">total spend</span>
                    <div className="ins-cache-track">
                      <div
                        className="ins-cache-fill"
                        style={{
                          width: `${Math.max(2, dsBalanceUSD != null ? (billingSummary.totalCost / (billingSummary.totalCost + dsBalanceUSD)) * 100 : 100)}%`,
                          background: 'var(--chart-1)',
                        }}
                      />
                    </div>
                    <b>{fmtUSD(billingSummary.totalCost)}</b>
                  </div>
                  {dsBalanceUSD != null && (
                    <div className="ins-cache-row">
                      <span className="ins-cache-label">balance left</span>
                      <div className="ins-cache-track">
                        <div
                          className="ins-cache-fill"
                          style={{
                            width: `${Math.max(2, (dsBalanceUSD / (billingSummary.totalCost + dsBalanceUSD)) * 100)}%`,
                            background: withAlpha('var(--chart-4)', 0.6),
                          }}
                        />
                      </div>
                      <b>{fmtUSD(dsBalanceUSD)}</b>
                    </div>
                  )}
                  <ul className="ins-facts">
                    {billingSummary.providers.map((p) => (
                      <li key={p.id}>
                        <span>{p.label}</span>
                        <b>
                          {fmtUSD(p.cost)}
                          {p.share > 0 && (
                            <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                              {fmtPct(p.share * 100)} ·{' '}
                              {p.effectiveOutRate != null
                                ? `${currencySymbol()}${fmtUSD(p.effectiveOutRate)}/mtok out`
                                : '—'}
                            </span>
                          )}
                        </b>
                      </li>
                    ))}
                    {dsRunway && (
                      <li>
                        <span>runway</span>
                        <b style={{ color: runwayColor(dsRunway.days) }}>
                          {runwayLabel(dsRunway.days)}
                          <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                            {dsRunway.source === 'measured' ? 'measured' : 'estimated'}
                          </span>
                        </b>
                      </li>
                    )}
                    {deepseek?.ok && deepseek.drift?.ratio != null && (
                      <li>
                        <span>cost check</span>
                        <b
                          style={{
                            color:
                              Math.abs(deepseek.drift.ratio) >= DRIFT_ALERT
                                ? 'var(--warn)'
                                : undefined,
                          }}
                        >
                          {driftLabel(deepseek.drift.ratio)}
                          <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                            real vs computed
                          </span>
                        </b>
                      </li>
                    )}
                    <li>
                      <span>billing</span>
                      <b style={{ color: 'var(--text-dim)' }}>api key · per-token</b>
                    </li>
                  </ul>
                </div>
              ) : (
                <div className="ins-empty">
                  <Glyph className="ins-empty-icon">
                    <rect x="3" y="6" width="18" height="13" rx="2.5" />
                    <path d="M3 10h18M7 15h4" />
                  </Glyph>
                  <span className="ins-empty-lead">no subscription detected</span>
                  <span className="ins-empty-sub">
                    sign in from the accounts view to compare plan value
                  </span>
                </div>
              )}
            </Panel>
          </div>
          <div className="g6">
            <Panel
              title={
                <>
                  cache economics{' '}
                  <Hint label="what is this?">
                    Compares your actual API spend to what it would have cost without prompt
                    caching.
                  </Hint>
                </>
              }
              right={<span className="panel-note">all-time</span>}
            >
              <div className="ins-cache">
                <div className="ins-hero">
                  <Glyph className="ins-hero-icon">
                    <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
                    <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
                    <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
                  </Glyph>
                  <div className="ins-hero-body">
                    <span className="ins-hero-label">saved by caching</span>
                    <span className="ins-hero-value">{fmtUSD(cache.savedUSD)}</span>
                    <span className="ins-hero-sub">
                      {fmtPct(cacheLeverage)} of would-be cost · hit{' '}
                      {fmtPct(cache.hitRate * 100, 1)}
                    </span>
                  </div>
                </div>
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
              title={
                <>
                  cache ttl · cost of walking away{' '}
                  <Hint label="why?">
                    stepping away past a cache tier's ttl (5 min / 1 h) expires the session's prompt
                    cache, so the next turn re-writes it at write rates instead of reading it back.
                    extra spent = those writes minus what reads would have cost. prompt edits can
                    also invalidate caches, so treat this as an upper bound on idle cost.
                  </Hint>
                </>
              }
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
              </div>
            </Panel>
          </div>

          {/* economics table + records */}
          <div className="g7">
            <Panel
              title={
                <>
                  model economics{' '}
                  <Hint label="how to read this">
                    Breakdown of the top 8 models by all-time cost, showing what percentage of your
                    spend goes to each, along with efficiency metrics like cost per message.
                  </Hint>
                </>
              }
              right={<span className="panel-note">{winLabel('all-time')} · top 8</span>}
            >
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
                        <td className="t-name" title={m.model}>
                          {shortModel(m.model)}
                        </td>
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
          {recon && recon.compared > 0 && (
            <div className="g5">
              <Panel
                title={
                  <>
                    cost reconciliation{' '}
                    <Hint label="what is this?">
                      Compares the cost Claude Code recorded on each message against ccmon&apos;s
                      own token-based calculation, always calculating fresh regardless of your cost
                      mode (otherwise the two would be the same number by definition). Only messages
                      that carry a recorded cost can be compared, and models with no known price are
                      skipped rather than scored as a total mismatch — so treat this as a check on
                      the overlap, not on your whole bill.
                    </Hint>
                  </>
                }
                right={
                  <span className="panel-note">
                    {fmtPct(recon.coverage)} of {fmtInt(recon.total)} msgs
                  </span>
                }
              >
                <div className="set-kv">
                  <div>
                    <span>recorded</span>
                    <b>{fmtUSD(recon.recorded)}</b>
                  </div>
                  <div>
                    <span>ccmon calculates</span>
                    <b>{fmtUSD(recon.calculated)}</b>
                  </div>
                  <div>
                    <span>drift</span>
                    <b>
                      {recon.drift >= 0 ? '+' : '−'}
                      {fmtUSD(Math.abs(recon.drift))} ({fmtPct(Math.abs(recon.driftPct))})
                    </b>
                  </div>
                </div>
                {recon.byModel.length > 0 && (
                  <ul className="ins-records">
                    {recon.byModel.slice(0, 5).map((m) => (
                      <li key={m.key}>
                        <span>{m.key}</span>
                        <b>
                          {m.calculated - m.recorded >= 0 ? '+' : '−'}
                          {fmtUSD(Math.abs(m.calculated - m.recorded))}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          )}
          <div className="g5">
            <Panel
              title={
                <>
                  records{' '}
                  <Hint label="what is this?">
                    Your all-time highs and averages across all tracked sessions.
                  </Hint>
                </>
              }
              right={<span className="panel-note">all-time</span>}
            >
              <ul className="ins-records">
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[0]}</Glyph>
                  <span>best day</span>
                  <b>
                    {records.maxDay
                      ? `${fmtUSD(records.maxDay.cost)} · ${dayLabel(records.maxDay.date)}`
                      : '—'}
                  </b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[1]}</Glyph>
                  <span>longest session</span>
                  <b>
                    {records.longestSession
                      ? `${fmtDuration(records.longestSession.durationMs)} · ${projectName(records.longestSession.project)}`
                      : '—'}
                  </b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[2]}</Glyph>
                  <span>biggest 5h block</span>
                  <b>{fmtTok(records.maxBlockTokens)} tok</b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[3]}</Glyph>
                  <span>streak</span>
                  <b>
                    {records.streak.current}d now · {records.streak.longest}d best
                  </b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[4]}</Glyph>
                  <span>active days</span>
                  <b>
                    {records.activeDays} of {records.totalDays}
                    {records.totalDays > 0
                      ? ` (${Math.round((records.activeDays / records.totalDays) * 100)}%)`
                      : ''}
                  </b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[5]}</Glyph>
                  <span>avg / active day</span>
                  <b>{fmtUSD(records.avgDailyCost)}</b>
                </li>
                <li title="average context window size (input + cache read tokens) sent to the model per CLI turn">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[6]}</Glyph>
                  <span>avg context / turn</span>
                  <b>
                    {fmtTok(
                      Math.round(
                        (snapshot.totals.in + snapshot.totals.read) /
                          Math.max(1, snapshot.totals.entries),
                      ),
                    )}{' '}
                    tok
                  </b>
                </li>
                <li title="average estimated cost per CLI turn (input, output, and caching cost)">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[7]}</Glyph>
                  <span>avg cost / turn</span>
                  <b>{fmtUSD(snapshot.totals.cost / Math.max(1, snapshot.totals.entries))}</b>
                </li>
                <li>
                  <Glyph className="ins-records-icon">{RECORD_ICONS[8]}</Glyph>
                  <span>busiest hour · {winLabel('30d')}</span>
                  <b>
                    {ins.busiest
                      ? `${WEEKDAYS[ins.busiest.wd]} ${String(ins.busiest.hour).padStart(2, '0')}:00 · ${fmtTok(ins.busiest.v)} tok`
                      : '—'}
                  </b>
                </li>
                <li title="your lightest active hour over the last 30 days — when your 5-hour and weekly limit windows have seen the least competing usage, so a heavy task started here has the most headroom (may fall outside working hours)">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[9]}</Glyph>
                  <span>best time to start</span>
                  <b style={{ color: ins.bestStartHour != null ? 'var(--sage)' : undefined }}>
                    {ins.bestStartHour != null
                      ? `around ${String(ins.bestStartHour).padStart(2, '0')}:00`
                      : '—'}
                  </b>
                </li>
                <li title="days above median + 3.5 robust σ of the range">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[10]}</Glyph>
                  <span>spike days · {winLabel('35d')}</span>
                  <b style={ins.spikeDays > 0 ? { color: 'var(--warn)' } : undefined}>
                    {ins.spikeDays > 0 ? ins.spikeDays : 'none'}
                  </b>
                </li>
                <li title="among the most recent 150 sessions">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[11]}</Glyph>
                  <span>costliest session</span>
                  <b>
                    {costliest
                      ? `${fmtUSD(costliest.cost)} · ${projectName(costliest.project)}`
                      : '—'}
                  </b>
                </li>
                <li title="entries still flagged sidechain after dedupe — a floor on true subagent spend">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[12]}</Glyph>
                  <span>subagent share</span>
                  <b>
                    {snapshot.sidechain.cost > 0 && snapshot.totals.cost > 0
                      ? `${fmtPct((snapshot.sidechain.cost / snapshot.totals.cost) * 100, 1)} · ${fmtUSD(snapshot.sidechain.cost)}`
                      : '—'}
                  </b>
                </li>
                <li title="responses cut off by the output-token ceiling (stop_reason max_tokens)">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[13]}</Glyph>
                  <span>truncated · max_tokens</span>
                  <b
                    style={
                      (snapshot.stopReasons.max_tokens || 0) > 0
                        ? { color: 'var(--warn)' }
                        : undefined
                    }
                  >
                    {snapshot.stopReasons.max_tokens
                      ? `${fmtInt(snapshot.stopReasons.max_tokens)} turn${snapshot.stopReasons.max_tokens === 1 ? '' : 's'}`
                      : 'none'}
                  </b>
                </li>
                <li title="context compactions across all scoped sessions">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[14]}</Glyph>
                  <span>compactions</span>
                  <b>{snapshot.compactions ? fmtInt(snapshot.compactions) : 'none'}</b>
                </li>
                <li title="estimated input + cache-read cost paid to re-ingest context on the first turn after each compaction (a floor — counts only that first turn)">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[15]}</Glyph>
                  <span>compaction re-reads</span>
                  <b>
                    {snapshot.compactionReread.turns
                      ? `${fmtUSD(snapshot.compactionReread.costUSD)} · ${fmtInt(snapshot.compactionReread.turns)} turn${snapshot.compactionReread.turns === 1 ? '' : 's'}`
                      : 'none'}
                  </b>
                </li>
                <li title="volume of tool_result output returned to the model and re-fed as input on later turns — estimated tokens (chars ÷ 4); transcripts carry no exact per-result count">
                  <Glyph className="ins-records-icon">{RECORD_ICONS[16]}</Glyph>
                  <span>tool output · est</span>
                  <b>
                    {snapshot.toolResults.count
                      ? `~${fmtTok(snapshot.toolResults.estTokens)} tok · ${fmtInt(snapshot.toolResults.count)} results`
                      : 'none'}
                  </b>
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
                    of turns use tools · {winLabel('all-time')}
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
                  invocations count tool_use blocks in your transcripts; the cost is the estimated
                  cost of the turns where the tool appears. a turn that uses several tools counts
                  fully toward each, so the cost column overlaps — it shows where tokens go, not an
                  exact split.
                </Hint>
              </Panel>
            </div>
          )}
        </>
      )}

      <DayDrilldown date={drillDay} onClose={() => setDrillDay(null)} />
    </div>
  );
}
