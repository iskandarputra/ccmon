/**
 * @file AccountsView.tsx
 * @brief Redesigned from the ground up: Multi-CLI Profile Hub & Fleet Resource Center.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import './accounts.css';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SetupWizard } from '../components/accounts/SetupWizard';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { DeepseekCard } from '../components/deepseek/DeepseekCard';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import { useScopedDirs } from '../hooks/useScopedDirs';
import { refreshAccounts, updateSettings } from '../bootstrap';
import { countdown, fmtPct, fmtTok, fmtUSD, relTime, sourceLabel, tildify } from '../lib/format';
import { limitColor, windowLabel } from '../lib/limits';
import { planBadgeColor, planLabel } from '../lib/plans';
import {
  accountRoot,
  crossAccountAdvice,
  crossResumeCommand,
  effectiveWrapperAccounts,
  isDefaultAccountRoot,
  suggestWrapperName,
} from '../lib/crossAccount';
import { usesDeepseek } from '../../shared/providers';
import { accountGroups, type ToolProfile } from '../../shared/tools';
import type {
  AccountInfo,
  AccountSpend,
  AccountWrapperPrefs,
  LimitsMarker,
  LimitsResult,
  LiveSession,
  LimitWindow,
  RecentSession,
} from '../../shared/types';

/** Accent colors per profile card */
const ACCENTS = ['var(--blue)', 'var(--sage)', 'var(--rose)', 'var(--chart-4)', 'var(--chart-2)'];
const accentFor = (i: number) => ACCENTS[i % ACCENTS.length];

/** One-letter monogram from label */
const monogram = (label: string) =>
  (label.split(/[-_]/).pop() || label).charAt(0).toUpperCase() || '•';

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

/** Copy text to clipboard */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="acc-btn-subtle"
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? 'copied ✓' : label}
    </button>
  );
}

/** Modern rate limit meter */
function MeterCard({ label, win, now }: { label: string; win?: LimitWindow | null; now?: number }) {
  if (!win || (win.pct == null && !win.resetsAt)) return null;
  const pct = win.pct;
  const color = limitColor(pct);
  const left = win.resetsAt && now ? win.resetsAt - now : 0;
  const resets = left > 0 ? `Resets in ${countdown(left)}` : null;

  return (
    <div className="acc-meter-card">
      <div className="acc-meter-head">
        <span className="acc-meter-lbl">{label}</span>
        <b className="acc-meter-pct" style={{ color }}>
          {pct == null ? '—' : fmtPct(pct)}
        </b>
      </div>
      <div className="acc-meter-track">
        <i style={cssVars({ width: `${Math.min(100, Math.max(pct ?? 0, 2))}%`, '--mc': color })} />
      </div>
      {resets && <span className="acc-meter-reset">{resets}</span>}
    </div>
  );
}

interface AccountCardProps {
  dir: string;
  tool: ToolProfile;
  acct: AccountInfo | undefined;
  limit: LimitsResult | undefined;
  recorded: LimitsMarker | undefined;
  running: LiveSession[];
  spend: AccountSpend | undefined;
  inScope: boolean;
  canScope: boolean;
  accent: string;
  now: number;
}

/** Executive Profile Card */
function AccountCard({
  dir,
  tool,
  acct,
  limit,
  recorded,
  running,
  spend,
  inScope,
  canScope,
  accent,
  now,
}: AccountCardProps) {
  const label = sourceLabel(dir);
  const loggedIn = acct?.hasCredentials ?? false;
  const root = accountRoot(dir);
  const isDefault = isDefaultAccountRoot(root);
  const currentSuffix =
    root
      .split(/[\\/]/)
      .pop()
      ?.replace(new RegExp(`^\\.${tool.id}-?`), '') ?? '';

  const allSourceDirs = useUsageStore((s) => s.allSourceDirs);
  const visibleCount = useUsageStore((s) => s.sourceDirs.length);
  const prefs = useUsageStore((s) => s.settings?.accountWrapperPrefs) ?? {};
  const wrapperName = prefs[root]?.name || suggestWrapperName(root);

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [wrapperBusy, setWrapperBusy] = useState(false);
  const [wrapperErr, setWrapperErr] = useState<string | null>(null);

  async function pushWrapperPrefs(nextPrefs: Record<string, AccountWrapperPrefs>) {
    setWrapperBusy(true);
    try {
      updateSettings({ accountWrapperPrefs: nextPrefs });
      const res = await window.ccmon?.updateWrapperAccounts(
        effectiveWrapperAccounts(allSourceDirs, nextPrefs),
      );
      if (res && !res.ok) setWrapperErr(res.errors.join(' · '));
    } finally {
      setWrapperBusy(false);
    }
  }

  function hideAccount() {
    updateSettings({ accountWrapperPrefs: { ...prefs, [root]: { ...prefs[root], hidden: true } } });
    setHideOpen(false);
  }

  async function confirmRemove() {
    setWrapperErr(null);
    await pushWrapperPrefs({ ...prefs, [root]: { ...prefs[root], disabled: true } });
    setConfirmOpen(false);
  }

  // Rename state
  const [renameSuffix, setRenameSuffix] = useState(isDefault ? wrapperName : currentSuffix);
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  function openRenameForm() {
    setRenameSuffix(isDefault ? wrapperName : currentSuffix);
    setRenameErr(null);
    setRenameConfirmOpen(true);
  }

  async function confirmRename() {
    const clean = renameSuffix.trim();
    if (!clean) return;
    setRenameBusy(true);
    setRenameErr(null);
    try {
      if (isDefault) {
        const nextPrefs = { ...prefs, [root]: { ...prefs[root], name: clean } };
        updateSettings({ accountWrapperPrefs: nextPrefs });
        await window.ccmon?.updateWrapperAccounts(
          effectiveWrapperAccounts(useUsageStore.getState().sourceDirs, nextPrefs),
        );
        setRenameConfirmOpen(false);
        return;
      }
      const res = await window.ccmon?.renameAccount(root, clean);
      if (!res?.ok) {
        setRenameErr(res?.error || 'rename failed');
        return;
      }
      const newRoot = res.root;
      await refreshAccounts();
      const nextPrefs = { ...prefs };
      const carried = prefs[root];
      delete nextPrefs[root];
      nextPrefs[newRoot] = { ...carried, name: `claude-${clean}` };
      updateSettings({ accountWrapperPrefs: nextPrefs });
      await window.ccmon?.updateWrapperAccounts(
        effectiveWrapperAccounts(useUsageStore.getState().sourceDirs, nextPrefs),
      );
      setRenameConfirmOpen(false);
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <div className={`acc-card ${inScope ? 'is-scoped' : ''}`}>
      {/* Card Header */}
      <div className="acc-card-head">
        <div className="acc-identity">
          <div
            className="acc-avatar"
            style={{
              background: `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 40%, var(--bg1)) 100%)`,
            }}
          >
            {monogram(label)}
          </div>
          <div className="acc-title-group">
            <div className="acc-name-row">
              <span className="acc-name">{label}</span>
              <span className="acc-tool-badge">{tool.label}</span>
              {acct?.plan && (
                <span
                  className="acc-plan-badge"
                  style={cssVars({
                    '--pc': planBadgeColor(acct.plan, acct.tier) ?? 'var(--amber)',
                  })}
                >
                  {planLabel(acct.plan, acct.tier, tool.id)}
                </span>
              )}
              {running.length > 0 && (
                <button
                  type="button"
                  className={`acc-running-pill ${sessionsOpen ? 'is-open' : ''}`}
                  onClick={() => setSessionsOpen((v) => !v)}
                  title="Toggle active sessions running in terminal"
                >
                  <i className="acc-running-dot" />
                  <span>{running.length} running</span>
                </button>
              )}
            </div>
            <div className="acc-path-row">
              {acct?.email && <span className="acc-email">{acct.email} · </span>}
              <span>{tildify(root)}</span>
            </div>
          </div>
        </div>

        <div className="acc-scope-actions">
          {canScope &&
            (inScope ? (
              <span className="acc-scope-tag">in view</span>
            ) : (
              <button
                type="button"
                className="acc-scope-btn"
                onClick={() => updateSettings({ sources: [dir] })}
                title="Switch active dashboard scope to this account"
              >
                view
              </button>
            ))}
        </div>
      </div>

      {/* Live Running Sessions Drawer */}
      {sessionsOpen && running.length > 0 && (
        <div className="acc-running-drawer">
          {running.map((r) => (
            <div className="acc-running-item" key={r.id}>
              <i className="acc-running-dot" />
              <code className="acc-running-id" title={`Session ID: ${r.id}`}>
                {r.id.slice(0, 8)}
              </code>
              <span className="acc-running-name">{r.label ?? 'Session'}</span>
              {r.cwd && <code className="acc-running-cwd">{tildify(r.cwd)}</code>}
              {r.startedAt && (
                <span className="acc-running-time">started {relTime(r.startedAt, now)}</span>
              )}
              <CopyButton text={r.id} label="copy id" />
            </div>
          ))}
        </div>
      )}

      {/* Rate Limits Section */}
      <div className="acc-limits-sec">
        {recorded ? (
          <div className="acc-limits-grid">
            {(
              [
                ['primary', recorded.primary],
                ['secondary', recorded.secondary],
              ] as const
            )
              .filter(([, w]) => w)
              .map(([slot, w]) => (
                <MeterCard
                  key={slot}
                  label={windowLabel(w!.windowMinutes)}
                  win={{ pct: w!.usedPercent, resetsAt: w!.resetsAt }}
                  now={now}
                />
              ))}
          </div>
        ) : loggedIn && limit?.ok ? (
          <div className="acc-limits-grid">
            <MeterCard label="Session (5h)" win={limit.session} now={now} />
            <MeterCard label="Week (All)" win={limit.week} now={now} />
            <MeterCard label="Week (Opus)" win={limit.weekOpus} now={now} />
            <MeterCard label="Week (Sonnet)" win={limit.weekSonnet} now={now} />
          </div>
        ) : (
          <div className="acc-meter-card" style={{ textAlign: 'center', padding: '14px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
              {tool.id !== 'claude'
                ? 'Telemetry recorded per turn in logs'
                : !loggedIn
                  ? 'No credentials stored for this login'
                  : limit && !limit.ok
                    ? limit.error
                    : 'Rate limits polling standby'}
            </span>
            {tool.id === 'claude' && (!loggedIn || (limit && !limit.ok)) && (
              <div style={{ marginTop: '8px' }}>
                <LoginPrompt dir={dir} label={loggedIn ? 'Log In' : 'Sign In'} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spend & Telemetry Strip */}
      {spend && spend.entries > 0 ? (
        <div className="acc-stats-strip">
          <div className="acc-stat-box">
            <span className="acc-stat-lbl">Today's Spend</span>
            <span className="acc-stat-val">{fmtUSD(spend.today)}</span>
            <span className="acc-stat-sub">Recent burn</span>
          </div>
          <div className="acc-stat-box">
            <span className="acc-stat-lbl">30-Day Total</span>
            <span className="acc-stat-val">{fmtUSD(spend.month)}</span>
            <span className="acc-stat-sub">{fmtUSD(spend.week)} last 7d</span>
          </div>
          <div className="acc-stat-box">
            <span className="acc-stat-lbl">Token Volume</span>
            <span className="acc-stat-val">{fmtTok(spend.tokens)}</span>
            <span className="acc-stat-sub">{spend.sessions} sessions</span>
          </div>
        </div>
      ) : null}

      {/* CLI Command Launcher Bar */}
      <div className="acc-launcher-bar">
        <div className="acc-cmd-pill">
          <span className="acc-cmd-prompt">$</span>
          <code className="acc-cmd-text">{wrapperName}</code>
          <CopyButton text={wrapperName} label="copy" />
        </div>

        <div className="acc-card-actions">
          <button
            type="button"
            className="acc-btn-subtle"
            onClick={openRenameForm}
            title="Rename alias or folder suffix"
          >
            Rename
          </button>
          <button
            type="button"
            className="acc-btn-subtle"
            onClick={() => setConfirmOpen(true)}
            disabled={wrapperBusy}
            title="Remove wrapper command from shell"
          >
            Unlink
          </button>
          <button
            type="button"
            className="acc-btn-subtle"
            onClick={() => setHideOpen(true)}
            disabled={visibleCount < 2}
            title="Hide from dashboard (nothing deleted)"
          >
            Hide
          </button>
        </div>
      </div>

      {wrapperErr && (
        <div style={{ color: 'var(--rose)', fontSize: '11px', marginTop: '4px' }}>{wrapperErr}</div>
      )}

      {/* 1. Unlink Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={`Remove ${wrapperName} from shell?`}
        body={
          <>
            This removes the <code>{wrapperName}</code> launcher from your shell. Transcripts at{' '}
            <code>{tildify(root)}</code> remain untouched.
          </>
        }
        confirmLabel="Remove"
        danger
        busy={wrapperBusy}
        onConfirm={confirmRemove}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* 2. Hide Confirmation Dialog */}
      <ConfirmDialog
        open={hideOpen}
        title={`Hide ${label} profile?`}
        body={
          <>
            This profile will be hidden from the active dashboard. You can restore it anytime from
            the toolbar above.
          </>
        }
        confirmLabel="Hide"
        busy={wrapperBusy}
        onConfirm={hideAccount}
        onCancel={() => setHideOpen(false)}
      />

      {/* 3. Rename Interactive Confirmation Dialog */}
      <ConfirmDialog
        open={renameConfirmOpen}
        title={isDefault ? 'Rename Default CLI Wrapper' : 'Rename Account & Shell Wrapper'}
        body={
          <div>
            <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-dim)' }}>
              {isDefault
                ? `Enter a custom alias name for ${wrapperName}:`
                : `Enter a new suffix for ~/.${tool.id}-<suffix> and ${tool.id}-<suffix>:`}
            </p>
            <input
              type="text"
              className="acc-dialog-input"
              value={renameSuffix}
              autoFocus
              spellCheck={false}
              onChange={(e) => setRenameSuffix(e.target.value)}
              placeholder={isDefault ? 'e.g. claude' : 'e.g. work, personal'}
            />
            {renameErr && (
              <div style={{ color: 'var(--rose)', marginTop: 8, fontSize: '12px' }}>
                {renameErr}
              </div>
            )}
          </div>
        }
        confirmLabel="Confirm Rename"
        busy={renameBusy}
        onConfirm={confirmRename}
        onCancel={() => {
          setRenameConfirmOpen(false);
          setRenameErr(null);
        }}
      />
    </div>
  );
}

/** Cross-Account Pacing / Resume Banner */
function HeadroomBanner() {
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const [session, setSession] = useState<RecentSession | null>(null);

  const top = crossAccountAdvice(accounts, limits)[0] ?? null;
  const fromDir = top?.fromDir;

  useEffect(() => {
    setSession(null);
    if (!fromDir) return;
    let alive = true;
    void window.ccmon?.listRecentSessions(fromDir, 1).then((rows) => {
      if (alive) setSession(rows[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [fromDir]);

  if (!top) return null;

  return (
    <Panel className="acc-headroom" title="Cross-Account Rate Limit Pacing &amp; Session Resume">
      <div className="hr-flow">
        <div className="hr-side">
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            {sourceLabel(top.fromDir)}
          </span>
          <span style={{ fontSize: '11px', color: top.urgent ? 'var(--rose)' : 'var(--text-dim)' }}>
            {Math.round(top.fromPct)}% utilized
          </span>
        </div>

        <div style={{ color: 'var(--text-faint)', fontSize: '18px' }}>→</div>

        <ul className="hr-targets">
          {top.targets.map((t) => {
            const cmd = crossResumeCommand(top.fromDir, t.dir, session?.id);
            return (
              <li className="hr-target" key={t.dir}>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 100 }}
                >
                  <b style={{ fontSize: '13px', color: 'var(--text)' }}>{sourceLabel(t.dir)}</b>
                  <span style={{ fontSize: '11px', color: 'var(--ok)' }}>
                    {Math.round(t.pct)}% used · {t.hasRoom ? 'Room available' : 'Standby'}
                  </span>
                </div>
                <div className="acc-cmd-pill" style={{ flex: 1 }}>
                  <span className="acc-cmd-prompt">$</span>
                  <code className="acc-cmd-text">{cmd}</code>
                  <CopyButton text={cmd} label="copy" />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Hint label="How cross-account resume works">
        ccmon inspects headroom across all logins. The command above migrates your active session
        into the idle account&apos;s directory and resumes billing there seamlessly.
      </Hint>
    </Panel>
  );
}

/** Ground-Up Redesigned AccountsView */
export function AccountsView() {
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const toolLimits = useUsageStore((s) => s.toolLimits);
  const liveSessions = useUsageStore((s) => s.liveSessions);
  const spend = useUsageStore((s) => s.snapshot?.accountSpend);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const allSourceDirs = useUsageStore((s) => s.allSourceDirs);
  const prefs = useUsageStore((s) => s.settings?.accountWrapperPrefs) ?? {};
  const models = useUsageStore((s) => s.snapshot?.models);
  const deepseekAuth = useUsageStore((s) => s.deepseekAuth);
  const deepseek = useUsageStore((s) => s.deepseek);
  const scoped = useScopedDirs();
  const now = useNow(30000);

  const groups = accountGroups(sourceDirs);
  const hiddenGroups = accountGroups(allSourceDirs.filter((d) => !sourceDirs.includes(d)));
  const unhide = (root: string) => {
    updateSettings({
      accountWrapperPrefs: { ...prefs, [root]: { ...prefs[root], hidden: false } },
    });
  };

  const top = crossAccountAdvice(accounts, limits)[0] ?? null;
  const [showHeadroom, setShowHeadroom] = useState(false);
  const [showWizard, setShowWizard] = useState(groups.length === 0);

  const showDeepseek =
    !!deepseekAuth?.connected || usesDeepseek((models ?? []).map((m) => m.model));
  const scopedSet = new Set(scoped);
  const canScope = groups.length > 1;
  const allInView = canScope && scoped.length === sourceDirs.length;

  // Fleet summary KPIs
  const fleetSummary = useMemo(() => {
    let total30d = 0;
    let totalTokens = 0;
    for (const d of sourceDirs) {
      if (spend?.[d]) {
        total30d += spend[d].month || 0;
        totalTokens += spend[d].tokens || 0;
      }
    }
    return { total30d, totalTokens };
  }, [sourceDirs, spend]);

  return (
    <div className="grid">
      {/* 1. Fleet Hero Summary Cards */}
      <div className="g12">
        <div className="acc-fleet-grid">
          <div className="acc-fleet-card">
            <span className="acc-fleet-lbl">Fleet Spend (30d)</span>
            <span className="acc-fleet-val">{fmtUSD(fleetSummary.total30d)}</span>
            <span className="acc-fleet-sub">{fmtTok(fleetSummary.totalTokens)} total tokens</span>
          </div>

          <div className="acc-fleet-card">
            <span className="acc-fleet-lbl">Active Profiles</span>
            <span className="acc-fleet-val">{groups.length} Profiles</span>
            <span className="acc-fleet-sub">
              {groups.filter((g) => g.dirs.some((d) => scopedSet.has(d))).length} in active scope
            </span>
          </div>

          <div className="acc-fleet-card">
            <span className="acc-fleet-lbl">Fleet Rate Headroom</span>
            <span
              className="acc-fleet-val"
              style={{ color: top?.urgent ? 'var(--rose)' : 'var(--ok)' }}
            >
              {top?.urgent ? 'Cap Warning' : 'Healthy Headroom'}
            </span>
            <span className="acc-fleet-sub">
              {top ? `${Math.round(top.fromPct)}% max utilization` : 'All rate limits balanced'}
            </span>
          </div>

          <div className="acc-fleet-card">
            <span className="acc-fleet-lbl">Prepaid DeepSeek</span>
            <span className="acc-fleet-val">
              {deepseek?.ok ? fmtUSD(deepseek.primary.total) : 'Standby'}
            </span>
            <span className="acc-fleet-sub">
              {deepseekAuth?.connected ? 'API Key Linked' : 'Prepaid fallback key'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Command Toolbar */}
      <div className="g12 acc-toolbar">
        <div className="acc-toolbar-left">
          <span className="acc-toolbar-label">
            <b>{groups.length}</b> Connected Accounts
          </span>

          {top && (
            <button
              type="button"
              className={`acc-tool-btn ${showHeadroom ? 'is-active' : ''} ${top.urgent ? 'is-urgent' : ''}`}
              onClick={() => setShowHeadroom((v) => !v)}
              title="Switch active sessions to an account with more rate headroom"
            >
              <span>
                {top.urgent ? '⚡ Urgent Cross-Resume Available' : '⚡ Cross-Account Switcher'}
              </span>
            </button>
          )}

          <button
            type="button"
            className={`acc-tool-btn ${showWizard ? 'is-active' : ''}`}
            onClick={() => setShowWizard((v) => !v)}
            title="Configure shell wrappers, custom endpoints (DeepSeek, etc.), and new accounts"
          >
            <span>{showWizard ? '✕ Close Shell Setup' : '⚙ Shell Wrappers & Setup'}</span>
          </button>
        </div>

        {canScope && (
          <button
            type="button"
            className={`acc-viewall ${allInView ? 'is-active' : ''}`}
            onClick={() => updateSettings({ sources: sourceDirs })}
            disabled={allInView}
          >
            View All Together
          </button>
        )}
      </div>

      {/* 3. Collapsible Headroom & Pacing Drawer */}
      {(showHeadroom || top?.urgent) && (
        <div className="g12">
          <HeadroomBanner />
        </div>
      )}

      {/* 4. Collapsible Setup Wizard Drawer */}
      {showWizard && (
        <div className="g12">
          <SetupWizard />
        </div>
      )}

      {/* 5. Hidden Profiles Notice */}
      {hiddenGroups.length > 0 && (
        <div className="g12 acc-hidden-bar">
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
            {hiddenGroups.length} hidden {hiddenGroups.length === 1 ? 'profile' : 'profiles'}
          </span>
          {hiddenGroups.map((g) => (
            <button
              key={g.root}
              type="button"
              className="acc-btn-subtle"
              onClick={() => unhide(g.root)}
            >
              Unhide {sourceLabel(g.dirs[0])}
            </button>
          ))}
        </div>
      )}

      {/* 6. Primary Profile Cards Grid */}
      <div className="g12">
        <div className="acc-grid">
          {groups.map((group, i) => (
            <AccountCard
              key={group.root}
              dir={group.dirs[0]}
              tool={group.tool}
              acct={accounts[group.dirs[0]]}
              limit={limits[group.dirs[0]]}
              recorded={group.dirs.map((d) => toolLimits[d]).find(Boolean)}
              running={group.dirs.flatMap((d) => liveSessions[d] ?? [])}
              spend={spend?.[group.dirs[0]]}
              inScope={group.dirs.some((d) => scopedSet.has(d))}
              canScope={canScope}
              accent={accentFor(i)}
              now={now}
            />
          ))}

          {showDeepseek && <DeepseekCard />}
        </div>
      </div>
    </div>
  );
}
