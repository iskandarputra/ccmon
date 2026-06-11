/**
 * @file EmptyState.tsx
 * @brief First-run / no-data placeholder.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { tildify } from '../../lib/format';

export function EmptyState() {
  const sourceDirs = useUsageStore((s) => s.sourceDirs);

  return (
    <div className="overlay">
      <div className="logo-bars"><i /><i /><i /></div>
      <h1>no usage data yet</h1>
      <p className="ov-sub">looked for transcripts in:</p>
      <ul className="ov-dirs">
        {(sourceDirs.length ? sourceDirs : ['~/.claude/projects']).map((d) => (
          <li key={d}>{tildify(d)}</li>
        ))}
      </ul>
      <p className="ov-meta">
        run a Claude Code session and this dashboard lights up on its own
      </p>
      <button className="sb-btn" onClick={() => window.ccmon?.rescan()}>
        rescan now
      </button>
    </div>
  );
}
