/**
 * @file TitleBar.tsx
 * @brief Frameless-window title bar with traffic controls.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import '../deepseek/deepseek.css';
import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { RangePicker } from '../RangePicker';
import { fmtUSD } from '../../lib/format';
import { deriveRunway, fmtNative, nativeToUSD, runwayLabel } from '../../lib/deepseek';

const LIVE_WINDOW_MS = 90_000;

interface ControlIconProps {
  kind: 'min' | 'max' | 'close';
}

function ControlIcon({ kind }: ControlIconProps) {
  if (kind === 'min') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  if (kind === 'max') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10">
        <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.1" />
      <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/**
 * Always-visible DeepSeek balance. A prepaid balance running out stops work
 * dead with no warning from Claude Code itself, which is exactly the kind of
 * thing worth a permanent chip rather than a card you have to go look at.
 * Renders nothing until a key is connected and a balance has landed; clicking
 * it opens the accounts view where the full card lives.
 */
function DeepseekChip() {
  const result = useUsageStore((s) => s.deepseek);
  const rates = useUsageStore((s) => s.currency);
  const days = useUsageStore((s) => s.snapshot?.days);
  const setView = useUsageStore((s) => s.setView);
  if (!result?.ok) return null;

  const { primary } = result;
  const usd = nativeToUSD(primary.total, primary.currency, rates);
  const runway = deriveRunway(result, rates, days ?? []);
  // the chip's urgency comes from runway when it's known, and from the API's
  // own is_available flag otherwise — a raw balance can't say what's "low"
  const level =
    !result.isAvailable || (runway && runway.days < 3)
      ? 'is-critical'
      : runway && runway.days < 10
        ? 'is-low'
        : '';

  return (
    <button
      type="button"
      className={`tb-ds ${level}`}
      onClick={() => setView('accounts')}
      title={`DeepSeek balance${runway ? ` · ~${runwayLabel(runway.days)} left at ${runway.source === 'measured' ? 'measured' : 'estimated'} burn` : ''}${result.stale ? ' · last refresh failed' : ''}`}
    >
      <i className="tb-ds-mark" aria-hidden />
      <b>{usd == null ? fmtNative(primary.total, primary.currency) : fmtUSD(usd)}</b>
      {runway && <span>{runwayLabel(runway.days)}</span>}
    </button>
  );
}

export function TitleBar() {
  const lastEventTs = useUsageStore((s) => s.lastEventTs);
  const now = useNow(5000);
  const live = lastEventTs && now - lastEventTs < LIVE_WINDOW_MS;
  // the range control is meaningful only once there's a snapshot and on views
  // whose data it actually scopes — Accounts (live limits + fixed spend
  // buckets) and Settings carry no range-scoped data, so hide it there
  const showRange = useUsageStore(
    (s) => !!s.snapshot && s.view !== 'settings' && s.view !== 'accounts',
  );

  return (
    <header className="titlebar" onDoubleClick={() => window.ccmon?.toggleMaximize()}>
      <div className="tb-brand">
        <span className="tb-glyph"><i /><i /><i /></span>
        <span className="tb-name">ccmon</span>
        <span className="tb-tag">claude code monitor</span>
      </div>
      <div className="tb-right">
        {showRange && <RangePicker />}
        <DeepseekChip />
        <span className={`tb-live ${live ? 'is-live' : ''}`}>
          <span className="dot" />
          {live ? 'live' : 'idle'}
        </span>
        <button
          className="tb-github"
          onClick={() => window.ccmon?.openUrl('https://github.com/iskandarputra/ccmon')}
          aria-label="GitHub repository"
          title="View on GitHub"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
              -.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2
              -3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82
              .64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92
              .08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0
              1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </button>
        <div className="tb-controls" onDoubleClick={(e) => e.stopPropagation()}>
          <button className="tb-btn" onClick={() => window.ccmon?.minimize()} aria-label="minimize">
            <ControlIcon kind="min" />
          </button>
          <button className="tb-btn" onClick={() => window.ccmon?.toggleMaximize()} aria-label="maximize">
            <ControlIcon kind="max" />
          </button>
          <button className="tb-btn tb-close" onClick={() => window.ccmon?.close()} aria-label="close">
            <ControlIcon kind="close" />
          </button>
        </div>
      </div>
    </header>
  );
}
