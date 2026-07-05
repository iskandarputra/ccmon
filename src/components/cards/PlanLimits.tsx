/**
 * @file PlanLimits.tsx
 * @brief Live plan-limit tiles with forecasts, history trail, and cap retrospective.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './planlimits.css';
import { useState, type CSSProperties } from 'react';
import { Panel } from '../ui/Panel';
import { Hint } from '../ui/Hint';
import { LoginPrompt } from '../auth/LoginPrompt';
import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { useScopedDirs } from '../../hooks/useScopedDirs';
import { countdown, fmtPct, relTime, sourceLabel } from '../../lib/format';
import { limitColor } from '../../lib/limits';
import { planBadgeColor } from '../../lib/plans';
import type { LimitSample, LimitWindow, WindowForecast } from '../../../shared/types';

/** A failure that re-authenticating would fix — show the in-app Log in control. */
function isAuthIssue(err: string | undefined): boolean {
  return /expired|rejected|401|403|no stored login|refresh/i.test(err ?? '');
}

function fmtErr(err: string | undefined): string {
  if (!err) return '';
  const lower = err.toLowerCase();
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('too many requests')) {
    return 'rate limited by anthropic';
  }
  if (lower.includes('401') || lower.includes('403')) return 'auth failed — log in';
  if (lower.includes('500') || lower.includes('502') || lower.includes('503')) return 'anthropic api down';
  if (lower.includes('fetch') || lower.includes('econn') || lower.includes('timeout')) return 'network error';
  
  // Try to cleanly cut off raw JSON or parenthesis
  const brace = err.indexOf('{');
  const paren = err.indexOf('(');
  const cut = Math.min(brace > 0 ? brace : 999, paren > 0 ? paren : 999);
  if (cut > 5 && cut < 999) {
    const clean = err.substring(0, cut).replace(/—\s*$/, '').trim();
    if (clean) return clean;
  }
  
  return err.length > 50 ? err.substring(0, 47) + '...' : err;
}

const resetLabel = (ts: number) =>
  new Date(ts).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

interface WindowTileProps {
  label: string;
  win: LimitWindow | null | undefined;
  forecast?: WindowForecast | null;
  now: number;
}

/**
 * One limit window as a tile: label + headline percentage, a full-width bar
 * (equal across tiles by construction), then reset and time-to-cap forecast
 * as quiet meta lines (docs/v2-spec.md §5). The forecast warns only when the
 * fitted pace reaches 100% before the window resets.
 */
function WindowTile({ label, win, forecast, now }: WindowTileProps) {
  if (!win) return null;
  const pct = win.pct;
  const color = limitColor(pct);
  const reset = win.resetsAt
    ? win.resetsAt > now
      ? `resets in ${countdown(win.resetsAt - now)} · ${resetLabel(win.resetsAt)}`
      : 'resetting…'
    : '';
  const fc = forecast && forecast.pctPerHour > 0.05 && (pct ?? 0) < 100 ? forecast : null;
  const capsBeforeReset = fc?.etaTs != null && (!win.resetsAt || fc.etaTs < win.resetsAt);
  return (
    <div className="plim-win">
      <div className="plim-win-head">
        <span className="plim-win-label">{label}</span>
        <b className={`plim-win-pct${(pct ?? 0) >= 100 ? ' is-capped' : ''}`} style={{ color }}>
          {pct == null ? '—' : fmtPct(pct)}
        </b>
      </div>
      <div className="plim-win-track">
        <i style={{ width: `${Math.min(100, Math.max(pct ?? 0, 1.5))}%`, background: color }} />
      </div>
      {reset && (
        <div className="plim-win-meta" title={reset}>
          {reset}
        </div>
      )}
      {fc &&
        (capsBeforeReset ? (
          <div className="plim-win-eta is-warn">caps ~{resetLabel(fc.etaTs!)} at this pace</div>
        ) : (
          <div className="plim-win-eta">+{fc.pctPerHour.toFixed(1)}%/h · clears reset</div>
        ))}
    </div>
  );
}

/**
 * Tiny trail of the weekly utilization from the persisted polls — pure
 * texture, no label; the tooltip explains it. Hidden until the history
 * spans long enough to have a meaningful shape.
 */
function HistorySpark({ samples }: { samples: LimitSample[] }) {
  const pts = samples.filter((s) => s.week != null);
  if (pts.length < 3) return null;
  const t0 = pts[0].ts;
  const span = Math.max(1, pts[pts.length - 1].ts - t0);
  if (span < 6 * 3600e3) return null; // under 6h of polls the line is just noise
  const d = pts
    .map((s, i) => {
      const x = ((s.ts - t0) / span) * 100;
      const y = 17 - (Math.min(100, Math.max(0, s.week as number)) / 100) * 16;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div
      className="plim-spark-wrap"
      title={`weekly utilization over the last ${Math.round(span / 3600e3)}h of polls`}
    >
      <span className="plim-spark-label">7d utilization trend</span>
      <div className="plim-spark">
        <svg viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden>
          <path d={d} />
        </svg>
      </div>
    </div>
  );
}

/**
 * Live plan limits for every scoped account — the real numbers from
 * Anthropic's usage endpoint, with plan + tier (max 5x / 20x) chips and
 * verbose failure/stale states. Lives only in the Overview view — the
 * Blocks view used to duplicate this card but only ever needs
 * `haveLiveLimits` (whether to hide its own local estimate), not the card.
 */
export function PlanLimits() {
  const limits = useUsageStore((s) => s.limits);
  const accounts = useUsageStore((s) => s.accounts);
  const scoped = useScopedDirs();
  const now = useNow(30000);
  const [refreshing, setRefreshing] = useState(false);

  // limits are polled for every account; this overview card stays aligned to
  // the data scope. The accounts view is where ALL logins show side by side.
  const dirs = scoped.filter((d) => limits[d]);
  if (!dirs.length) return null;

  // manual refresh bypasses the failure backoff in main — the user asked
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await window.ccmon?.refreshLimits();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Panel
      title="plan limits · live"
      right={
        <div className="dc-head">
          <span className="panel-note">your real anthropic limits · 60s refresh</span>
          <button
            type="button"
            className="plim-refresh"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? 'refreshing…' : 'refresh now'}
          </button>
        </div>
      }
    >
      <div className="plim-grid">
        {dirs.map((dir) => {
          const r = limits[dir];
          const acct = accounts[dir];
          const retryNote =
            r?.nextRetryAt && r.nextRetryAt > now
              ? `retrying in ${countdown(r.nextRetryAt - now)}`
              : 'retrying…';
          return (
            <div className="plim-account" key={dir}>
              <div className="plim-head">
                <span className="plim-name">{sourceLabel(dir)}</span>
                {acct?.plan && (
                  <span
                    className="plim-plan"
                    style={cssVars({ '--pc': planBadgeColor(acct.plan, acct.tier) ?? 'var(--amber)' })}
                  >
                    {acct.plan}
                    {acct.tier ? ` · ${acct.tier}` : ''}
                  </span>
                )}
                {!r?.ok && (
                  <span className="plim-err" title={r?.error}>
                    {fmtErr(r?.error) || 'unavailable'}
                    {r ? ` · ${retryNote}` : ''}
                  </span>
                )}
              </div>
              {!r?.ok && isAuthIssue(r?.error) && <LoginPrompt dir={dir} />}
              {r?.ok && (
                <>
                  <div className="plim-wins">
                    <WindowTile label="session · 5h" win={r.session} forecast={r.forecast?.session} now={now} />
                    <WindowTile label="week · all models" win={r.week} forecast={r.forecast?.week} now={now} />
                    <WindowTile label="week · opus" win={r.weekOpus} now={now} />
                    <WindowTile label="week · sonnet" win={r.weekSonnet} now={now} />
                  </div>
                  <div className="plim-foot">
                    <HistorySpark samples={r.history ?? []} />
                    {r.caps && r.caps.session.resets + r.caps.week.resets > 0 && (
                      <div
                        className="plim-caps"
                        title="resets observed in the retained poll history (7 days); capped = the window was ≥95% when it reset"
                      >
                        7d resets — session {r.caps.session.capped} of {r.caps.session.resets} capped
                        {r.caps.week.resets > 0
                          ? ` · week ${r.caps.week.capped} of ${r.caps.week.resets} capped`
                          : ''}
                      </div>
                    )}
                  </div>
                  {r.stale && (
                    <div className="plim-stale" title={r.lastError?.error}>
                      showing data from {relTime(r.fetchedAt, now)} —{' '}
                      {fmtErr(r.lastError?.error) || 'latest refresh failed'} · {retryNote}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <Hint label="about these numbers">
        utilization comes live from anthropic's usage endpoint via your stored
        Claude Code login — read-only, tokens are never refreshed. "caps ~…"
        is a linear fit over the recent polls, shown only when the pace would
        hit 100% before the window resets; the sparkline is the weekly
        utilization over the last 7 days of polls.
      </Hint>
    </Panel>
  );
}
