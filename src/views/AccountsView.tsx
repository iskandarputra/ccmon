/**
 * @file AccountsView.tsx
 * @brief Per-account dashboard — identity, live limits, and cross-account headroom for every coding-CLI login.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './accounts.css';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import { fmtPct, fmtTok, fmtUSD, relTime, sourceLabel, tildify } from '../lib/format';
import { limitColor } from '../lib/limits';
import { noPriceReason, planBadgeColor, planPriceUSD } from '../lib/plans';
import {
  accountRoot,
  crossAccountAdvice,
  crossResumeCommand,
  effectiveWrapperAccounts,
  isDefaultAccountRoot,
  suggestWrapperName,
  WRAPPER_NAME_RE,
} from '../lib/crossAccount';
import { usesDeepseek } from '../../shared/providers';
import { accountGroups, type ToolProfile } from '../../shared/tools';
import type {
  AccountInfo,
  AccountSpend,
  AccountWrapperPrefs,
  LimitsResult,
  LimitWindow,
  RecentSession,
} from '../../shared/types';

/** Per-account accent tokens (kept off --amber, which marks the active scope). */
const ACCENTS = ['var(--blue)', 'var(--sage)', 'var(--rose)', 'var(--chart-4)', 'var(--chart-2)'];
const accentFor = (i: number) => ACCENTS[i % ACCENTS.length];

/** A one-letter monogram from an account label ('claude-work' → 'W'). */
const monogram = (label: string) =>
  (label.split(/[-_]/).pop() || label).charAt(0).toUpperCase() || '•';

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

/** small inline SVG wrapper so all glyphs share stroke styling (see Advisor). */
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

/** stroke icons for the spend tiles, keyed by tile. */
const ICONS = {
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M8 2.5v4M16 2.5v4" />
    </>
  ),
  week: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </>
  ),
  tokens: (
    <>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
      <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  sessions: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    </>
  ),
  chat: (
    <>
      <path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5v-13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </>
  ),
} as const;

/** Copy text to the clipboard, swallowing the (rare) failure. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A small clipboard button that flips to "copied" for a beat. */
function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="acc-copy"
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

/** A donut gauge for a utilization percentage, coloured by severity. */
function Ring({ pct }: { pct: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="acc-ring" style={cssVars({ '--ring': limitColor(p) })}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <circle className="acc-ring-track" cx="32" cy="32" r={R} />
        <circle
          className="acc-ring-arc"
          cx="32"
          cy="32"
          r={R}
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - p / 100) }}
        />
      </svg>
      <span className="acc-ring-num">
        {Math.round(p)}
        <i>%</i>
      </span>
    </div>
  );
}

/** One live-limit window as a labelled meter. */
function WindowMeter({ label, win }: { label: string; win?: LimitWindow | null }) {
  if (!win || (win.pct == null && !win.resetsAt)) return null;
  const pct = win.pct;
  const color = limitColor(pct);
  return (
    <div className="acc-meter">
      <div className="acc-meter-head">
        <span className="acc-meter-label">{label}</span>
        <b className="acc-meter-pct" style={{ color }}>
          {pct == null ? '—' : fmtPct(pct)}
        </b>
      </div>
      <div className="acc-meter-track">
        <i style={cssVars({ width: `${Math.min(100, Math.max(pct ?? 0, 2))}%`, '--mc': color })} />
      </div>
    </div>
  );
}

interface AccountCardProps {
  /**
   * The account's PRIMARY source dir — what `accounts`, `limits` and `spend`
   * are keyed by. A Codex home has two (sessions, archived_sessions); the card
   * carries the first and the group supplies the rest.
   */
  dir: string;
  tool: ToolProfile;
  acct: AccountInfo | undefined;
  limit: LimitsResult | undefined;
  spend: AccountSpend | undefined;
  inScope: boolean;
  canScope: boolean;
  accent: string;
  now: number;
}

const avatarStyle = (label: string, accent: string) => {
  const hash = label.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const angles = [135, 45, 90, 180, 225];
  const angle = angles[hash % angles.length];
  return {
    background: `linear-gradient(${angle}deg, ${accent} 0%, color-mix(in srgb, ${accent} 30%, var(--bg1)) 100%)`,
    color: 'var(--text)',
    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
    boxShadow: `0 4px 10px -3px color-mix(in srgb, ${accent} 35%, transparent)`,
  };
};

/** One account: identity, login state, live limit windows, plan price. */
function AccountCard({
  dir,
  tool,
  acct,
  limit,
  spend,
  inScope,
  canScope,
  accent,
  now,
}: AccountCardProps) {
  const label = sourceLabel(dir);
  const price = planPriceUSD(acct?.plan ?? null, acct?.tier ?? null, tool.id);
  const loggedIn = acct?.hasCredentials ?? false;

  const [recent, setRecent] = useState<RecentSession[]>([]);

  useEffect(() => {
    let alive = true;
    if (window.ccmon?.listRecentSessions) {
      void window.ccmon.listRecentSessions(dir, 3).then((rows) => {
        if (alive) setRecent(rows || []);
      });
    }
    return () => {
      alive = false;
    };
  }, [dir]);

  const root = accountRoot(dir);
  const isDefault = isDefaultAccountRoot(root);
  // the rename control edits the suffix after `~/.<tool>-`, so the prefix it
  // strips has to be the account's OWN tool, not a hardcoded `.claude-`
  const currentSuffix =
    root
      .split(/[\\/]/)
      .pop()
      ?.replace(new RegExp(`^\\.${tool.id}-?`), '') ?? '';
  // the wrapper file must list EVERY account, hidden included — hiding is a
  // ccmon view preference and must never quietly rewrite the user's shell
  const allSourceDirs = useUsageStore((s) => s.allSourceDirs);
  const visibleCount = useUsageStore((s) => s.sourceDirs.length);
  const prefs = useUsageStore((s) => s.settings?.accountWrapperPrefs) ?? {};
  const wrapperName = prefs[root]?.name || suggestWrapperName(root);
  const wrapperDisabled = prefs[root]?.disabled ?? false;

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

  /**
   * Hide this account from ccmon. Settings-only — no wrapper rewrite, nothing
   * touched on disk — so this is the "remove" that can always be undone.
   */
  function hideAccount() {
    updateSettings({ accountWrapperPrefs: { ...prefs, [root]: { ...prefs[root], hidden: true } } });
    setHideOpen(false);
  }

  async function confirmRemove() {
    setWrapperErr(null);
    await pushWrapperPrefs({ ...prefs, [root]: { ...prefs[root], disabled: true } });
    setConfirmOpen(false);
  }

  function reAdd() {
    setWrapperErr(null);
    void pushWrapperPrefs({ ...prefs, [root]: { ...prefs[root], disabled: false } });
  }

  // ---- default ~/.claude root: label-only rename (no folder to move) ----
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(wrapperName);

  function saveRename() {
    const trimmed = nameDraft.trim();
    if (trimmed === wrapperName) {
      setEditingName(false);
      return;
    }
    if (!WRAPPER_NAME_RE.test(trimmed)) {
      setWrapperErr('use letters, digits, dash or underscore, starting with a letter');
      return;
    }
    const clash = effectiveWrapperAccounts(allSourceDirs, prefs).some(
      (a) => a.root !== root && a.name === trimmed,
    );
    if (clash) {
      setWrapperErr(`"${trimmed}" is already used by another account`);
      return;
    }
    setEditingName(false);
    setWrapperErr(null);
    void pushWrapperPrefs({ ...prefs, [root]: { ...prefs[root], name: trimmed } });
  }

  // ---- every other account: one combined rename — folder AND shell command
  // always move together (~/.claude-<old> + claude-<old> -> ~/.claude-<new> +
  // claude-<new>) so the two can never drift out of sync ----
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [renameSuffix, setRenameSuffix] = useState(currentSuffix);
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [renameDone, setRenameDone] = useState<string | null>(null);

  function openRenameForm() {
    setRenameSuffix(currentSuffix);
    setRenameErr(null);
    setRenameDone(null);
    setShowRenameForm(true);
  }

  function requestRename() {
    const clean = renameSuffix.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(clean)) {
      setRenameErr('use letters, digits, dash or underscore');
      return;
    }
    setRenameErr(null);
    setRenameConfirmOpen(true);
  }

  async function confirmRename() {
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const suffix = renameSuffix.trim();
      const res = await window.ccmon?.renameAccount(root, suffix);
      if (!res?.ok) {
        setRenameErr(res?.error || 'rename failed');
        return; // keep the dialog open so the error is visible
      }
      const newRoot = res.root;
      await refreshAccounts();
      // force the wrapper name to match the new folder suffix exactly —
      // name and shell command must never diverge
      const nextPrefs = { ...prefs };
      const carried = prefs[root];
      delete nextPrefs[root];
      // the folder moved, but everything else about the account is unchanged —
      // dropping its env here would break an alternate-provider wrapper
      nextPrefs[newRoot] = { ...carried, name: `claude-${suffix}` };
      updateSettings({ accountWrapperPrefs: nextPrefs });
      await window.ccmon?.updateWrapperAccounts(
        effectiveWrapperAccounts(useUsageStore.getState().sourceDirs, nextPrefs),
      );
      setRenameConfirmOpen(false);
      setShowRenameForm(false);
      setRenameDone(
        `renamed to ${tool.id}-${suffix} · ~/.${tool.id}-${suffix} — relaunch ccmon to resume live tracking, and open a new terminal (or re-source your shell) to pick up the new command`,
      );
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <Panel
      className={`acc-card${inScope ? ' is-scoped' : ''}`}
      style={cssVars({ '--acc': accent })}
      title={
        <span className="acc-head">
          <span className="acc-avatar" style={avatarStyle(label, accent)} aria-hidden>
            {monogram(label)}
          </span>
          <span className="acc-name">{label}</span>
          {/* a quiet identifier, not a call to action: it says which CLI the
              row belongs to and must never outweigh the account name */}
          <span className="acc-tool-badge">{tool.label}</span>
          {acct?.plan && (
            <span
              className="acc-plan"
              style={cssVars({ '--pc': planBadgeColor(acct.plan, acct.tier) ?? 'var(--text-dim)' })}
            >
              {acct.plan}
              {acct.tier ? ` · ${acct.tier}` : ''}
            </span>
          )}
          {inScope && <span className="acc-scoped-badge">viewing</span>}
        </span>
      }
      right={
        canScope && (
          <button
            type="button"
            className="acc-scope-btn"
            onClick={() => updateSettings({ sources: [dir] })}
            disabled={inScope}
            title="show this account's usage in the other views"
          >
            {inScope ? 'in view' : 'view usage'}
          </button>
        )
      }
    >
      <div className="acc-id">
        {acct?.email && <span className="acc-email">{acct.email}</span>}
        {acct?.organization && <span className="acc-org">{acct.organization}</span>}
        {/* an API-key Codex login has no identity to show — say which kind of
            credential it is rather than leaving the row bare */}
        {acct?.authMode === 'apikey' && !acct.email && <span className="acc-org">API key</span>}
        <span className="acc-root">{tildify(root)}</span>
      </div>

      <div className="acc-wrapper">
        <span className="acc-wrapper-label">shell:</span>
        {wrapperDisabled ? (
          <>
            <span className="acc-wrapper-name is-disabled">{wrapperName} · not in shell</span>
            <button type="button" className="acc-copy" onClick={reAdd} disabled={wrapperBusy}>
              re-add
            </button>
          </>
        ) : isDefault && editingName ? (
          <input
            className="acc-wrapper-input"
            autoFocus
            value={nameDraft}
            spellCheck={false}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
              if (e.key === 'Escape') {
                setEditingName(false);
                setNameDraft(wrapperName);
                setWrapperErr(null);
              }
            }}
            onBlur={saveRename}
          />
        ) : !isDefault && showRenameForm ? (
          <>
            <span className="wiz-add-pre">claude-</span>
            <input
              className="acc-wrapper-input"
              autoFocus
              value={renameSuffix}
              spellCheck={false}
              onChange={(e) => setRenameSuffix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') requestRename();
                if (e.key === 'Escape') setShowRenameForm(false);
              }}
            />
            <button type="button" className="acc-copy" onClick={requestRename}>
              rename
            </button>
            <button type="button" className="acc-copy" onClick={() => setShowRenameForm(false)}>
              cancel
            </button>
          </>
        ) : (
          <>
            <code className="acc-wrapper-name">{wrapperName}</code>
            <button
              type="button"
              className="acc-copy"
              onClick={() => {
                if (isDefault) {
                  setNameDraft(wrapperName);
                  setEditingName(true);
                } else {
                  openRenameForm();
                }
              }}
            >
              rename
            </button>
            <button
              type="button"
              className="acc-copy"
              onClick={() => setConfirmOpen(true)}
              disabled={wrapperBusy}
            >
              remove from shell
            </button>
            {/* the last visible account can't be hidden — an empty dashboard
                with no obvious way back is worse than a cluttered one */}
            <button
              type="button"
              className="acc-copy"
              onClick={() => setHideOpen(true)}
              disabled={visibleCount < 2}
              title={
                visibleCount < 2
                  ? 'this is the only account in view'
                  : 'hide this account from ccmon (nothing is deleted)'
              }
            >
              hide
            </button>
          </>
        )}
        {wrapperErr && <span className="acc-wrapper-err">{wrapperErr}</span>}
        {!isDefault && renameErr && !renameConfirmOpen && (
          <span className="acc-wrapper-err">{renameErr}</span>
        )}
        {!isDefault && renameDone && <span className="acc-wrapper-note">{renameDone}</span>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Remove ${wrapperName} from your shell?`}
        body={
          <>
            This deletes the <code>{wrapperName}</code> command from{' '}
            <code>~/.config/ccmon/{tool.managedFile.posix}</code>. Your account&apos;s data and
            login at <code>{tildify(root)}</code> are not touched — you can re-add it any time.
          </>
        }
        confirmLabel="remove"
        danger
        busy={wrapperBusy}
        onConfirm={confirmRemove}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={hideOpen}
        title={`Hide ${label} from ccmon?`}
        body={
          <>
            It disappears from this dashboard, the scope picker and the live limits poll, and its
            usage drops out of every total. <b>Nothing is deleted</b> — transcripts, login and the{' '}
            <code>{wrapperName}</code> shell command at <code>{tildify(root)}</code> all stay
            exactly as they are, and you can unhide it from the bar at the top of this view.
            <br />
            <br />
            ccmon has no delete-account: that folder holds every transcript the app reads, so
            removing it would be irreversible. To actually erase it, delete{' '}
            <code>{tildify(root)}</code> yourself.
          </>
        }
        confirmLabel="hide"
        busy={wrapperBusy}
        onConfirm={hideAccount}
        onCancel={() => setHideOpen(false)}
      />

      {!isDefault && (
        <ConfirmDialog
          open={renameConfirmOpen}
          title="Rename this account?"
          body={
            <>
              Renames both together, so they never drift apart: the folder{' '}
              <code>{tildify(root)}</code> →{' '}
              <code>
                ~/.{tool.id}-{renameSuffix.trim()}
              </code>
              , and the shell command <code>{wrapperName}</code> →{' '}
              <code>
                {tool.id}-{renameSuffix.trim()}
              </code>
              . Transcripts and login move with the folder. Any terminal wrapper or tool pointed at
              the old <code>{tool.homeEnvVar}</code> path will need updating, and ccmon needs a
              relaunch to resume live tracking of the new location.
              {renameErr && (
                <div className="acc-wrapper-err" style={{ marginTop: 8 }}>
                  {renameErr}
                </div>
              )}
            </>
          }
          confirmLabel="rename"
          danger
          busy={renameBusy}
          onConfirm={confirmRename}
          onCancel={() => {
            setRenameConfirmOpen(false);
            setRenameErr(null);
          }}
        />
      )}

      {loggedIn && limit?.ok ? (
        <div className="acc-meters">
          <WindowMeter label="session · 5h" win={limit.session} />
          <WindowMeter label="week · all" win={limit.week} />
          <WindowMeter label="week · opus" win={limit.weekOpus} />
          <WindowMeter label="week · sonnet" win={limit.weekSonnet} />
        </div>
      ) : (
        <div className="acc-nolimit">
          <Glyph className="acc-nolimit-icon">
            <path d="M5 11V8a7 7 0 0 1 14 0v3" />
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M12 15v2" />
          </Glyph>
          <span className="acc-nolimit-msg">
            {/* Codex first: it has no limits API at all, so "no stored login"
                and a Log in button would both be wrong — the account IS
                logged in, there is simply nothing to poll. An empty meter
                would read as "at zero", the opposite of "unknown". */}
            {tool.id !== 'claude'
              ? `${tool.label} publishes no usage-limit API — spend below is measured from your local logs`
              : !loggedIn
                ? 'no stored login on this account'
                : limit && !limit.ok
                  ? limit.error
                  : 'no live limits yet'}
          </span>
          {tool.id === 'claude' && (!loggedIn || (limit && !limit.ok)) && (
            <LoginPrompt dir={dir} label={loggedIn ? 'log in' : 'sign in'} />
          )}
        </div>
      )}

      {spend && spend.entries > 0 && (
        <div className="acc-spend" title="resolved from your local transcripts for this account">
          <div className="acc-spend-head">
            <span className="acc-spend-total">{fmtUSD(spend.cost)}</span>
            <span className="acc-spend-label">
              lifetime spend
              {spend.firstTs && (
                <i className="acc-spend-since"> · since {relTime(spend.firstTs, now)}</i>
              )}
            </span>
          </div>
          <div className="acc-spend-grid">
            <span className="acc-spend-cell">
              <span className="acc-spend-cap">
                <Glyph className="acc-spend-icon">{ICONS.calendar}</Glyph>
                30d
              </span>
              <b>{fmtUSD(spend.month)}</b>
            </span>
            <span className="acc-spend-cell">
              <span className="acc-spend-cap">
                <Glyph className="acc-spend-icon">{ICONS.week}</Glyph>
                7d
              </span>
              <b>{fmtUSD(spend.week)}</b>
            </span>
            <span className="acc-spend-cell">
              <span className="acc-spend-cap">
                <Glyph className="acc-spend-icon">{ICONS.today}</Glyph>
                today
              </span>
              <b>{fmtUSD(spend.today)}</b>
            </span>
            <span className="acc-spend-cell">
              <span className="acc-spend-cap">
                <Glyph className="acc-spend-icon">{ICONS.tokens}</Glyph>
                tokens
              </span>
              <b>{fmtTok(spend.tokens)}</b>
            </span>
            <span className="acc-spend-cell">
              <span className="acc-spend-cap">
                <Glyph className="acc-spend-icon">{ICONS.sessions}</Glyph>
                sessions
              </span>
              <b>{spend.sessions}</b>
            </span>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="acc-recent">
          <div className="acc-recent-title">
            <Glyph className="acc-recent-glyph">{ICONS.chat}</Glyph>
            recent activity
          </div>
          <ul className="acc-recent-list">
            {recent.map((s) => (
              <li key={s.id} title={`${s.project} · ${s.cwd ? tildify(s.cwd) : ''}`}>
                <span className="acc-recent-name">{s.project}</span>
                <span className="acc-recent-time">{relTime(s.mtime, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="acc-foot">
        {price != null ? (
          <span className="acc-price">
            {fmtUSD(price)}
            <span className="acc-dim"> /mo plan</span>
          </span>
        ) : (
          <span className="acc-price acc-dim">{noPriceReason(acct?.plan ?? null)}</span>
        )}
        {limit?.ok && (
          <span className="acc-live">
            <i className="acc-live-dot" />
            live · {relTime(limit.fetchedAt, now)}
          </span>
        )}
      </div>
    </Panel>
  );
}

/**
 * The headline: when one account is about to cap and another has room, say so
 * and hand over the canonical cross-resume command (the user's own
 * `claude-cross-resume` wrapper). Prefilled with the capping account's most
 * recent session id so it's ready to run.
 */
function HeadroomBanner() {
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const [session, setSession] = useState<RecentSession | null>(null);

  const top = crossAccountAdvice(accounts, limits)[0] ?? null;
  const fromDir = top?.fromDir;

  // pull the capping account's newest session so the command is runnable as-is
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
  const multi = top.targets.length > 1;

  return (
    <Panel
      className={`acc-headroom${top.urgent ? '' : ' is-calm'}`}
      title={
        <span className="hr-title">
          cross-account resume
          <span className="hr-live">
            <i className="acc-live-dot" />
            live
          </span>
        </span>
      }
    >
      <div className="hr-flow">
        <div className="hr-side">
          <Ring pct={top.fromPct} />
          <div className="hr-side-name">{sourceLabel(top.fromDir)}</div>
          <div className={`hr-side-tag ${top.urgent ? 'hr-cap' : 'hr-cur'}`}>
            {top.urgent ? `${top.kind} · capping` : `${top.kind} · highest`}
          </div>
        </div>
        <div className="hr-arrow" aria-hidden>
          →
        </div>
        <ul className="hr-targets">
          {top.targets.map((t, i) => {
            const cmd = crossResumeCommand(top.fromDir, t.dir, session?.id);
            const roomTag = t.hasRoom ? (i === 0 && multi ? 'most room' : 'has room') : 'available';
            return (
              <li className="hr-target" key={t.dir}>
                {multi && <span className="hr-rank">{i + 1}</span>}
                <Ring pct={t.pct} />
                <div className="hr-target-body">
                  <div className="hr-target-head">
                    <span className="hr-side-name">{sourceLabel(t.dir)}</span>
                    <span className={`hr-side-tag ${t.hasRoom ? 'hr-room' : 'hr-cur'}`}>
                      {roomTag}
                    </span>
                  </div>
                  <div className="hr-cmd">
                    <span className="hr-prompt" aria-hidden>
                      $
                    </span>
                    <code className="hr-cmd-text">{cmd}</code>
                    <CopyButton text={cmd} label="copy" />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="hr-meta">
        {session
          ? `${multi ? 'each command ' : ''}prefilled with the newest ${sourceLabel(top.fromDir)} session${session.cwd ? ` · ${session.project}` : ''}`
          : 'run with the session id you want to continue'}
      </div>

      <Hint label="how this works">
        ccmon polls every account's real limits, so it can see one login nearing a cap while another
        sits idle. The command copies the chosen session into the other account's config dir and
        relaunches <code>claude --resume</code> there — your billing switches to that account from
        then on. It's always available, not just when a cap looms: the highest-usage account is the
        source and every other logged-in account is a target, so you can switch at any utilization
        (targets with genuine headroom are flagged). It needs the <code>claude-cross-resume</code>{' '}
        helper, which the setup panel below installs to <code>~/.local/bin</code> — the command is
        spelled with that path, so it works whether or not the directory is on your PATH (macOS does
        not add it). Windows gets the same thing as a PowerShell script under{' '}
        <code>~/.config/ccmon</code>. ccmon never moves or launches a session itself.
      </Hint>
    </Panel>
  );
}

export function AccountsView() {
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const spend = useUsageStore((s) => s.snapshot?.accountSpend);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const allSourceDirs = useUsageStore((s) => s.allSourceDirs);
  const prefs = useUsageStore((s) => s.settings?.accountWrapperPrefs) ?? {};
  const models = useUsageStore((s) => s.snapshot?.models);
  const deepseekConnected = useUsageStore((s) => !!s.deepseekAuth?.connected);
  const scoped = useScopedDirs();
  const now = useNow(30000);

  // ACCOUNTS, not source dirs — a Codex home feeds two of the latter
  const groups = accountGroups(sourceDirs);
  const hiddenGroups = accountGroups(allSourceDirs.filter((d) => !sourceDirs.includes(d)));
  const unhide = (root: string) => {
    updateSettings({
      accountWrapperPrefs: { ...prefs, [root]: { ...prefs[root], hidden: false } },
    });
  };

  // DeepSeek isn't an account root — it's a key against a prepaid balance —
  // so the card only appears for users it means something to: those already
  // running DeepSeek models, or those who have connected a key.
  const showDeepseek = deepseekConnected || usesDeepseek((models ?? []).map((m) => m.model));

  const scopedSet = new Set(scoped);
  const canScope = groups.length > 1;
  const allInView = canScope && scoped.length === sourceDirs.length;

  return (
    <div className="grid">
      <div className="g12">
        <HeadroomBanner />
      </div>

      {canScope && (
        <div className="g12 acc-toolbar">
          <span className="acc-toolbar-label">
            {groups.length} accounts ·{' '}
            {groups.filter((g) => g.dirs.some((d) => scopedSet.has(d))).length} in view
          </span>
          <button
            type="button"
            className={`acc-viewall${allInView ? ' is-active' : ''}`}
            onClick={() => updateSettings({ sources: sourceDirs })}
            disabled={allInView}
          >
            view all together
          </button>
        </div>
      )}

      {/* the only way back from "hide" — without this the account is gone
          from the UI with no affordance to restore it */}
      {hiddenGroups.length > 0 && (
        <div className="g12 acc-toolbar acc-hidden-bar">
          <span className="acc-toolbar-label">
            {hiddenGroups.length} hidden {hiddenGroups.length === 1 ? 'account' : 'accounts'} ·
            nothing was deleted
          </span>
          {hiddenGroups.map((g) => (
            <button
              key={g.root}
              type="button"
              className="acc-viewall"
              onClick={() => unhide(g.root)}
            >
              unhide {sourceLabel(g.dirs[0])}
            </button>
          ))}
        </div>
      )}

      <div className="g12 acc-section-label">
        <span className="acc-sec-title">
          connected {groups.some((g) => g.tool.id !== 'claude') ? 'coding-cli' : 'claude code'}{' '}
          logins
        </span>
        <span className="acc-sec-rule" />
      </div>

      {/* groups, not source dirs: a Codex home feeds two source dirs but is
          ONE account, and rendering it twice would show a duplicate card */}
      {groups.map((group, i) => (
        <div className={groups.length === 1 ? 'g12' : 'g6'} key={group.root}>
          <AccountCard
            dir={group.dirs[0]}
            tool={group.tool}
            acct={accounts[group.dirs[0]]}
            limit={limits[group.dirs[0]]}
            spend={spend?.[group.dirs[0]]}
            inScope={group.dirs.some((d) => scopedSet.has(d))}
            canScope={canScope}
            accent={accentFor(i)}
            now={now}
          />
        </div>
      ))}

      {showDeepseek && (
        <div className={sourceDirs.length % 2 === 1 ? 'g6' : 'g12'}>
          <DeepseekCard />
        </div>
      )}

      <div className="g12 acc-section-label">
        <span className="acc-sec-title">multi-account setup &amp; shell integration</span>
        <span className="acc-sec-rule" />
      </div>

      <div className="g12">
        <SetupWizard />
      </div>
    </div>
  );
}
