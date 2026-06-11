/**
 * @file ScanOverlay.tsx
 * @brief Initial-scan progress overlay.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { fmtInt } from '../../lib/format';

export function ScanOverlay() {
  const progress = useUsageStore((s) => s.progress);
  const status = useUsageStore((s) => s.status);
  const pct = progress.total > 0 ? (progress.scanned / progress.total) * 100 : null;

  return (
    <div className="overlay">
      <div className="logo-bars"><i /><i /><i /></div>
      <h1>ccmon</h1>
      <p className="ov-sub">
        {status === 'error' ? 'something went wrong — check the terminal' : 'indexing local transcripts'}
      </p>
      <div className="ov-bar">
        <div
          className={pct == null ? 'indeterminate' : ''}
          style={{ width: `${pct ?? 30}%` }}
        />
      </div>
      <p className="ov-meta">
        {progress.total > 0
          ? `${progress.scanned}/${progress.total} transcripts · ${fmtInt(progress.entries)} entries`
          : 'locating data…'}
      </p>
    </div>
  );
}
