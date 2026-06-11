/**
 * @file Heatmap.tsx
 * @brief Weekday-by-hour activity rhythm heatmap.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { fmtTok } from '../../lib/format';

const DAY_LABELS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Weekday × hour token intensity over the last 30 days. */
export function Heatmap() {
  const hourly = useUsageStore((s) => s.snapshot?.hourly);
  if (!hourly) return null;

  const max = Math.max(1, ...hourly.flat());
  // "you are here" — hourly is Monday-first
  const t = new Date();
  const nowDay = (t.getDay() + 6) % 7;
  const nowHour = t.getHours();

  return (
    <Panel title="rhythm · 30 days" right={<span className="panel-note">tokens by hour</span>}>
      <div className="hm-grid">
        <span className="hm-label" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="hm-cell hm-hour">
            {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
        {hourly.map((row, d) => (
          <HeatRow
            key={DAY_LABELS[d]}
            label={DAY_LABELS[d]}
            row={row}
            max={max}
            nowHour={d === nowDay ? nowHour : null}
          />
        ))}
      </div>
    </Panel>
  );
}

interface HeatRowProps {
  label: string;
  row: number[];
  max: number;
  nowHour: number | null;
}

function HeatRow({ label, row, max, nowHour }: HeatRowProps) {
  return (
    <>
      <span className="hm-label">{label}</span>
      {row.map((v, h) => {
        const pct = v > 0 ? Math.round(14 + 86 * Math.sqrt(v / max)) : 0;
        const isNow = h === nowHour;
        return (
          <span
            key={h}
            className={`hm-cell${isNow ? ' hm-now' : ''}`}
            title={`${label} ${String(h).padStart(2, '0')}:00 — ${fmtTok(v)} tok${isNow ? ' · now' : ''}`}
            style={
              pct
                ? { background: `color-mix(in srgb, var(--sage) ${pct}%, transparent)` }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
