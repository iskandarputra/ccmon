/**
 * @file AccountsView.tsx
 * @brief Per-account dashboard — identity, live limits, and cross-account headroom for every Claude Code login.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './accounts.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { SetupWizard } from '../components/accounts/SetupWizard';
import { LoginPrompt } from '../components/auth/LoginPrompt';
import { useUsageStore } from '../store/useUsageStore';
import { useNow } from '../hooks/useNow';
import { useScopedDirs } from '../hooks/useScopedDirs';
import { updateSettings } from '../bootstrap';
import { fmtPct, fmtTok, fmtUSD, relTime, sourceLabel, tildify } from '../lib/format';
import { limitColor } from '../lib/limits';
import { planPriceUSD } from '../lib/plans';
import { accountRoot, crossAccountAdvice, crossResumeCommand } from '../lib/crossAccount';
import type { AccountInfo, AccountSpend, LimitsResult, LimitWindow, RecentSession } from '../../shared/types';

/** Per-account accent tokens (kept off --amber, which marks the active scope). */
const ACCENTS = ['var(--blue)', 'var(--sage)', 'var(--rose)', 'var(--chart-4)', 'var(--chart-2)'];
const accentFor = (i: number) => ACCENTS[i % ACCENTS.length];

/** A one-letter monogram from an account label ('claude-work' → 'W'). */
const monogram = (label: string) =>
  (label.split(/[-_]/).pop() || label).charAt(0).toUpperCase() || '•';

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

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
  dir: string;
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
function AccountCard({ dir, acct, limit, spend, inScope, canScope, accent, now }: AccountCardProps) {
  const label = sourceLabel(dir);
  const price = planPriceUSD(acct?.plan ?? null, acct?.tier ?? null);
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
          {acct?.plan && (
            <span className="acc-plan">
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
        <span className="acc-root">{tildify(accountRoot(dir))}</span>
      </div>

      {loggedIn && limit?.ok ? (
        <div className="acc-meters">
          <WindowMeter label="session · 5h" win={limit.session} />
          <WindowMeter label="week · all" win={limit.week} />
          <WindowMeter label="week · opus" win={limit.weekOpus} />
          <WindowMeter label="week · sonnet" win={limit.weekSonnet} />
        </div>
      ) : (
        <div className="acc-nolimit">
          <span className="acc-nolimit-msg">
            {!loggedIn
              ? 'no stored login on this account'
              : limit && !limit.ok
                ? limit.error
                : 'no live limits yet'}
          </span>
          {(!loggedIn || (limit && !limit.ok)) && (
            <LoginPrompt dir={dir} label={loggedIn ? 'log in' : 'sign in'} />
          )}
        </div>
      )}

      {spend && spend.entries > 0 && (
        <div className="acc-spend" title="resolved from your local transcripts for this account">
          <div className="acc-spend-head">
            <span className="acc-spend-total">{fmtUSD(spend.cost)}</span>
            <span className="acc-spend-label">lifetime spend</span>
          </div>
          <div className="acc-spend-grid">
            <span className="acc-spend-cell">
              <b>{fmtUSD(spend.month)}</b>
              30d
            </span>
            <span className="acc-spend-cell">
              <b>{fmtUSD(spend.week)}</b>
              7d
            </span>
            <span className="acc-spend-cell">
              <b>{fmtUSD(spend.today)}</b>
              today
            </span>
            <span className="acc-spend-cell">
              <b>{fmtTok(spend.tokens)}</b>
              tokens
            </span>
            <span className="acc-spend-cell">
              <b>{spend.sessions}</b>
              sessions
            </span>
          </div>
          {spend.firstTs && (
            <div className="acc-spend-since">since {relTime(spend.firstTs, now)}</div>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="acc-recent">
          <div className="acc-recent-title">recent activity</div>
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
          <span className="acc-price acc-dim">seat-priced plan</span>
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
      className="acc-headroom"
      title={
        <span className="hr-title">
          cross-account headroom
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
          <div className="hr-side-tag hr-cap">{top.kind} · capping</div>
        </div>
        <div className="hr-arrow" aria-hidden>
          →
        </div>
        <ul className="hr-targets">
          {top.targets.map((t, i) => {
            const cmd = crossResumeCommand(top.fromDir, t.dir, session?.id);
            return (
              <li className="hr-target" key={t.dir}>
                {multi && <span className="hr-rank">{i + 1}</span>}
                <Ring pct={t.pct} />
                <div className="hr-target-body">
                  <div className="hr-target-head">
                    <span className="hr-side-name">{sourceLabel(t.dir)}</span>
                    <span className="hr-side-tag hr-room">
                      {i === 0 && multi ? 'most room' : 'has room'}
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
        ccmon polls every account's real limits, so it can see one login nearing
        a cap while another sits idle. The command copies the chosen session
        into the other account's config dir and relaunches{' '}
        <code>claude --resume</code> there — your billing switches to that
        account from then on. It needs the <code>claude-cross-resume</code>{' '}
        helper on your PATH (install it from the setup panel below). ccmon never
        moves or launches a session itself.
      </Hint>
    </Panel>
  );
}

export function AccountsView() {
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const spend = useUsageStore((s) => s.snapshot?.accountSpend);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const scoped = useScopedDirs();
  const now = useNow(30000);

  const scopedSet = new Set(scoped);
  const canScope = sourceDirs.length > 1;
  const allInView = canScope && scoped.length === sourceDirs.length;

  return (
    <div className="grid">
      <div className="g12">
        <HeadroomBanner />
      </div>

      {canScope && (
        <div className="g12 acc-toolbar">
          <span className="acc-toolbar-label">
            {sourceDirs.length} accounts · {scoped.length} in view
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

      {sourceDirs.map((dir, i) => (
        <div className="g6" key={dir}>
          <AccountCard
            dir={dir}
            acct={accounts[dir]}
            limit={limits[dir]}
            spend={spend?.[dir]}
            inScope={scopedSet.has(dir)}
            canScope={canScope}
            accent={accentFor(i)}
            now={now}
          />
        </div>
      ))}

      <div className="g12">
        <SetupWizard />
      </div>
    </div>
  );
}
