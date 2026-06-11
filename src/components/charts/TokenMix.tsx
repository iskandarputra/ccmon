/**
 * @file TokenMix.tsx
 * @brief All-time token mix — input, output, cache read/write (donut).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { fmtTok } from '../../lib/format';
import { TOKEN_COLORS } from '../../lib/palette';

export function TokenMix() {
  const totals = useUsageStore((s) => s.snapshot?.totals);
  if (!totals) return null;

  const slices = [
    { name: 'output', value: totals.out, color: TOKEN_COLORS.out },
    { name: 'input', value: totals.in, color: TOKEN_COLORS.in },
    { name: 'cache read', value: totals.read, color: TOKEN_COLORS.read },
    { name: 'cache write', value: totals.write, color: TOKEN_COLORS.write },
  ].filter((s) => s.value > 0);
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;

  return (
    <Panel title="token mix · all time">
      <div className="mix-wrap">
        <div className="mix-chart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={47}
                outerRadius={68}
                paddingAngle={2.5}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="mix-center">
            <b>{fmtTok(totals.in + totals.out)}</b>
            <span>in + out</span>
          </div>
        </div>
        <ul className="mix-legend">
          {slices.map((s) => (
            <li key={s.name}>
              <i className="ml-swatch" style={{ background: s.color }} />
              <span className="ml-name">{s.name}</span>
              <span className="ml-val">{fmtTok(s.value)}</span>
              <span className="ml-pct">{((s.value / sum) * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
