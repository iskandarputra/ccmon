/**
 * @file DeepseekCard.tsx
 * @brief Live DeepSeek account balance — remaining funds, measured burn,
 *        runway, and the computed-vs-observed reconciliation.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './deepseek.css';
import { useState } from 'react';
import { Panel } from '../ui/Panel';
import { Hint } from '../ui/Hint';
import { DeepseekConnect } from './DeepseekConnect';
import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { fmtUSD, fmtUSDPrecise, relTime } from '../../lib/format';
import {
  DRIFT_ALERT,
  deriveRunway,
  driftLabel,
  fmtNative,
  nativeToUSD,
  runwayColor,
  runwayLabel,
} from '../../lib/deepseek';
import type { DeepseekSample } from '../../../shared/types';

/**
 * Balance trail from the persisted polls. Scaled to the observed min/max
 * rather than zero-based: a balance that drifts from $41.20 to $38.90 is the
 * whole story, and a zero-based axis would render it as a flat line.
 */
function BalanceSpark({ samples }: { samples: DeepseekSample[] }) {
  if (samples.length < 3) return null;
  const t0 = samples[0].ts;
  const span = Math.max(1, samples[samples.length - 1].ts - t0);
  if (span < 3 * 3600e3) return null; // under 3h of polls the line is just noise
  const vals = samples.map((s) => s.total);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo || 1;
  const d = samples
    .map((s, i) => {
      const x = ((s.ts - t0) / span) * 100;
      const y = 17 - ((s.total - lo) / range) * 16;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div
      className="ds-spark-wrap"
      title={`balance over the last ${Math.round(span / 3600e3)}h of polls`}
    >
      <span className="ds-spark-label">balance trend</span>
      <div className="ds-spark">
        <svg viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden>
          <path d={d} />
        </svg>
      </div>
    </div>
  );
}

/**
 * DeepSeek's account panel. Unlike an Anthropic plan there is no quota to
 * chart — the provider exposes a balance and nothing else — so what matters
 * is how fast it is draining and whether ccmon's own cost numbers agree with
 * it (docs/v2-spec.md §5.7).
 */
export function DeepseekCard() {
  const result = useUsageStore((s) => s.deepseek);
  const auth = useUsageStore((s) => s.deepseekAuth);
  const rates = useUsageStore((s) => s.currency);
  const days = useUsageStore((s) => s.snapshot?.days);
  const now = useNow(30000);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await window.ccmon?.refreshDeepseek();
    } finally {
      setRefreshing(false);
    }
  }

  const head = (
    <span className="ds-title">
      deepseek
      <span className="ds-tag">api key</span>
    </span>
  );

  if (!auth?.connected) {
    return (
      <Panel
        className="ds-card"
        title={head}
        right={<span className="panel-note">not connected</span>}
      >
        <div className="ds-empty">
          <span className="ds-empty-lead">connect a key to see your balance</span>
          <span className="ds-empty-sub">
            deepseek bills per token from a prepaid balance — there is no plan or quota to read, so
            ccmon needs an api key to show what is left
          </span>
        </div>
        <DeepseekConnect />
      </Panel>
    );
  }

  if (!result) {
    return (
      <Panel className="ds-card" title={head} right={<span className="panel-note">loading…</span>}>
        <div className="ds-empty">
          <span className="ds-empty-lead">fetching balance…</span>
        </div>
        <DeepseekConnect />
      </Panel>
    );
  }

  if (!result.ok) {
    return (
      <Panel className="ds-card" title={head} right={<span className="panel-note">unavailable</span>}>
        <div className="ds-error">
          <span className="ds-error-msg">{result.error}</span>
          {result.nextRetryAt && (
            <span className="ds-error-retry">retrying {relTime(result.nextRetryAt, now)}</span>
          )}
        </div>
        <div className="ds-actions">
          <button type="button" className="ds-link" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'retrying…' : 'retry now'}
          </button>
        </div>
        <DeepseekConnect />
      </Panel>
    );
  }

  const { primary } = result;
  const balanceUSD = nativeToUSD(primary.total, primary.currency, rates);
  const grantedUSD = nativeToUSD(primary.granted, primary.currency, rates);
  const runway = deriveRunway(result, rates, days ?? []);
  const drift = result.drift;
  const driftAlert = drift?.ratio != null && Math.abs(drift.ratio) >= DRIFT_ALERT;
  // a balance in a currency with no rate can still be shown natively — the
  // derived USD figures are what have to disappear, not the number itself
  const nativeOnly = balanceUSD == null;

  return (
    <Panel
      className="ds-card"
      title={head}
      right={
        <span className="panel-note">
          {result.stale ? 'stale · ' : ''}
          {relTime(result.fetchedAt, now)}
        </span>
      }
    >
      {!result.isAvailable && (
        <div className="ds-alert">
          deepseek reports this balance as insufficient — api calls will fail until you top up
        </div>
      )}

      <div className="ds-hero">
        <span className="ds-hero-num">
          {nativeOnly ? fmtNative(primary.total, primary.currency) : fmtUSD(balanceUSD)}
        </span>
        <span className="ds-hero-label">
          balance remaining
          {!nativeOnly && primary.currency !== 'USD' && (
            <i className="ds-native"> · {fmtNative(primary.total, primary.currency)} on deepseek</i>
          )}
        </span>
      </div>

      <BalanceSpark samples={result.history ?? []} />

      <ul className="ds-facts">
        <li>
          <span>runway</span>
          <b style={{ color: runway ? runwayColor(runway.days) : undefined }}>
            {runway ? runwayLabel(runway.days) : '—'}
            {runway && (
              <i className="ds-src">
                {' '}
                · {runway.source === 'measured' ? 'measured' : 'estimated'}
              </i>
            )}
          </b>
        </li>
        <li>
          <span>burn</span>
          <b>{runway ? `${fmtUSDPrecise(runway.burnUSDPerDay)}/day` : '—'}</b>
        </li>
        <li>
          <span>granted left</span>
          <b>
            {primary.granted > 0
              ? nativeOnly || grantedUSD == null
                ? fmtNative(primary.granted, primary.currency)
                : fmtUSD(grantedUSD)
              : '—'}
          </b>
        </li>
        <li>
          <span>cost check</span>
          <b style={{ color: driftAlert ? 'var(--warn)' : undefined }}>
            {drift?.ratio != null ? driftLabel(drift.ratio) : '—'}
            {drift?.ratio != null && (
              <i className="ds-src"> · vs ccmon</i>
            )}
          </b>
        </li>
      </ul>

      {result.stale && result.lastError && (
        <div className="ds-stale">
          last refresh failed: {result.lastError.error}
          {result.nextRetryAt ? ` · retrying ${relTime(result.nextRetryAt, now)}` : ''}
        </div>
      )}

      <div className="ds-actions">
        <button type="button" className="ds-link" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'refreshing…' : 'refresh'}
        </button>
        <Hint label="how these are computed">
          Balance comes straight from DeepSeek's <code>/user/balance</code>, polled every 5 minutes,
          read-only. It is the only account endpoint DeepSeek publishes — there is no usage or
          quota API, so everything else here is measured locally.
          <br />
          <br />
          <b>Runway</b> is balance ÷ burn. Once ccmon has a couple of hours of polls it measures
          burn from the balance actually falling (<i>measured</i>) — that catches DeepSeek spend
          from outside Claude Code too. Before that it <i>estimates</i> from your local transcripts,
          averaged over the active days of the last week.
          <br />
          <br />
          <b>Cost check</b> compares the balance DeepSeek actually consumed against what ccmon
          computed from your transcripts over the same span. A large positive number means real
          spend outran ccmon's estimate — usually usage from another tool or machine on the same
          key, or a pricing snapshot that has fallen behind. Note that expiring granted credit also
          drops the balance and reads here as spend.
          {primary.currency !== 'USD' && (
            <>
              <br />
              <br />
              Your balance is billed in {primary.currency}; the figures above are converted at the
              hourly rate, so they move a little with the exchange rate on top of your usage.
            </>
          )}
        </Hint>
      </div>

      <DeepseekConnect />
    </Panel>
  );
}
