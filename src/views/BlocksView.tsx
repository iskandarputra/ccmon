/**
 * @file BlocksView.tsx
 * @brief Blocks view — live 5-hour window, utilization histogram, block history.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './blocks.css';
import type { CSSProperties } from 'react';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { StatCard } from '../components/cards/StatCard';
import { PlanLimits } from '../components/cards/PlanLimits';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import {
  fmtUSD,
  fmtTok,
  fmtInt,
  fmtPct,
  fmtDuration,
  shortModel,
  relTime,
  countdown,
  clockTime,
  dayLabel,
} from '../lib/format';
import { TOKEN_COLORS } from '../lib/palette';
import { bindingSession, displayWindow } from '../lib/limits';
import type {
  ActiveBlock,
  BlockRow,
  BurnRate,
  LimitWindow,
} from '../../shared/types';

const BURN_COLOR = {
  normal: 'var(--ok)',
  moderate: 'var(--warn)',
  high: 'var(--bad)',
};

const STATUS_COLOR = {
  ok: 'var(--ok)',
  warning: 'var(--warn)',
  exceeds: 'var(--bad)',
};

const TOKEN_SPLIT = [
  ['in', 'input'],
  ['out', 'output'],
  ['read', 'cache read'],
  ['write', 'cache write'],
] as const;

/** epoch ms → local 'YYYY-MM-DD' so we can reuse dayLabel(). */
const dateKeyOf = (ts: number) => {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

interface BurnBadgeProps {
  burn: BurnRate | null;
}

function BurnBadge({ burn }: BurnBadgeProps) {
  if (!burn) return null;
  return (
    <span
      className="blk-burn"
      style={{ '--blk-burn': BURN_COLOR[burn.level] || 'var(--ok)' } as CSSProperties}
    >
      <i className="blk-burn-dot" />
      {burn.level} · {fmtTok(burn.tokensPerMinIndicator)}/min · {fmtUSD(burn.costPerHour)}/h
    </span>
  );
}

interface ModelChipsProps {
  models?: string[];
  max?: number;
}

function ModelChips({ models, max = 4 }: ModelChipsProps) {
  if (!models?.length) return null;
  const shown = models.slice(0, max);
  const extra = models.length - shown.length;
  return (
    <span className="blk-chips">
      {shown.map((m) => (
        <span key={m} className="blk-chip" title={m}>
          {shortModel(m)}
        </span>
      ))}
      {extra > 0 && <span className="blk-chip blk-chip-more">+{extra}</span>}
    </span>
  );
}

interface LimitGaugeProps {
  block: ActiveBlock;
}

function LimitGauge({ block }: LimitGaugeProps) {
  const limit = block.limit!; // call site renders this only when block.limit is set
  const color = STATUS_COLOR[limit.status] || 'var(--ok)';
  const gaugeMax = Math.max(100, limit.projectedPct || 0, limit.currentPct || 0);
  const pos = (v: number) => Math.max(0, Math.min(100, (v / gaugeMax) * 100));
  const cur = pos(limit.currentPct);
  const proj = pos(limit.projectedPct);
  const pctDigits = (v: number) => (v < 10 ? 1 : 0);
  return (
    <div className="blk-limit" style={{ '--blk-status': color } as CSSProperties}>
      <div className="blk-limit-head">
        <span className="blk-sub-label">token limit</span>
        <span className="blk-limit-val">
          {fmtTok(block.totalTokens)} of {fmtTok(limit.value)} ({limit.source})
        </span>
      </div>
      <div className="blk-gauge">
        <div className="blk-gauge-fill" style={{ width: `${cur}%` }} />
        {proj > cur && (
          <div className="blk-gauge-proj" style={{ left: `${cur}%`, width: `${proj - cur}%` }} />
        )}
        <i className="blk-gauge-tick" style={{ left: `${pos(80)}%` }} title="80%" />
        <i className="blk-gauge-tick blk-gauge-tick-hard" style={{ left: `${pos(100)}%` }} title="100%" />
      </div>
      <div className="blk-limit-foot">
        <span>current {fmtPct(limit.currentPct, pctDigits(limit.currentPct))}</span>
        <span className="blk-limit-status">
          projected {fmtPct(limit.projectedPct, pctDigits(limit.projectedPct))} · {limit.status}
        </span>
      </div>
    </div>
  );
}

interface ActiveHeroProps {
  block: ActiveBlock;
  now: number;
  hideLocalLimit: boolean;
  liveSession: LimitWindow | null;
}

function ActiveHero({ block, now, hideLocalLimit, liveSession }: ActiveHeroProps) {
  // the real session window when known — the local block start is floored to
  // the hour, so its reset can run up to 59 min early
  const win = displayWindow(block, liveSession, now);
  const remaining = Math.max(0, win.end - now);
  const span = win.end - win.start;
  const progress = span > 0 ? Math.min(100, Math.max(0, ((now - win.start) / span) * 100)) : 0;
  const remMin = Math.round(remaining / 60000);
  const projection = block.burn
    ? {
        totalTokens: Math.round(block.totalTokens + block.burn.tokensPerMin * remMin),
        totalCost: block.cost + (block.burn.costPerHour / 60) * remMin,
      }
    : block.projection;
  return (
    <Panel className="blk-hero" title="active block · 5h window" right={<BurnBadge burn={block.burn} />}>
      <div className="blk-hero-top">
        <div className="blk-hero-cell">
          <div className="blk-sub-label">est cost</div>
          <div className="blk-big">{fmtUSD(block.cost)}</div>
        </div>
        <div className="blk-hero-cell">
          <div className="blk-sub-label">{win.live ? 'resets in · live' : 'resets in · est'}</div>
          <div className="blk-big blk-big-count">{countdown(remaining)}</div>
        </div>
        <div className="blk-hero-meta">
          <div className="blk-meta-line">
            {clockTime(win.start)} – {clockTime(win.end)}
          </div>
          <div className="blk-meta-line">
            {fmtInt(block.entries)} entries · {fmtTok(block.totalTokens)} tok · last {relTime(block.lastTs, now)}
          </div>
          <ModelChips models={block.models} />
        </div>
      </div>

      <div className="blk-progress">
        <span className="blk-progress-time">{clockTime(win.start)}</span>
        <div className="blk-progress-track">
          <div className="blk-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="blk-progress-time">{clockTime(win.end)}</span>
      </div>

      <div className="blk-tokens">
        {TOKEN_SPLIT.map(([k, label]) => (
          <div key={k} className="blk-token">
            <i className="blk-swatch" style={{ background: TOKEN_COLORS[k] }} />
            <span className="blk-token-label">{label}</span>
            <b>{fmtTok(block[k])}</b>
          </div>
        ))}
      </div>

      {projection && (
        <div className="blk-projection">
          projected {fmtTok(projection.totalTokens)} tok · {fmtUSD(projection.totalCost)} by
          session end
        </div>
      )}

      {/* token-based estimate — hidden whenever real plan limits are live,
          since the two disagree by construction (different denominators) */}
      {block.limit && !hideLocalLimit && <LimitGauge block={block} />}

      {block.usageLimitResetTs != null && block.usageLimitResetTs > now && (
        <div className="blk-reset">
          usage limit resets in {countdown(block.usageLimitResetTs - now)}
        </div>
      )}
    </Panel>
  );
}

interface IdleHeroProps {
  lastEnded: number | null;
  limitResetTs: number | null;
  now: number;
}

function IdleHero({ lastEnded, limitResetTs, now }: IdleHeroProps) {
  const limited = limitResetTs != null && limitResetTs > now;
  return (
    <Panel className="blk-hero" title="active block · 5h window">
      <p className="blk-idle">
        no active block{lastEnded ? ` · last ended ${relTime(lastEnded, now)}` : ''}
      </p>
      {limited && (
        <div className="blk-reset">
          usage limit reached — resets in {countdown(limitResetTs - now)} (
          {clockTime(limitResetTs)})
        </div>
      )}
    </Panel>
  );
}

const FILL_BUCKETS = [
  { label: '≤25%', top: 0.25 },
  { label: '25–50%', top: 0.5 },
  { label: '50–75%', top: 0.75 },
  { label: '>75%', top: Infinity },
];

interface UtilizationPanelProps {
  usage: BlockRow[];
  maxBlockTokens: number;
}

/** How full the completed 5h windows run, vs the all-time biggest block. */
function UtilizationPanel({ usage, maxBlockTokens }: UtilizationPanelProps) {
  const done = usage.filter((b) => !b.isActive);
  if (done.length < 3 || !maxBlockTokens) return null;
  const counts = [0, 0, 0, 0];
  for (const b of done) {
    const fill = b.totalTokens / maxBlockTokens;
    counts[FILL_BUCKETS.findIndex((bk) => fill <= bk.top)] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const avgFill =
    (done.reduce((s, b) => s + b.totalTokens / maxBlockTokens, 0) / done.length) * 100;
  const sorted = [...done].sort((a, b) => a.totalTokens - b.totalTokens);
  const medianTok = sorted[sorted.length >> 1].totalTokens;
  return (
    <div className="g12">
    <Panel
      title="block utilization · 30d"
      right={<span className="panel-note">fill vs your biggest block</span>}
    >
      <div className="blk-hist">
        <div className="blk-hist-bars">
          {FILL_BUCKETS.map((bk, i) => (
            <div className="blk-hist-row" key={bk.label}>
              <span className="blk-hist-label">{bk.label}</span>
              <span className="blk-hist-track">
                <i style={{ width: `${Math.max(counts[i] ? 3 : 0, (counts[i] / maxCount) * 100)}%` }} />
              </span>
              <b>{counts[i] || ''}</b>
            </div>
          ))}
        </div>
        <ul className="blk-hist-facts">
          <li>
            <span>avg fill</span>
            <b>{fmtPct(avgFill)}</b>
          </li>
          <li>
            <span>median block</span>
            <b>{fmtTok(medianTok)} tok</b>
          </li>
          <li>
            <span>light blocks · ≤25%</span>
            <b>{counts[0]} of {done.length}</b>
          </li>
        </ul>
      </div>
      <Hint label="why?">
        each completed 5h window's tokens, measured against your biggest-ever block
        ({fmtTok(maxBlockTokens)} tok) — a local proxy for capacity, since anthropic
        doesn't publish block token limits. many light blocks means windows opened
        for a quick question; each still starts the 5h session clock.
      </Hint>
    </Panel>
    </div>
  );
}

interface HistoryRowProps {
  b: BlockRow;
  maxTokens: number;
}

function HistoryRow({ b, maxTokens }: HistoryRowProps) {
  if (b.isGap) {
    return (
      <li className="blk-row blk-row-gap">
        <i className="blk-gap-rule" />
        <span className="blk-gap-text">idle · {fmtDuration(b.end - b.start)}</span>
        <i className="blk-gap-rule" />
      </li>
    );
  }
  const endTs = b.isActive ? b.end : b.actualEnd || b.end;
  const width = maxTokens > 0 ? Math.max(0.75, (b.totalTokens / maxTokens) * 100) : 0;
  return (
    <li className={`blk-row${b.isActive ? ' blk-row-live' : ''}`}>
      <span className="blk-col-day">
        {b.isActive ? (
          <span className="blk-live-tag" title={dayLabel(dateKeyOf(b.start))}>
            live
          </span>
        ) : (
          dayLabel(dateKeyOf(b.start))
        )}
      </span>
      <span className="blk-col-range">
        {clockTime(b.start)} – {clockTime(endTs)}
      </span>
      <span className="blk-col-bar">
        <span className="blk-bar-track">
          <span className="blk-bar-fill" style={{ width: `${width}%` }} />
        </span>
      </span>
      <span className="blk-col-tok">{fmtTok(b.totalTokens)}</span>
      <span className="blk-col-cost">{fmtUSD(b.cost)}</span>
      <span className="blk-col-entries">{fmtInt(b.entries)} msgs</span>
      <span className="blk-col-models">
        <ModelChips models={b.models} max={3} />
      </span>
      <span className="blk-col-burn">
        {b.burn && (
          <i
            className="blk-burn-dot"
            style={{ '--blk-burn': BURN_COLOR[b.burn.level] || 'var(--ok)' } as CSSProperties}
            title={`burn ${b.burn.level} · ${fmtTok(b.burn.tokensPerMinIndicator)}/min`}
          />
        )}
      </span>
    </li>
  );
}

export function BlocksView() {
  const snapshot = useUsageStore((s) => s.snapshot)!;
  const limits = useUsageStore((s) => s.limits);
  const now = useNow(1000);

  const block = snapshot.block;
  const blocks = snapshot.blocks || [];

  const usage = blocks.filter((b) => !b.isGap);
  const gapCount = blocks.length - usage.length;
  const maxTokens = usage.reduce((m, b) => Math.max(m, b.totalTokens), 0);
  const avgCost = usage.length
    ? usage.reduce((s, b) => s + (b.cost || 0), 0) / usage.length
    : 0;
  const maxBlockTokens = snapshot.records?.maxBlockTokens || 0;

  let lastEnded: number | null = null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.isGap && !b.isActive) {
      lastEnded = b.actualEnd || b.end;
      break;
    }
  }

  const history = blocks.slice().reverse();

  // real limits available → the token-based local gauge would only contradict
  const haveLiveLimits = Object.values(limits).some((r) => r?.ok);
  const liveSession = bindingSession(limits);

  return (
    <div className="grid">
      <div className="g12">
        {block ? (
          <ActiveHero
            block={block}
            now={now}
            hideLocalLimit={haveLiveLimits}
            liveSession={liveSession}
          />
        ) : (
          <IdleHero
            lastEnded={lastEnded}
            limitResetTs={snapshot.usageLimitResetTs}
            now={now}
          />
        )}
      </div>

      {Object.keys(limits).length > 0 && (
        <div className="g12">
          <PlanLimits />
        </div>
      )}

      <div className="g3">
        <StatCard label="blocks · 30d" value={fmtInt(usage.length)} sub="5h billing windows" />
      </div>
      <div className="g3">
        <StatCard label="idle gaps" value={fmtInt(gapCount)} sub="quiet stretches > 5h" />
      </div>
      <div className="g3">
        <StatCard label="max block tokens" value={fmtTok(maxBlockTokens)} sub="single-window record" />
      </div>
      <div className="g3">
        <StatCard label="avg cost / block" value={fmtUSD(avgCost)} sub="non-gap · last 30 days" />
      </div>

      <UtilizationPanel usage={usage} maxBlockTokens={maxBlockTokens} />

      <div className="g12">
        <Panel
          title="block history · last 30 days"
          right={
            <span className="panel-note">
              {fmtInt(usage.length)} blocks · {fmtInt(gapCount)} gaps
            </span>
          }
        >
          {history.length === 0 ? (
            <p className="view-placeholder">no blocks recorded yet</p>
          ) : (
            <ul className="blk-history">
              {history.map((b) => (
                <HistoryRow key={b.id} b={b} maxTokens={maxTokens} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
