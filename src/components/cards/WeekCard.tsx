/**
 * @file WeekCard.tsx
 * @brief Overview card — rolling 7-day spend with the binding weekly limit.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { fmtUSD, fmtTok } from '../../lib/format';
import { bindingWeek, limitColor } from '../../lib/limits';
import { CountUp } from '../ui/CountUp';

/**
 * This week's spend, plus the real weekly plan limit (binding account) when
 * live data is available — the weekly cap is the one that actually locks
 * people out, so it earns a spot on the overview.
 */
export function WeekCard() {
  const week = useUsageStore((s) => s.snapshot?.week);
  const limits = useUsageStore((s) => s.limits);
  const now = useNow(30000);

  const wk = bindingWeek(limits);
  const pct = typeof wk?.pct === 'number' ? wk.pct : null;
  const resetDay =
    wk?.resetsAt && wk.resetsAt > now
      ? new Date(wk.resetsAt).toLocaleDateString([], { weekday: 'short' })
      : null;

  return (
    <div className="panel stat-card">
      <div className="stat-label">this week</div>
      <div className="stat-value">
        <CountUp value={week?.cost || 0} format={fmtUSD} />
      </div>
      {pct != null && (
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, Math.max(pct, 1.5))}%`,
              background: limitColor(pct),
            }}
          />
        </div>
      )}
      <div className="stat-foot">
        <span className="stat-sub">{fmtTok(week?.tokens)} tok · 7d</span>
        {pct != null && (
          <span className="stat-sub" title="weekly plan limit · all models">
            <span style={{ color: limitColor(pct) }}>{Math.round(pct)}%</span>
            {resetDay ? ` · resets ${resetDay}` : ' of week limit'}
          </span>
        )}
      </div>
    </div>
  );
}
