/**
 * @file ProjectsTable.tsx
 * @brief Overview projects table with per-project sparklines.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { fmtUSD, fmtTok, relTime, projectName, tildify } from '../../lib/format';

export function ProjectsTable() {
  const projects = useUsageStore((s) => s.snapshot?.projects) || [];
  const setView = useUsageStore((s) => s.setView);
  const now = useNow(30000);

  return (
    <Panel
      title="projects"
      right={
        <button
          className="panel-link"
          onClick={() => setView('projects')}
          title="open the projects view"
        >
          {projects.length} tracked →
        </button>
      }
    >
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>project</th>
              <th>last active</th>
              <th>today</th>
              <th>7 days</th>
              <th>all time</th>
              <th>tokens</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.path}>
                <td className="t-name" title={tildify(p.path)}>{projectName(p.path)}</td>
                <td>{relTime(p.lastTs, now)}</td>
                <td>{p.todayCost > 0 ? fmtUSD(p.todayCost) : '—'}</td>
                <td>{p.weekCost > 0 ? fmtUSD(p.weekCost) : '—'}</td>
                <td className="t-cost">{fmtUSD(p.cost)}</td>
                <td>{fmtTok(p.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
