/**
 * @file TitleBar.tsx
 * @brief Frameless-window title bar with traffic controls.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';

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

export function TitleBar() {
  const lastEventTs = useUsageStore((s) => s.lastEventTs);
  const now = useNow(5000);
  const live = lastEventTs && now - lastEventTs < LIVE_WINDOW_MS;

  return (
    <header className="titlebar" onDoubleClick={() => window.ccmon?.toggleMaximize()}>
      <div className="tb-brand">
        <span className="tb-glyph"><i /><i /><i /></span>
        <span className="tb-name">ccmon</span>
        <span className="tb-tag">claude code monitor</span>
      </div>
      <div className="tb-right">
        <span className={`tb-live ${live ? 'is-live' : ''}`}>
          <span className="dot" />
          {live ? 'live' : 'idle'}
        </span>
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
