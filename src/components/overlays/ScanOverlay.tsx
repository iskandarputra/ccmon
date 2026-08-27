/**
 * @file ScanOverlay.tsx
 * @brief Clean, minimalist, executive indexing status overlay.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { fmtInt } from '../../lib/format';

export function ScanOverlay() {
  const progress = useUsageStore((s) => s.progress);
  const status = useUsageStore((s) => s.status);

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.scanned / progress.total) * 100))
      : null;

  return (
    <div className="overlay">
      <div className="ov-hud">
        <div className="ov-hud-head">
          <div className="ov-brand">
            <span className="tb-glyph">
              <i />
              <i />
              <i />
            </span>
            <span className="ov-title">ccmon</span>
          </div>
          <span className={`ov-state ${status === 'error' ? 'is-err' : 'is-active'}`}>
            {status === 'error' ? 'error' : 'indexing'}
          </span>
        </div>

        <div className="ov-readout">
          <div className="ov-main-num">{pct != null ? `${pct}%` : '—'}</div>
          <div className="ov-main-label">
            {status === 'error'
              ? 'Parsing failed — inspect terminal logs'
              : 'Indexing local Claude Code transcripts…'}
          </div>
        </div>

        <div className="ov-track">
          <div
            className={`ov-fill ${pct == null ? 'is-indet' : ''}`}
            style={{ width: `${pct ?? 30}%` }}
          />
        </div>

        <div className="ov-telemetry">
          <div className="ov-cell">
            <span className="ov-k">Transcripts</span>
            <span className="ov-v">
              {progress.total > 0
                ? `${fmtInt(progress.scanned)} / ${fmtInt(progress.total)}`
                : 'locating…'}
            </span>
          </div>
          <div className="ov-cell">
            <span className="ov-k">Entries</span>
            <span className="ov-v">{fmtInt(progress.entries)}</span>
          </div>
          <div className="ov-cell">
            <span className="ov-k">Source</span>
            <span className="ov-v ov-path">~/.claude/transcripts</span>
          </div>
        </div>
      </div>
    </div>
  );
}
