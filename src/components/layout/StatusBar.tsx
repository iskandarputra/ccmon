/**
 * @file StatusBar.tsx
 * @brief High-precision bottom status strip & telemetry HUD.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { updateSettings } from '../../bootstrap';
import { fmtInt, relTime, tildify, shortModel, sourceLabel, primarySource } from '../../lib/format';
import './statusbar.css';

interface SourceScopeProps {
  sourceDirs: string[];
  sources: string[] | null | undefined;
}

/**
 * Multi-account scope selector pills.
 */
function SourceScope({ sourceDirs, sources }: SourceScopeProps) {
  const live = Array.isArray(sources) ? sources.filter((d) => sourceDirs.includes(d)) : [];
  const active = live.length ? live : [primarySource(sourceDirs)];
  const isAll = active.length === sourceDirs.length;

  return (
    <div className="sb-scope" title="Active telemetry data scope">
      <button
        type="button"
        className={`sb-scope-pill ${isAll ? 'is-active' : ''}`}
        onClick={() => updateSettings({ sources: [...sourceDirs] })}
      >
        All Accounts
      </button>
      {sourceDirs.map((dir) => (
        <button
          type="button"
          key={dir}
          className={`sb-scope-pill ${!isAll && active.includes(dir) ? 'is-active' : ''}`}
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
  const status = useUsageStore((s) => s.status);
  const snapshot = useUsageStore((s) => s.snapshot);
  const version = useUsageStore((s) => s.version);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const sources = useUsageStore((s) => s.settings?.sources);
  const pricingMeta = useUsageStore((s) => s.pricingMeta);
  const now = useNow(5000);

  const unknown = snapshot?.unknownModels || [];
  const isScanning = status === 'scanning';

  return (
    <footer className="statusbar">
      {/* Left Cluster: Account Scope & Core Telemetry */}
      <div className="sb-left">
        {sourceDirs.length > 1 ? (
          <SourceScope sourceDirs={sourceDirs} sources={sources} />
        ) : (
          <button
            type="button"
            className="sb-dir-link"
            onClick={() => window.ccmon?.openDataDir()}
            title={sourceDirs.join('\n') || 'no data directory found'}
          >
            <svg
              className="sb-dir-glyph"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            <span>{sourceDirs.length ? tildify(sourceDirs[0]) : 'no data dir'}</span>
          </button>
        )}

        {snapshot && (
          <>
            <span className="sb-chip">
              <span className="sb-chip-badge">{fmtInt(snapshot.entryCount)} logs</span>
            </span>
            <span
              className="sb-chip"
              title="Cost mode: auto (uses recorded CLI cost when available, else calculates from token rates)"
            >
              <span className="sb-chip-badge">⚡ {snapshot.costMode || 'auto'} cost</span>
            </span>
          </>
        )}
      </div>

      {/* Center Cluster: Pricing Catalog & Alerts */}
      <div className="sb-center">
        {pricingMeta && (
          <span
            className="sb-chip"
            title={
              pricingMeta.fetchedAt
                ? `Pricing catalog fetched ${relTime(pricingMeta.fetchedAt, now)} · ${pricingMeta.modelCount} models mapped`
                : `Bundled pricing catalog · ${pricingMeta.modelCount} models mapped`
            }
          >
            <span
              className={`sb-chip-badge ${pricingMeta.source === 'litellm-live' ? 'is-live' : ''}`}
            >
              {pricingMeta.source === 'litellm-live'
                ? `🟢 LiteLLM Live · ${fmtInt(pricingMeta.modelCount)} models`
                : pricingMeta.source === 'litellm-cache'
                  ? `🔵 LiteLLM Cache · ${fmtInt(pricingMeta.modelCount)} models`
                  : `📦 Bundled · ${fmtInt(pricingMeta.modelCount)} models`}
            </span>
          </span>
        )}

        {unknown.length > 0 && (
          <span className="sb-warn-pill" title={`Unpriced models: ${unknown.join(', ')}`}>
            <span>⚠</span>
            <span>
              {unknown.length} unpriced ({unknown.map(shortModel).slice(0, 2).join(', ')}
              {unknown.length > 2 ? '…' : ''})
            </span>
          </span>
        )}
      </div>

      {/* Right Cluster: Sync State, Quick Actions & Version */}
      <div className="sb-right">
        {snapshot && (
          <div className="sb-sync-status">
            <span
              className={`sb-sync-dot ${isScanning ? 'is-scanning' : status === 'error' ? 'is-error' : ''}`}
            />
            <span>
              {isScanning ? 'Scanning logs…' : `Synced ${relTime(snapshot.generatedAt, now)}`}
            </span>
          </div>
        )}

        <button
          type="button"
          className="sb-action-btn"
          onClick={() => window.ccmon?.rescan()}
          disabled={isScanning}
          title="Force immediate rescan of all local transcripts and logs"
        >
          <svg
            className={`sb-action-glyph ${isScanning ? 'is-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 5v6h-6" />
          </svg>
          <span>{isScanning ? 'scanning…' : 'rescan'}</span>
        </button>

        <span className="sb-ver" title="ccmon application version">
          v{version || '1.13.0'}
        </span>
      </div>
    </footer>
  );
}
