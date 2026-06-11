/**
 * @file ModelSplit.tsx
 * @brief All-time cost share by model (donut).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { fmtUSD, fmtTok, fmtInt, shortModel } from '../../lib/format';
import { ACCENTS } from '../../lib/palette';

const MAX_ROWS = 6;

export function ModelSplit() {
  const models = useUsageStore((s) => s.snapshot?.models) || [];
  const rows = models.slice(0, MAX_ROWS);
  const max = rows[0]?.cost || 1;

  return (
    <Panel title="by model · all time" right={<span className="panel-note">est cost</span>}>
      <div className="ms-rows">
        {rows.map((m, i) => (
          <div key={m.model}>
            <div className="ms-row" title={m.model}>
              <span className="ms-name">{shortModel(m.model)}</span>
              <div className="ms-track">
                <div
                  className="ms-fill"
                  style={{
                    width: `${Math.max(2, (m.cost / max) * 100)}%`,
                    background: ACCENTS[i % ACCENTS.length],
                  }}
                />
              </div>
              <span className="ms-val">{fmtUSD(m.cost)}</span>
            </div>
            <div className="ms-sub">
              {fmtTok(m.in + m.out)} tok · {fmtInt(m.entries)} msgs
            </div>
          </div>
        ))}
        {models.length > MAX_ROWS && (
          <div className="ms-sub">+ {models.length - MAX_ROWS} more</div>
        )}
      </div>
    </Panel>
  );
}
