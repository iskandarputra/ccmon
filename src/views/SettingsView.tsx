/**
 * @file SettingsView.tsx
 * @brief Settings view — themes, cost mode, currency, limits, data sources.
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
import type { CostMode, ExportKind, PricingMeta, PricingSource } from '../../shared/types';
import './settings.css';

/* swatch strip = bg0 band + these five token chips (depicts OTHER themes,
   so inline backgroundColor from that theme's tokens is intentional) */
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

type LimitMode = 'max' | 'custom' | 'off';

/** small inline SVG wrapper so all glyphs share stroke styling */
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

/** circular-arrows refresh glyph, shared by the refresh-now buttons */
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
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => onSelect(value)}
      />
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
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
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

/** CSV export buttons + transient result line. */
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
      {msg && <p className="set-note" title={msg}>{msg}</p>}
      <p className="set-note">
        exports the current data scope as CSV with full-precision numbers (USD +
        token splits) — for spreadsheets and external analysis.
      </p>
    </Panel>
  );
}

export function SettingsView() {
  const settings = useUsageStore((s) => s.settings);
  const pricingMeta = useUsageStore((s) => s.pricingMeta);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const accounts = useUsageStore((s) => s.accounts);
  const currency = useUsageStore((s) => s.currency);
  const version = useUsageStore((s) => s.version);
  const maxBlockTokens = useUsageStore((s) => s.snapshot?.records?.maxBlockTokens) || 0;
  const now = useNow(30000);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshingCur, setRefreshingCur] = useState(false);
  const [freshMeta, setFreshMeta] = useState<PricingMeta | null>(null);
  const [showAllThemes, setShowAllThemes] = useState(false);

  // The only locally mirrored value: the custom token-limit input draft.
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

  // Source scope: settings.sources is an array of project dirs, or null —
  // which defaults to the primary account only (matching main.js).
  const dirs = sourceDirs || [];
  const liveSources = Array.isArray(settings.sources)
    ? settings.sources.filter((d) => dirs.includes(d))
    : [];
  const activeSources = new Set(
    liveSources.length ? liveSources : ([primarySource(dirs)].filter(Boolean) as string[]),
  );

  function toggleSource(dir: string, on: boolean) {
    const next = new Set(activeSources);
    if (on) next.add(dir);
    else next.delete(dir);
    if (!next.size) return; // never filter down to nothing
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
      await window.ccmon?.refreshCurrency(); // result arrives via onCurrency
    } finally {
      setRefreshingCur(false);
    }
  }

  // current selection + codes the rates table knows (USD always offered),
  // grouped fiat / crypto for the picker
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
      const fallback =
        Number.isFinite(n) && n > 0 ? n : maxBlockTokens || 50_000_000;
      updateSettings({ tokenLimit: fallback });
    }
  }

  function commitDraft() {
    const n = parseInt(String(draft).replace(/[,_\s]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) {
      updateSettings({ tokenLimit: n });
    } else if (typeof tokenLimit === 'number') {
      setDraft(String(tokenLimit)); // revert invalid input to the saved value
    } else {
      setDraft('');
    }
  }

  return (
    <div className="set-wrap">
      <Panel
        title="theme"
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
                title={`switch to ${t.name}`}
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

      <div className="set-col">
        <Panel title="cost mode">
          <div className="set-radios">
            {COST_MODES.map((m) => (
              <Radio
                key={m.value}
                name="set-costmode"
                value={m.value}
                current={settings.costMode}
                onSelect={(v) => updateSettings({ costMode: v })}
                label={m.label}
                note={m.note}
              />
            ))}
          </div>
        </Panel>

        <Panel title="analytics">
          {/* weeks always start monday — the sunday option is retired */}
          <div className="set-field">
            <div className="set-field-label">
              token limit · local estimate, shown only when live limits are unavailable
            </div>
            <div className="set-radios">
              <Radio
                name="set-limit"
                value="max"
                current={limitMode}
                onSelect={selectLimit}
                label="max"
                note={
                  maxBlockTokens
                    ? `largest completed block · ${fmtTok(maxBlockTokens)} tok`
                    : 'largest completed block'
                }
              />
              <div className="set-radio-row">
                <Radio
                  name="set-limit"
                  value="custom"
                  current={limitMode}
                  onSelect={selectLimit}
                  label="custom"
                  note="fixed token budget per block"
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
                note="hide the limit gauge"
              />
            </div>
          </div>
          <div className="set-divider" />
          <Toggle
            checked={settings.compactNumbers}
            onChange={(v) => updateSettings({ compactNumbers: v })}
            label="compact numbers"
            note="abbreviate large counts — 1.2M instead of 1,234,567"
          />
          <div className="set-divider" />
          <Toggle
            checked={settings.notifyNearCap}
            onChange={(v) => updateSettings({ notifyNearCap: v })}
            label="near-cap notifications"
            note="OS alert when any account crosses ~90% of a session or weekly window"
          />
        </Panel>
      </div>

      <div className="set-col">
        <Panel title="pricing">
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
              {refreshing ? 'refreshing…' : 'refresh now'}
            </button>
          </div>
          {meta?.lastError && (
            <div className="set-err" title={meta.lastError}>
              <Glyph className="set-err-icon">
                <path d="M12 8.5v4.5M12 16h.01" />
                <path d="M10.3 3.9 2.6 17.3A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.7L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
              </Glyph>
              <span>
                last refresh failed — {meta.lastError} · using{' '}
                {meta.fetchedAt ? `data from ${relTime(meta.fetchedAt, now)}` : 'bundled snapshot'}
              </span>
            </div>
          )}
          <div className="set-divider" />
          <Toggle
            checked={settings.pricingOffline}
            onChange={(v) => updateSettings({ pricingOffline: v })}
            label="offline"
            note="skips the daily background refetch"
          />
        </Panel>

        <Panel title="display currency">
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
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
                {cryptoCodes.length > 0 && (
                  <optgroup label="crypto">
                    {cryptoCodes.map((c) => (
                      <option key={c} value={c}>{c}</option>
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
                    : 'unavailable — showing usd'}
              </b>
            </div>
            <div>
              <span>rates fetched</span>
              <b>{currency?.fetchedAt ? relTime(currency.fetchedAt, now) : '—'}</b>
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
              {refreshingCur ? 'refreshing…' : 'refresh now'}
            </button>
          </div>
          {currency?.lastError && (
            <div className="set-err" title={currency.lastError}>
              <Glyph className="set-err-icon">
                <path d="M12 8.5v4.5M12 16h.01" />
                <path d="M10.3 3.9 2.6 17.3A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.7L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
              </Glyph>
              <span>
                last refresh failed — {currency.lastError}
                {currency.fetchedAt ? ` · using rates from ${relTime(currency.fetchedAt, now)}` : ''}
              </span>
            </div>
          )}
          <p className="set-note">
            costs are computed in usd and converted at display time · fiat via
            open.er-api.com, crypto via coingecko · refreshed hourly
          </p>
        </Panel>

        <Panel title="ai advisor">
          <div className="set-kv">
            <div>
              <span>model</span>
              <select
                className="set-input"
                value={settings.aiModel}
                onChange={(e) => updateSettings({ aiModel: e.target.value })}
              >
                {ADVISOR_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="set-note">
            the advisor (in the sidebar) answers questions about your usage using
            this model. it reuses your Claude Code login and sends only computed
            aggregates — never transcripts, prompts, or code. note: Anthropic's
            terms scope that login to Claude Code itself, so the API may decline.
          </p>
        </Panel>

        <ExportPanel />

        <Panel title="data">
          {sourceDirs?.length > 1 ? (
            <div className="set-radios">
              {sourceDirs.map((d) => {
                const acct = accounts?.[d];
                const detail = [
                  tildify(d),
                  acct?.plan ? `${acct.plan}${acct.tier ? ` ${acct.tier}` : ''}` : null,
                  acct?.email,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Toggle
                    key={d}
                    checked={activeSources.has(d)}
                    onChange={(v) => toggleSource(d, v)}
                    label={sourceLabel(d)}
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
              open
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
          <p className="set-note">
            ~/.config/ccmon/config.json holds power-user overrides — extra source
            dirs and pricing patches.
          </p>
        </Panel>

        <Panel title="about">
          <div className="set-about">
            <span className="set-about-name">ccmon</span>
            <span className="set-about-ver">v{version || '?'}</span>
          </div>
          <p className="set-note">
            local-only · reads ~/.claude transcripts · api-equivalent cost
            estimates
          </p>
        </Panel>
      </div>
    </div>
  );
}
