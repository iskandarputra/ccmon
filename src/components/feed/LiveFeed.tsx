/**
 * @file LiveFeed.tsx
 * @brief Live entry feed — the newest usage events as they land.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { Panel } from '../ui/Panel';
import { useUsageStore } from '../../store/useUsageStore';
import { fmtTok, fmtUSDPrecise, feedTime, shortModel, projectName } from '../../lib/format';

export function LiveFeed() {
  const feed = useUsageStore((s) => s.feed);

  return (
    <Panel
      title="live feed"
      right={feed.length > 0 && <span className="panel-note">{feed.length} recent</span>}
    >
      {feed.length === 0 ? (
        <div className="feed-empty">
          <span className="dot" />
          waiting for activity — open a Claude Code session
        </div>
      ) : (
        <ul className="feed">
          {feed.map((e) => (
            <li className="feed-item" key={e.key}>
              <span className="f-time">{feedTime(e.ts)}</span>
              <span className="f-proj" title={e.project}>{projectName(e.project)}</span>
              <span className={`f-model ${e.sidechain ? 'is-side' : ''}`} title={e.model}>
                {shortModel(e.model)}
              </span>
              <span className="f-tok" title={`cache: ${fmtTok(e.read)} read · ${fmtTok(e.write)} write`}>
                {fmtTok(e.in)} in · {fmtTok(e.out)} out
              </span>
              <span className="f-cost">{fmtUSDPrecise(e.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
