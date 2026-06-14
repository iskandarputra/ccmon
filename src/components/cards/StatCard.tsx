/**
 * @file StatCard.tsx
 * @brief Generic stat card — label, value, delta or aside.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { ReactNode } from 'react';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** percentage vs yesterday; rendered as ▲/▼ when finite */
  delta?: number | null;
  aside?: ReactNode;
  hint?: ReactNode;
}

export function StatCard({ label, value, sub, delta, aside, hint }: StatCardProps) {
  return (
    <div className="panel stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span className="stat-sub">{sub}</span>
        {delta != null && Number.isFinite(delta) ? (
          <span
            className={`stat-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}
            title="vs yesterday"
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
          </span>
        ) : aside ? (
          <span className="stat-delta">{aside}</span>
        ) : null}
      </div>
      {hint}
    </div>
  );
}
