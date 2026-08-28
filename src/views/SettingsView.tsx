/**
 * @file SettingsView.tsx
 * @brief Settings view — organized into 4 categorized tabs: Appearance, Limits, Providers, Resources.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Panel } from '../components/ui/Panel';
import { useUsageStore } from '../store/useUsageStore';
import { updateSettings } from '../bootstrap';
import { useNow } from '../hooks/useNow';
import { fmtInt, fmtTok, relTime, tildify, sourceLabel, primarySource } from '../lib/format';
import { CRYPTO_SYMBOLS } from '../lib/format';
import { THEMES } from '../theme/themes';
import { ADVISOR_MODELS } from '../../shared/types';
import { dayKeyFor, systemZone } from '../../shared/daykey';
import { accountGroups } from '../../shared/tools';
import type { CostMode, ExportKind, PricingMeta, PricingSource } from '../../shared/types';
import './settings.css';

type SettingsTab = 'appearance' | 'limits' | 'providers' | 'resources';

/* swatch strip = bg0 band + these five token chips */
const SWATCH_KEYS = ['text', 'sage', 'amber', 'rose', 'blue'] as const;

const PRICING_SOURCES: Record<PricingSource, string> = {
  'litellm-live': 'litellm · live',
  'litellm-cache': 'litellm · cached',
  bundled: 'bundled snapshot',
};

const COST_MODES: Array<{ value: CostMode; label: string; note: string }> = [
  { value: 'auto', label: 'auto', note: 'recorded cost when present, else calculated' },
  { value: 'calculate', label: 'calculate', note: 'always recompute from tokens × pricing' },
  { value: 'display', label: 'display', note: 'only costs recorded by the cli' },
];

function costModeNote(value: CostMode, hasRecorded: boolean): string {
  const base = COST_MODES.find((m) => m.value === value)?.note ?? '';
  if (hasRecorded) return base;
  if (value === 'display') return 'your transcripts record no costs — this shows $0.00';
  if (value === 'auto') return 'no recorded costs found, so identical to calculate';
  return base;
}

type LimitMode = 'max' | 'custom' | 'off';

function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICON_REFRESH = (
  <>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </>
);

interface RadioProps<T extends string> {
  name: string;
  value: T;
  current: string;
  onSelect: (value: T) => void;
  label: string;
  note?: string;
}

function Radio<T extends string>({ name, value, current, onSelect, label, note }: RadioProps<T>) {
  const checked = current === value;
  return (
    <label className={`set-radio${checked ? ' is-on' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={() => onSelect(value)} />
      <span className="set-radio-dot" aria-hidden="true" />
      <span className="set-radio-text">
        <span className="set-opt-name">{label}</span>
        {note && <span className="set-opt-desc">{note}</span>}
      </span>
    </label>
  );
}

interface ToggleProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  note?: string;
}

function Toggle({ checked, onChange, label, note }: ToggleProps) {
  return (
    <label className="set-toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-toggle-track" aria-hidden="true" />
      <span className="set-radio-text">
        <span className="set-opt-name">{label}</span>
        {note && <span className="set-opt-desc">{note}</span>}
      </span>
    </label>
  );
}

const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: 'days', label: 'daily' },
  { kind: 'sessions', label: 'sessions' },
  { kind: 'projects', label: 'projects' },
  { kind: 'models', label: 'models' },
];

function ExportPanel() {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [msg, setMsg] = useState<string>('');

  async function run(kind: ExportKind) {
    if (busy) return;
    setBusy(kind);
    setMsg('');
    const r = await window.ccmon?.exportCsv(kind);
    setBusy(null);
    if (!r) return setMsg('export unavailable');
    if (r.ok) setMsg(`saved ${r.rows} ${kind} rows → ${r.path}`);
    else if (!r.canceled) setMsg(`export failed — ${r.error || 'unknown error'}`);
  }

  return (
    <Panel title="export data">
      <div className="set-export">
        {EXPORTS.map((e) => (
          <button
            key={e.kind}
            type="button"
            className="set-btn"
            onClick={() => run(e.kind)}
            disabled={busy !== null}
          >
            {busy === e.kind ? 'saving…' : `${e.label} csv`}
          </button>
        ))}
      </div>
      {msg && (
        <p className="set-note" title={msg}>
          {msg}
        </p>
      )}
      <p className="set-note">
        Exports the current data scope as CSV with full-precision numbers for spreadsheets and
        external analysis.
      </p>
    </Panel>
  );
}

const OFFICIAL_LINKS = [
  { title: 'Anthropic News', url: 'https://www.anthropic.com/news', host: 'anthropic.com' },
  {
    title: "Claude Code — What's New",
    url: 'https://code.claude.com/docs/en/whats-new',
    host: 'code.claude.com',
  },
  { title: 'Claude Service Status', url: 'https://status.claude.com/', host: 'status.claude.com' },
  { title: 'Claude on X (@ClaudeAI)', url: 'https://x.com/ClaudeAI', host: 'x.com' },
  { title: 'Claude Developers (@ClaudeDevs)', url: 'https://x.com/ClaudeDevs', host: 'x.com' },
  { title: 'r/claude Subreddit', url: 'https://www.reddit.com/r/claude/', host: 'reddit.com' },
];

const ZONE_GROUPS: Array<[string, string[]]> = (() => {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC'];
  }
  const groups = new Map<string, string[]>();
  for (const z of zones) {
    const region = z.includes('/') ? z.slice(0, z.indexOf('/')) : 'other';
    const list = groups.get(region);
    if (list) list.push(z);
    else groups.set(region, [z]);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
})();

const SYSTEM_ZONE = systemZone();

export function SettingsView() {
  const settings = useUsageStore((s) => s.settings);
  const pricingMeta = useUsageStore((s) => s.pricingMeta);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const sourceGroups = accountGroups(sourceDirs ?? []);
  const accounts = useUsageStore((s) => s.accounts);
  const currency = useUsageStore((s) => s.currency);
  const version = useUsageStore((s) => s.version);
  const maxBlockTokens = useUsageStore((s) => s.snapshot?.records?.maxBlockTokens) || 0;
  const hasRecordedCosts = useUsageStore((s) => (s.snapshot?.reconcile?.compared ?? 0) > 0);
  const now = useNow(30000);

  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingCur, setRefreshingCur] = useState(false);
  const [freshMeta, setFreshMeta] = useState<PricingMeta | null>(null);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const tokenLimit = settings?.tokenLimit;
  const [draft, setDraft] = useState(typeof tokenLimit === 'number' ? String(tokenLimit) : '');
  useEffect(() => {
    if (typeof tokenLimit === 'number') setDraft(String(tokenLimit));
  }, [tokenLimit]);

  if (!settings) {
    return (
      <div className="set-wrap">
        <p className="view-placeholder">waiting for settings…</p>
      </div>
    );
  }

  const limitMode: LimitMode =
    tokenLimit === 'max' ? 'max' : typeof tokenLimit === 'number' ? 'custom' : 'off';

  const dirs = sourceDirs || [];
  const liveSources = Array.isArray(settings.sources)
    ? settings.sources.filter((d) => dirs.includes(d))
    : [];
  const activeSources = new Set(
    liveSources.length ? liveSources : ([primarySource(dirs)].filter(Boolean) as string[]),
  );

  function toggleSource(dirs: string[], on: boolean) {
    const next = new Set(activeSources);
    for (const dir of dirs) {
      if (on) next.add(dir);
      else next.delete(dir);
    }
    if (!next.size) return;
    updateSettings({ sources: [...next] });
  }

  const meta = !freshMeta
    ? pricingMeta
    : !pricingMeta || (freshMeta.fetchedAt || 0) >= (pricingMeta.fetchedAt || 0)
      ? freshMeta
      : pricingMeta;

  async function refreshPricing() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const m = await window.ccmon?.refreshPricing();
      if (m && typeof m === 'object') setFreshMeta(m);
    } catch {
      /* keep whatever meta we had */
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshCurrency() {
    if (refreshingCur) return;
    setRefreshingCur(true);
    try {
      await window.ccmon?.refreshCurrency();
    } finally {
      setRefreshingCur(false);
    }
  }

  const curCode = settings?.currency || 'USD';
  const curRate = curCode === 'USD' ? 1 : currency?.rates?.[curCode];
  const known = Object.keys(currency?.rates || {});
  const fiatCodes = ['USD', ...known.filter((c) => c !== 'USD' && !CRYPTO_SYMBOLS[c]).sort()];
  const cryptoCodes = known.filter((c) => CRYPTO_SYMBOLS[c]).sort();
  if (!fiatCodes.includes(curCode) && !cryptoCodes.includes(curCode)) fiatCodes.push(curCode);

  function selectLimit(mode: LimitMode) {
    if (mode === 'max') {
      updateSettings({ tokenLimit: 'max' });
    } else if (mode === 'off') {
      updateSettings({ tokenLimit: null });
    } else {
      const n = parseInt(String(draft).replace(/[,_\s]/g, ''), 10);
      const fallback = Number.isFinite(n) && n > 0 ? n : maxBlockTokens || 50_000_000;
      updateSettings({ tokenLimit: fallback });
    }
  }

  function commitDraft() {
    const n = parseInt(String(draft).replace(/[,_\s]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) {
      updateSettings({ tokenLimit: n });
    } else if (typeof tokenLimit === 'number') {
      setDraft(String(tokenLimit));
    } else {
      setDraft('');
    }
  }

  return (
    <div className="set-studio-layout">
      {/* Left Sidebar Nav Rail */}
      <aside className="set-sidebar-nav">
        <button
          type="button"
          className={`set-nav-btn${activeTab === 'appearance' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('appearance')}
        >
          <Glyph className="set-nav-icon">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 1 9 9h-9z" />
          </Glyph>
          <span>Appearance</span>
        </button>

        <button
          type="button"
          className={`set-nav-btn${activeTab === 'limits' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('limits')}
        >
          <Glyph className="set-nav-icon">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
          </Glyph>
          <span>Limits &amp; Engine</span>
        </button>

        <button
          type="button"
          className={`set-nav-btn${activeTab === 'providers' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('providers')}
        >
          <Glyph className="set-nav-icon">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </Glyph>
          <span>Currencies &amp; AI</span>
        </button>

        <button
          type="button"
          className={`set-nav-btn${activeTab === 'resources' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('resources')}
        >
          <Glyph className="set-nav-icon">
            <path d="M4 4h16v16H4z" />
            <path d="M4 9h16M9 4v16" />
          </Glyph>
          <span>Exports &amp; Data</span>
        </button>
      </aside>

      {/* Right Stage */}
      <main className="set-stage">
        {/* Tab 1: Appearance & Themes */}
        {activeTab === 'appearance' && (
          <div className="set-stage-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <Panel
                title="themes &amp; color palette"
                right={
                  <div className="set-head">
                    <span className="panel-note">{settings.theme}</span>
                    <button
                      type="button"
                      className="set-reveal"
                      onClick={() => setShowAllThemes((v) => !v)}
                      aria-expanded={showAllThemes}
                    >
                      <span>{showAllThemes ? 'collapse' : `all themes · ${THEMES.length}`}</span>
                      <Glyph className={`set-reveal-icon${showAllThemes ? ' is-open' : ''}`}>
                        <path d="M6 9l6 6 6-6" />
                      </Glyph>
                    </button>
                  </div>
                }
              >
                <div className="set-themes">
                  {THEMES.map((t, i) => {
                    const active = t.id === settings.theme;
                    if (!showAllThemes && i >= 8 && !active) return null;

                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`set-theme-card${active ? ' is-active' : ''}`}
                        onClick={() => updateSettings({ theme: t.id })}
                        title={`Switch to ${t.name}`}
                      >
                        <span
                          className="set-theme-strip"
                          style={{ backgroundColor: t.tokens.bg0 }}
                          aria-hidden="true"
                        >
                          {SWATCH_KEYS.map((k) => (
                            <i key={k} style={{ backgroundColor: t.tokens[k] }} />
                          ))}
                        </span>
                        <span className="set-theme-meta">
                          <span className="set-theme-name">
                            {t.name}
                            {active && <em>active</em>}
                          </span>
                          <span className="set-theme-desc">{t.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div className="set-col">
              <Panel title="display preferences">
                <Toggle
                  checked={settings.compactNumbers}
                  onChange={(v) => updateSettings({ compactNumbers: v })}
                  label="compact numbers"
                  note="Abbreviate large figures (e.g. 1.2M tokens instead of 1,234,567)"
                />
                <div className="set-divider" />
                <Toggle
                  checked={settings.privacyMode}
                  onChange={(v) => updateSettings({ privacyMode: v })}
                  label="privacy mode (⌘P)"
                  note="Blank money figures ($•••) for screen sharing, streams, and screenshots"
                />
              </Panel>
            </div>

            <div className="set-col">
              <Panel title="window &amp; desktop behavior">
                <Toggle
                  checked={settings.closeToTray}
                  onChange={(v) => updateSettings({ closeToTray: v })}
                  label="close to system tray"
                  note="Closing the main window keeps ccmon monitoring in the background"
                />
                <div className="set-divider" />
                <Toggle
                  checked={settings.notifyNearCap}
                  onChange={(v) => updateSettings({ notifyNearCap: v })}
                  label="desktop near-cap alerts"
                  note="Send a desktop notification when an account reaches 90% of its rate limit"
                />
              </Panel>
            </div>
          </div>
        )}

        {/* Tab 2: Limits & Engine */}
        {activeTab === 'limits' && (
          <div className="set-stage-grid">
            <div className="set-col">
              <Panel title="cost calculation mode">
                {!hasRecordedCosts && settings.costMode === 'display' && (
                  <div className="set-err">
                    Every figure reads $0.00: this mode shows only costs recorded by the CLI, and
                    your transcripts contain none. Switch to calculate.
                  </div>
                )}
                <div className="set-radios">
                  {COST_MODES.map((m) => (
                    <Radio
                      key={m.value}
                      name="set-costmode"
                      value={m.value}
                      current={settings.costMode}
                      onSelect={(v) => updateSettings({ costMode: v })}
                      label={m.label}
                      note={costModeNote(m.value, hasRecordedCosts)}
                    />
                  ))}
                </div>
              </Panel>

              <Panel title="5-hour block window">
                <div className="set-kv">
                  <div>
                    <span>window length</span>
                    <select
                      className="set-input set-currency"
                      value={String(settings.blockHours ?? 5)}
                      onChange={(e) =>
                        updateSettings({
                          blockHours: Number(e.target.value) === 5 ? null : Number(e.target.value),
                        })
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 8, 12, 24].map((h) => (
                        <option key={h} value={h}>
                          {h}h{h === 5 ? ' · Anthropic billing default' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="set-note">
                  Only 5h matches Anthropic's rolling rate limit window. Other lengths reframe
                  blocks as custom pacing sessions.
                </div>
              </Panel>
            </div>

            <div className="set-col">
              <Panel title="token limit gauge">
                <div className="set-radios">
                  <Radio
                    name="set-limit"
                    value="max"
                    current={limitMode}
                    onSelect={selectLimit}
                    label="max"
                    note={
                      maxBlockTokens
                        ? `Largest completed block (${fmtTok(maxBlockTokens)} tok)`
                        : 'Largest completed block'
                    }
                  />
                  <div className="set-radio-row">
                    <Radio
                      name="set-limit"
                      value="custom"
                      current={limitMode}
                      onSelect={selectLimit}
                      label="custom"
                      note="Fixed token budget per block"
                    />
                    <input
                      className="set-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="tokens"
                      value={draft}
                      disabled={limitMode !== 'custom'}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitDraft}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </div>
                  <Radio
                    name="set-limit"
                    value="off"
                    current={limitMode}
                    onSelect={selectLimit}
                    label="off"
                    note="Hide the limit gauge"
                  />
                </div>
                <div className="set-divider" />
                <Toggle
                  checked={settings.notifyNearCap}
                  onChange={(v) => updateSettings({ notifyNearCap: v })}
                  label="near-cap alerts"
                  note="Desktop notification when an account reaches 90% of limit"
                />
              </Panel>

              <Panel title="timezone &amp; day boundary">
                <div className="set-kv">
                  <div>
                    <span>timezone</span>
                    <select
                      className="set-input set-currency"
                      value={settings.timezone || ''}
                      onChange={(e) => updateSettings({ timezone: e.target.value })}
                    >
                      <option value="">system · {SYSTEM_ZONE}</option>
                      {ZONE_GROUPS.map(([region, zones]) => (
                        <optgroup key={region} label={region}>
                          {zones.map((z) => (
                            <option key={z} value={z}>
                              {z}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span>today is</span>
                    <b>{dayKeyFor(now, settings.timezone || null)}</b>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* Tab 3: Currencies & AI */}
        {activeTab === 'providers' && (
          <div className="set-stage-grid">
            <div className="set-col">
              <Panel title="display currency &amp; rates">
                <div className="set-kv">
                  <div>
                    <span>currency</span>
                    <select
                      className="set-input set-currency"
                      value={curCode}
                      onChange={(e) => updateSettings({ currency: e.target.value })}
                    >
                      <optgroup label="fiat">
                        {fiatCodes.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
                      {cryptoCodes.length > 0 && (
                        <optgroup label="crypto">
                          {cryptoCodes.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div>
                    <span>rate</span>
                    <b>
                      {curCode === 'USD'
                        ? '1 · base'
                        : curRate
                          ? `${curRate < 0.01 ? curRate.toExponential(3) : curRate.toFixed(curRate < 10 ? 4 : 2)} per usd`
                          : 'usd'}
                    </b>
                  </div>
                  <button
                    type="button"
                    className="set-btn set-btn-icon"
                    onClick={refreshCurrency}
                    disabled={refreshingCur}
                  >
                    <Glyph className={`set-btn-glyph${refreshingCur ? ' is-spin' : ''}`}>
                      {ICON_REFRESH}
                    </Glyph>
                    {refreshingCur ? 'refreshing…' : 'refresh rates'}
                  </button>
                </div>
              </Panel>

              <Panel title="pricing catalog">
                <div className="set-kv">
                  <div>
                    <span>source</span>
                    <b>{meta ? PRICING_SOURCES[meta.source] || meta.source : '—'}</b>
                  </div>
                  <div>
                    <span>fetched</span>
                    <b>{meta?.fetchedAt ? relTime(meta.fetchedAt, now) : '—'}</b>
                  </div>
                  <div>
                    <span>models</span>
                    <b>{meta ? fmtInt(meta.modelCount) : '—'}</b>
                  </div>
                  <button
                    type="button"
                    className="set-btn set-btn-icon"
                    onClick={refreshPricing}
                    disabled={refreshing}
                  >
                    <Glyph className={`set-btn-glyph${refreshing ? ' is-spin' : ''}`}>
                      {ICON_REFRESH}
                    </Glyph>
                    {refreshing ? 'refreshing…' : 'update catalog'}
                  </button>
                </div>
                <div className="set-divider" />
                <Toggle
                  checked={settings.pricingOffline}
                  onChange={(v) => updateSettings({ pricingOffline: v })}
                  label="offline mode"
                  note="Use bundled snapshot, skipping daily background pricing fetch"
                />
              </Panel>
            </div>

            <div className="set-col">
              <Panel title="ai advisor model">
                <div className="set-kv">
                  <div>
                    <span>model</span>
                    <select
                      className="set-input"
                      value={settings.aiModel}
                      onChange={(e) => updateSettings({ aiModel: e.target.value })}
                    >
                      {ADVISOR_MODELS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="set-note">
                  The Advisor answers queries about your aggregated usage. It uses your Claude Code
                  login and sends zero raw code or prompts.
                </p>
              </Panel>

              <Panel title="data directories">
                {sourceGroups.length > 1 ? (
                  <div className="set-radios">
                    {sourceGroups.map(({ root, tool, dirs }) => {
                      const acct = accounts?.[dirs[0]];
                      const detail = [
                        tildify(root),
                        tool.label,
                        acct?.plan ? `${acct.plan}${acct.tier ? ` ${acct.tier}` : ''}` : null,
                        acct?.email,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <Toggle
                          key={root}
                          checked={dirs.some((d) => activeSources.has(d))}
                          onChange={(v) => toggleSource(dirs, v)}
                          label={sourceLabel(dirs[0])}
                          note={detail}
                        />
                      );
                    })}
                  </div>
                ) : sourceDirs?.length ? (
                  <ul className="set-dirs">
                    {sourceDirs.map((d) => (
                      <li key={d}>{tildify(d)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="set-empty">no source directories detected</p>
                )}
                <div className="set-actions">
                  <button
                    type="button"
                    className="set-btn set-btn-icon"
                    onClick={() => window.ccmon?.openDataDir()}
                  >
                    <Glyph className="set-btn-glyph">
                      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                    </Glyph>
                    open folder
                  </button>
                  <button
                    type="button"
                    className="set-btn set-btn-icon"
                    onClick={() => window.ccmon?.rescan()}
                  >
                    <Glyph className="set-btn-glyph">{ICON_REFRESH}</Glyph>
                    rescan
                  </button>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* Tab 4: Exports & Resources */}
        {activeTab === 'resources' && (
          <div className="set-stage-grid">
            <div className="set-col">
              <ExportPanel />

              <Panel title="about ccmon">
                <div className="set-about">
                  <span className="set-about-name">ccmon</span>
                  <span className="set-about-ver">v{version || '1.13.0'}</span>
                </div>
                <p className="set-note">
                  Live monitoring, rate limit forecasting, and multi-tenant analytics for Claude
                  Code and OpenAI Codex CLI.
                </p>
                <div className="set-actions" style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="set-btn"
                    onClick={() => window.ccmon?.openUrl('https://github.com/iskandarputra/ccmon')}
                  >
                    GitHub Repository
                  </button>
                </div>
              </Panel>
            </div>

            <div className="set-col">
              <Panel title="official resources &amp; status">
                <div className="set-links-grid">
                  {OFFICIAL_LINKS.map((link) => (
                    <button
                      type="button"
                      key={link.url}
                      className="set-link-card"
                      onClick={() => window.ccmon?.openUrl(link.url)}
                    >
                      <b>{link.title}</b>
                      <span>{link.host} ↗</span>
                    </button>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
