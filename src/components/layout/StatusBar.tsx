/**
 * @file StatusBar.tsx
 * @brief Bottom status strip — scan state, totals, version.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { updateSettings } from '../../bootstrap';
import {
  fmtInt,
  relTime,
  tildify,
  shortModel,
  sourceLabel,
  primarySource,
} from '../../lib/format';

interface SourceScopeProps {
  sourceDirs: string[];
  sources: string[] | null | undefined;
}

/**
 * all | <account> | <account> pills — shown only with multiple data roots.
 * No saved choice means "primary account only" (~/.claude), matching main.
 */
function SourceScope({ sourceDirs, sources }: SourceScopeProps) {
  const live = Array.isArray(sources)
    ? sources.filter((d) => sourceDirs.includes(d))
    : [];
  const active = live.length ? live : [primarySource(sourceDirs)];
  const isAll = active.length === sourceDirs.length;
  return (
    <div className="pills sb-scope" title="which account's data to show">
      <button
        className={`pill ${isAll ? 'is-active' : ''}`}
        onClick={() => updateSettings({ sources: [...sourceDirs] })}
      >
        all
      </button>
      {sourceDirs.map((dir) => (
        <button
          key={dir}
          className={`pill ${!isAll && active.includes(dir) ? 'is-active' : ''}`}
          onClick={() => updateSettings({ sources: [dir] })}
          title={tildify(dir)}
        >
          {sourceLabel(dir)}
        </button>
      ))}
    </div>
  );
}

export function StatusBar() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const version = useUsageStore((s) => s.version);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const sources = useUsageStore((s) => s.settings?.sources);
  const pricingMeta = useUsageStore((s) => s.pricingMeta);
  const now = useNow(5000);

  const unknown = snapshot?.unknownModels || [];

  return (
    <footer className="statusbar">
      <div className="sb-left">
        {sourceDirs.length > 1 ? (
          <SourceScope sourceDirs={sourceDirs} sources={sources} />
        ) : (
          <button
            className="sb-link"
            onClick={() => window.ccmon?.openDataDir()}
            title={sourceDirs.join('\n') || 'no data directory found'}
          >
            {sourceDirs.length ? tildify(sourceDirs[0]) : 'no data dir'}
          </button>
        )}
        {snapshot && (
          <>
            <span className="sb-sep">·</span>
            <span>{fmtInt(snapshot.entryCount)} entries</span>
            <span className="sb-sep">·</span>
            <span title="API-equivalent estimates">
              {snapshot.costMode || 'auto'} cost
            </span>
          </>
        )}
        {pricingMeta && (
          <>
            <span className="sb-sep">·</span>
            <span
              title={
                pricingMeta.fetchedAt
                  ? `pricing fetched ${relTime(pricingMeta.fetchedAt, now)} · ${pricingMeta.modelCount} models`
                  : `bundled pricing · ${pricingMeta.modelCount} models`
              }
            >
              pricing: {pricingMeta.source}
            </span>
          </>
        )}
        {unknown.length > 0 && (
          <>
            <span className="sb-sep">·</span>
            <span className="sb-warn" title={unknown.join(', ')}>
              no pricing: {unknown.map(shortModel).join(', ')}
            </span>
          </>
        )}
      </div>
      <div className="sb-right">
        {snapshot && <span>updated {relTime(snapshot.generatedAt, now)}</span>}
        <button className="sb-btn" onClick={() => window.ccmon?.rescan()}>
          rescan
        </button>
        <span>v{version || '0.0.0'}</span>
      </div>
    </footer>
  );
}
