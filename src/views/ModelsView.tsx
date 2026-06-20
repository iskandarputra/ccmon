/**
 * @file ModelsView.tsx
 * @brief Models view — per-model economics, cache savings, what-if re-pricing.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './models.css';
import type { ReactNode } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import {
  axisUSD,
  currencySymbol,
  fmtUSD,
  fmtTok,
  fmtInt,
  shortModel,
  relTime,
  fmtPct,
  dayLabel,
} from '../lib/format';
import { ACCENTS, withAlpha } from '../lib/palette';
import type { CacheStats, DayRow, ModelRow, WhatIfRow } from '../../shared/types';

const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' };
const TOP_N = 5;
const OTHER_COLOR = withAlpha('var(--text-faint)', 0.65);

/** small inline SVG wrapper so all glyphs share stroke styling */
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

/** '…-fast' variants → { fast, base id with suffix stripped } */
function splitFast(id = '') {
  const fast = id.endsWith('-fast');
  return { fast, base: fast ? id.slice(0, -5) : id };
}

function modelLabel(id: string) {
  const { fast, base } = splitFast(id);
  return fast ? `${shortModel(base)} fast` : shortModel(base);
}

interface ModelSeries {
  key: string;
  /** null for the synthetic "other" bucket */
  model: string | null;
  color: string;
}

/** one stacked-area row: fixed fields + one dynamic cost key per series */
type AreaRow = { date: string; total: number } & Record<string, number>;

/** Top-N models by cost + an "other" bucket; safe dataKeys (model ids may contain []). */
function buildSeries(models: ModelRow[]) {
  const series: ModelSeries[] = models
    .slice(0, TOP_N)
    .map((m, i) => ({ key: `m${i}`, model: m.model, color: ACCENTS[i % ACCENTS.length] }));
  if (models.length > TOP_N) {
    series.push({ key: 'other', model: null, color: OTHER_COLOR });
  }
  return series;
}

function buildAreaData(days: DayRow[], series: ModelSeries[]) {
  const keyByModel = new Map(
    series.filter((s) => s.model).map((s) => [s.model, s.key] as [string, string]),
  );
  return days.map((d) => {
    const row = { date: d.date, total: d.cost } as AreaRow;
    for (const s of series) row[s.key] = 0;
    for (const m of d.models || []) {
      const key = keyByModel.get(m.model) || 'other';
      if (row[key] != null) row[key] += m.cost;
    }
    return row;
  });
}

interface AreaTipProps {
  active?: boolean;
  payload?: Array<{ payload: AreaRow }>;
  label?: string;
  series: ModelSeries[];
}

function AreaTip({ active, payload, label, series }: AreaTipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const present = series.filter((s) => row[s.key] > 0);
  return (
    <div className="chart-tip">
      <div className="tip-title">{dayLabel(label!)}</div>
      {present.map((s) => (
        <div className="tip-row" key={s.key}>
          <span>
            <i className="tip-swatch" style={{ background: s.color }} />
            {s.model ? modelLabel(s.model) : 'other'}
          </span>
          <b>{fmtUSD(row[s.key])}</b>
        </div>
      ))}
      <div className="tip-row">
        <span>total</span>
        <b>{fmtUSD(row.total)}</b>
      </div>
    </div>
  );
}

interface CostByModelChartProps {
  days: DayRow[];
  series: ModelSeries[];
}

function CostByModelChart({ days, series }: CostByModelChartProps) {
  if (!series.length) {
    return <p className="view-placeholder">no model usage recorded yet</p>;
  }
  const data = buildAreaData(days, series);
  return (
    <>
      <ResponsiveContainer width="100%" height={232}>
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
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
            cursor={{ stroke: 'var(--line)', strokeDasharray: '3 3' }}
            content={<AreaTip series={series} />}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              stackId="cost"
              type="linear"
              stroke={s.color}
              strokeWidth={1.2}
              fill={withAlpha(s.color, 0.4)}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="mdl-legend">
        {series.map((s) => (
          <span className="mdl-legend-item" key={s.key} title={s.model || undefined}>
            <i className="mdl-swatch" style={{ background: s.color }} />
            {s.model ? modelLabel(s.model) : 'other'}
          </span>
        ))}
      </div>
    </>
  );
}

interface CostDonutProps {
  models: ModelRow[];
  rangeLabel: string;
}

function CostDonut({ models, rangeLabel }: CostDonutProps) {
  const slices = models.filter((m) => m.cost > 0);
  if (!slices.length) {
    return <p className="view-placeholder">no cost data yet</p>;
  }
  const total = slices.reduce((a, m) => a + m.cost, 0);
  return (
    <div className="mix-wrap">
      <div className="mix-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="cost"
              nameKey="model"
              innerRadius={47}
              outerRadius={68}
              paddingAngle={2.5}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((m, i) => (
                <Cell key={m.model} fill={ACCENTS[i % ACCENTS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="mix-center">
          <b>{fmtUSD(total)}</b>
          <span>{rangeLabel}</span>
        </div>
      </div>
      <ul className="mix-legend">
        {slices.map((m, i) => (
          <li key={m.model} title={m.model}>
            <i className="ml-swatch" style={{ background: ACCENTS[i % ACCENTS.length] }} />
            <span className="ml-name">{modelLabel(m.model)}</span>
            <span className="ml-val">{fmtUSD(m.cost)}</span>
            <span className="ml-pct">{fmtPct((m.cost / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CacheEconomicsProps {
  cache?: CacheStats;
  totalCost: number;
}

function CacheEconomics({ cache, totalCost }: CacheEconomicsProps) {
  if (!cache) {
    return <p className="view-placeholder">no cache data yet</p>;
  }
  const paidPct =
    cache.wouldHaveCostUSD > 0 ? (totalCost / cache.wouldHaveCostUSD) * 100 : null;
  const savedPct = paidPct == null ? null : 100 - paidPct;
  return (
    <div className="mdl-cache">
      <div className="mdl-cache-hero">
        <Glyph className="mdl-cache-hero-icon">
          <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
          <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
          <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
        </Glyph>
        <div className="mdl-cache-hero-text">
          <span className="mdl-cache-hero-cap">saved by caching</span>
          <span className="mdl-cache-saved">{fmtUSD(cache.savedUSD)}</span>
          <span className="mdl-cache-sub">
            vs uncached — would have cost {fmtUSD(cache.wouldHaveCostUSD)}
          </span>
        </div>
      </div>
      <div className="mdl-cache-bar">
        <div className="mdl-bar">
          <div
            className="mdl-bar-fill"
            style={{ width: `${Math.min(100, Math.max(1, paidPct ?? 0))}%` }}
          />
        </div>
        <div className="mdl-bar-caption">
          <span>paid {fmtUSD(totalCost)}</span>
          <span className="mdl-saved-pct">{fmtPct(savedPct)} saved</span>
        </div>
      </div>
      <div className="mdl-cache-stats">
        <div className="mdl-tile">
          <Glyph className="mdl-tile-icon">
            <path d="M12 3a9 9 0 1 1-9 9" />
            <path d="M3 8.5 3 3 8.5 3" />
            <path d="m3 3 5 5" />
          </Glyph>
          <div className="mdl-tile-text">
            <span className="mdl-tile-cap">hit rate</span>
            <span className="mdl-tile-val">{fmtPct(cache.hitRate * 100, 2)}</span>
          </div>
        </div>
        <div className="mdl-tile">
          <Glyph className="mdl-tile-icon">
            <path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3" />
            <path d="M21 12V7c0-1.7-4-3-9-3S3 5.3 3 7v10c0 1.7 4 3 9 3" />
            <path d="m16 18 2 2 4-4" />
          </Glyph>
          <div className="mdl-tile-text">
            <span className="mdl-tile-cap">cache read</span>
            <span className="mdl-tile-val">{fmtTok(cache.readTokens)}</span>
          </div>
        </div>
        <div className="mdl-tile">
          <Glyph className="mdl-tile-icon">
            <ellipse cx="12" cy="6" rx="8" ry="3" />
            <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
            <path d="M4 12v6c0 1.7 3.6 3 8 3 1.5 0 2.9-.15 4-.42" />
            <path d="M18 14v6M21 17h-6" />
          </Glyph>
          <div className="mdl-tile-text">
            <span className="mdl-tile-cap">cache write</span>
            <span className="mdl-tile-val">{fmtTok(cache.writeTokens)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface WhatIfPanelProps {
  rows: WhatIfRow[];
  actual: number;
}

/** Counterfactual: every recorded request re-priced onto a single model. */
function WhatIfPanel({ rows, actual }: WhatIfPanelProps) {
  if (!rows.length) {
    return <p className="view-placeholder">needs priced models</p>;
  }
  const ref = Math.max(actual, ...rows.map((r) => r.totalCost), 1);
  return (
    <div className="mdl-whatif">
      <div className="mdl-wi-row">
        <span className="mdl-wi-name">actual mix</span>
        <div className="mdl-wi-track">
          <i
            style={{
              width: `${Math.max(1.5, (actual / ref) * 100)}%`,
              background: 'var(--chart-1)',
            }}
          />
        </div>
        <b>{fmtUSD(actual)}</b>
        <span className="mdl-wi-delta">baseline</span>
      </div>
      {rows.map((r) => {
        const cheaper = r.delta < 0;
        return (
          <div
            className={`mdl-wi-row ${cheaper ? 'is-cheaper' : 'is-pricier'}`}
            key={r.model}
          >
            <span className="mdl-wi-name" title={r.model}>{modelLabel(r.model)}</span>
            <div className="mdl-wi-track">
              <i
                style={{
                  width: `${Math.max(1.5, (r.totalCost / ref) * 100)}%`,
                  background: withAlpha('var(--chart-3)', 0.6),
                }}
              />
            </div>
            <b>{fmtUSD(r.totalCost)}</b>
            <span
              className="mdl-wi-delta"
              style={{ color: cheaper ? 'var(--ok)' : 'var(--rose)' }}
            >
              {cheaper ? '−' : '+'}{fmtUSD(Math.abs(r.delta))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface ModelsTableProps {
  models: ModelRow[];
  now: number;
}

function ModelsTable({ models, now }: ModelsTableProps) {
  if (!models.length) {
    return <p className="view-placeholder">no models seen yet</p>;
  }
  const rows = [...models].sort((a, b) => b.cost - a.cost);
  return (
    <div className="tbl-wrap mdl-tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>model</th>
            <th>cost</th>
            <th>msgs</th>
            <th>sessions</th>
            <th>in</th>
            <th>out</th>
            <th>read</th>
            <th>write</th>
            <th title="cache hit: read ÷ (read + uncached input)">hit</th>
            <th title="blended: total cost ÷ output Mtok">{currencySymbol()}/mtok out</th>
            <th>first seen</th>
            <th>last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const { fast, base } = splitFast(m.model);
            const perMtokOut = m.out > 0 ? m.cost / (m.out / 1e6) : null;
            return (
              <tr key={m.model}>
                <td className="t-name" title={m.model}>
                  {shortModel(base)}
                  {fast && <span className="mdl-chip">fast</span>}
                </td>
                <td className="t-cost">{fmtUSD(m.cost)}</td>
                <td>{fmtInt(m.entries)}</td>
                <td>{fmtInt(m.sessions)}</td>
                <td>{fmtTok(m.in)}</td>
                <td>{fmtTok(m.out)}</td>
                <td>{fmtTok(m.read)}</td>
                <td>{fmtTok(m.write)}</td>
                <td>{m.read + m.in > 0 ? fmtPct((m.read / (m.read + m.in)) * 100) : '—'}</td>
                <td>{perMtokOut == null ? '—' : fmtUSD(perMtokOut)}</td>
                <td>{relTime(m.firstTs, now)}</td>
                <td>{relTime(m.lastTs, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ModelsView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const pricingMeta = useUsageStore((s) => s.pricingMeta);
  const now = useNow(30000);

  const models = snapshot.models || [];
  const days = snapshot.days || [];
  const series = buildSeries(models);
  const isAll = snapshot.range.preset === 'all';
  const rangeLabel = snapshot.range.label;
  const dailyData = isAll ? days.slice(-35) : days;

  return (
    <div className="grid">
      <div className="g8">
        <Panel
          title={<>daily cost by model <Hint label="how to read this">Shows your estimated spend over the selected range, stacked by model. The top 5 models are shown individually, while the rest are grouped into "other".</Hint></>}
          right={<span className="panel-note">est cost · {isAll ? '35 days' : rangeLabel}</span>}
        >
          <CostByModelChart days={dailyData} series={series} />
        </Panel>
      </div>

      <div className="g4">
        <Panel title={<>cost share <Hint label="what is this?">A breakdown of your spend by model over the selected range.</Hint></>} right={<span className="panel-note">{rangeLabel}</span>}>
          <CostDonut models={models} rangeLabel={rangeLabel} />
        </Panel>
      </div>

      <div className="g12">
        <Panel
          title={<>cache economics <Hint label="how it's computed">Shows how much you paid versus how much you saved because of prompt caching. Hit rate is cache read tokens divided by total input tokens.</Hint></>}
          right={<span className="panel-note">prompt caching</span>}
        >
          <CacheEconomics cache={snapshot.cache} totalCost={snapshot.totals?.cost || 0} />
        </Panel>
      </div>

      <div className="g12">
        <Panel
          title={<>what-if · all traffic on one model <Hint label="how it's computed">every recorded request is re-priced onto each model with its exact token splits (input / output / cache read / cache write) and tier rules — the same engine that prices your real usage. quality differences between models are not priced in; this is the bill, not the value.</Hint></>}
          right={<span className="panel-note">entry-exact re-pricing · {rangeLabel}</span>}
        >
          <WhatIfPanel rows={snapshot.whatIf || []} actual={snapshot.totals?.cost || 0} />
        </Panel>
      </div>

      <div className="g12">
        <Panel
          title={<>models <Hint label="what is this?">A comprehensive list of every model you've used, sorted by total cost.</Hint></>}
          right={<span className="panel-note">{models.length} model{models.length === 1 ? '' : 's'}</span>}
        >
          <ModelsTable models={models} now={now} />
        </Panel>
      </div>

      <div className="g12">
        <div className="mdl-meta">
          <Glyph className="mdl-meta-icon">
            <path d="M3 9.5 12 4l9 5.5" />
            <path d="M5 11v7M19 11v7M9 11v7M15 11v7" />
            <path d="M3 21h18" />
          </Glyph>
          <span>
            pricing <b>{pricingMeta?.source || '—'}</b>
          </span>
          {pricingMeta?.fetchedAt ? (
            <>
              <span className="mdl-meta-sep">·</span>
              <span>fetched {relTime(pricingMeta.fetchedAt, now)}</span>
            </>
          ) : null}
          {pricingMeta?.modelCount != null ? (
            <>
              <span className="mdl-meta-sep">·</span>
              <span>{fmtInt(pricingMeta.modelCount)} priced models</span>
            </>
          ) : null}
          <span className="mdl-meta-sep">·</span>
          <span>
            cost mode <b>{snapshot.costMode}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
