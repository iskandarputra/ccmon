/**
 * @file DayDrilldown.tsx
 * @brief "Why was this day expensive" modal — on-demand per-day cost breakdown.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './daydrilldown.css';
import { useEffect, useState } from 'react';
import { dayLabel, fmtPct, fmtTok, fmtUSD, projectName, shortModel } from '../../lib/format';
import type { DayBreakdown, DayContributor } from '../../../shared/types';

interface DayDrilldownProps {
  /** local YYYY-MM-DD to break down, or null when closed */
  date: string | null;
  onClose: () => void;
}

/** A ranked contributor row with a proportional bar. */
function ContribRow({ c, format }: { c: DayContributor; format: (label: string) => string }) {
  return (
    <div className="dd-row" title={`${c.label} · ${fmtUSD(c.cost)} · ${fmtPct(c.pct)}`}>
      <span className="dd-row-name">{format(c.label)}</span>
      <span className="dd-row-bar">
        <i style={{ width: `${Math.max(2, Math.min(100, c.pct))}%` }} />
      </span>
      <span className="dd-row-val">{fmtUSD(c.cost)}</span>
    </div>
  );
}

/**
 * Fetches the day breakdown over IPC when `date` changes and renders it as a
 * modal. Closes on overlay click or Escape. The breakdown is recomputed from
 * the scoped entries in main, so it always matches the current data scope.
 */
export function DayDrilldown({ date, onClose }: DayDrilldownProps) {
  const [data, setData] = useState<DayBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setLoading(true);
    setData(null);
    void window.ccmon?.dayBreakdown(date).then((r) => {
      if (alive) {
        setData(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [date]);

  useEffect(() => {
    if (!date) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, onClose]);

  if (!date) return null;

  const vs = data?.vsMedianPct ?? null;
  const vsLabel =
    vs == null
      ? null
      : vs >= 0
        ? `${vs.toFixed(0)}% above your typical day`
        : `${Math.abs(vs).toFixed(0)}% below your typical day`;

  return (
    <div className="dd-overlay" onClick={onClose}>
      <div className="dd-card" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="dd-head">
          <div className="dd-title">
            why was <b>{dayLabel(date)}</b> {vs != null && vs >= 0 ? 'expensive' : 'like this'}?
          </div>
          <button type="button" className="dd-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {loading && <div className="dd-empty">crunching the day…</div>}
        {!loading && !data && <div className="dd-empty">no activity recorded on this day</div>}

        {data && (
          <>
            <div className="dd-summary">
              <div className="dd-summary-cost">
                <span className="dd-cost">{fmtUSD(data.cost)}</span>
                {vsLabel && (
                  <span className={`dd-vs${vs != null && vs >= 0 ? ' is-high' : ' is-low'}`}>
                    {vsLabel}
                  </span>
                )}
                <span className="dd-median">median day {fmtUSD(data.medianCost)}</span>
              </div>
              <div className="dd-stats">
                <span>
                  <b>{fmtTok(data.tokens)}</b> tokens
                </span>
                <span>
                  <b>{data.sessions}</b> sessions
                </span>
                <span>
                  <b>{data.entries}</b> entries
                </span>
              </div>
            </div>

            <div className="dd-cols">
              <section className="dd-col">
                <h4>top projects</h4>
                {data.topProjects.map((c) => (
                  <ContribRow key={c.key} c={c} format={projectName} />
                ))}
              </section>
              <section className="dd-col">
                <h4>top models</h4>
                {data.topModels.map((c) => (
                  <ContribRow key={c.key} c={c} format={shortModel} />
                ))}
              </section>
              <section className="dd-col">
                <h4>costliest sessions</h4>
                {data.topSessions.map((c) => (
                  <ContribRow key={c.key} c={c} format={projectName} />
                ))}
              </section>
            </div>

            <div className="dd-foot">
              <span className="dd-chip" title="tool-use turns · total invocations">
                🛠 {data.toolTurns} tool turns · {data.toolInvocations} calls
              </span>
              {data.compactions > 0 && (
                <span className="dd-chip" title="context compactions on this day">
                  🗜 {data.compactions} compaction{data.compactions === 1 ? '' : 's'}
                </span>
              )}
              {data.newProjects.length > 0 && (
                <span
                  className="dd-chip dd-chip-new"
                  title={data.newProjects.map(projectName).join(', ')}
                >
                  ✨ {data.newProjects.length} new project{data.newProjects.length === 1 ? '' : 's'}{' '}
                  started
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
