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
import { updateSettings } from '../../bootstrap';

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
function DeepseekLogo({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 3.69 2.01 6.91 5 8.65v-2.22c-1.83-1.39-3-3.62-3-6.43 0-4.41 3.59-8 8-8s8 3.59 8 8c0 2.81-1.17 5.04-3 6.43v2.22c2.99-1.74 5-4.96 5-8.65 0-5.52-4.48-10-10-10z" />
    </svg>
  );
}

function DeepseekChip() {
  const result = useUsageStore((s) => s.deepseek);
  const rates = useUsageStore((s) => s.currency);
  const days = useUsageStore((s) => s.snapshot?.days);
  const setView = useUsageStore((s) => s.setView);
  if (!result?.ok) return null;

  const { primary } = result;
  const usd = nativeToUSD(primary.total, primary.currency, rates);
  const runway = deriveRunway(result, rates, days ?? []);
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
      <DeepseekLogo className="tb-ds-logo" />
      <span className="tb-ds-name">DeepSeek</span>
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

  const privacy = useUsageStore((s) => !!s.settings?.privacyMode);
  const togglePrivacy = () => {
    const st = useUsageStore.getState().settings;
    updateSettings({ privacyMode: !st?.privacyMode });
  };

  const openCmdk = () => {
    window.dispatchEvent(new CustomEvent('open-cmdk'));
  };

  return (
    <header className="titlebar" onDoubleClick={() => window.ccmon?.toggleMaximize()}>
      <div className="tb-brand">
        <span className="tb-glyph"><i /><i /><i /></span>
        <span className="tb-name">ccmon</span>
        <span className="tb-tag">claude code monitor</span>
      </div>

      <button className="tb-search" onClick={openCmdk} type="button" title="Open command palette (Ctrl+K / ⌘K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="tb-search-placeholder">Search views, actions...</span>
        <kbd className="tb-search-kbd">⌘K</kbd>
      </button>

      <div className="tb-right">
        {showRange && <RangePicker />}
        <DeepseekChip />
        <span className={`tb-live ${live ? 'is-live' : ''}`}>
          <span className="dot" />
          {live ? 'live' : 'idle'}
        </span>
        <button
          type="button"
          className={`tb-privacy ${privacy ? 'is-private' : ''}`}
          onClick={togglePrivacy}
          title={privacy ? "Privacy mode ON — money figures hidden ($•••). Click or press ⌘P to reveal." : "Privacy mode OFF — click or press ⌘P to hide money figures ($•••)"}
        >
          {privacy ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
          <span>{privacy ? 'hidden' : 'mask $'}</span>
        </button>
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
