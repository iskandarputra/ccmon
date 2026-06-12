/**
 * @file SetupWizard.tsx
 * @brief Guided multi-account setup — name wrappers, pick the shell, preview the exact diff, then apply.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../ui/Panel';
import { Hint } from '../ui/Hint';
import { useUsageStore } from '../../store/useUsageStore';
import { tildify } from '../../lib/format';
import { accountRoot } from '../../lib/crossAccount';
import type {
  AccountSpec,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellTarget,
} from '../../../shared/types';

/** A nice default wrapper name for a config root (renderer mirror of the service). */
function suggestName(root: string): string {
  const base = root.split('/').filter(Boolean).pop() || root;
  if (base === '.claude') return 'claude-personal';
  const suffix = base.replace(/^\.+/, '').replace(/^claude[-_]?/, '');
  return suffix ? `claude-${suffix}` : 'claude-account';
}

/** Human OS label from process.platform. */
function osLabel(platform: string): string {
  return platform === 'darwin'
    ? 'macOS'
    : platform === 'win32'
      ? 'Windows'
      : platform === 'linux'
        ? 'Linux'
        : platform || '…';
}

/** Refresh the store's account list after the wizard creates a new dir. */
async function refreshAccounts(): Promise<void> {
  const s = await window.ccmon?.getState();
  if (s) useUsageStore.setState({ sourceDirs: s.sourceDirs, accounts: s.accounts, limits: s.limits });
}

export function SetupWizard() {
  const sourceDirs = useUsageStore((s) => s.sourceDirs);

  const [shells, setShells] = useState<ShellTarget[]>([]);
  const [platform, setPlatform] = useState<string>('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [installHelper, setInstallHelper] = useState(true);
  const [tidy, setTidy] = useState(false);
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [busy, setBusy] = useState(false);

  const [newSuffix, setNewSuffix] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);

  // detect OS + shells once; pre-pick the login shell (and anything linked)
  useEffect(() => {
    let alive = true;
    void window.ccmon?.detectShells().then((found) => {
      if (!alive) return;
      setShells(found.shells);
      setPlatform(found.platform);
      setPicked(new Set(found.shells.filter((s) => s.detected || s.linked).map((s) => s.rcPath)));
    });
    return () => {
      alive = false;
    };
  }, []);

  // seed wrapper-name suggestions for every detected account root
  useEffect(() => {
    setNames((prev) => {
      const next = { ...prev };
      for (const dir of sourceDirs) {
        const root = accountRoot(dir);
        if (!next[root]) next[root] = suggestName(root);
      }
      return next;
    });
  }, [sourceDirs]);

  const roots = useMemo(() => sourceDirs.map(accountRoot), [sourceDirs]);

  const opts: SetupOptions = useMemo(
    () => ({
      accounts: roots.map<AccountSpec>((root) => ({ name: names[root] || suggestName(root), root })),
      rcPaths: [...picked],
      installHelper,
      tidyExisting: tidy,
    }),
    [roots, names, picked, installHelper, tidy],
  );

  // any edit invalidates a stale preview so apply can't run against old input
  function invalidate() {
    setPlan(null);
    setReport(null);
  }

  function togglePick(rcPath: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(rcPath)) next.delete(rcPath);
      else next.add(rcPath);
      return next;
    });
    invalidate();
  }

  async function preview() {
    setBusy(true);
    setReport(null);
    try {
      const p = await window.ccmon?.previewSetup(opts);
      setPlan(p ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const r = await window.ccmon?.applySetup(opts);
      setReport(r ?? null);
      setPlan(null);
      const found = await window.ccmon?.detectShells();
      if (found) setShells(found.shells);
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    setCreateErr(null);
    setBusy(true);
    try {
      const res = await window.ccmon?.createAccount(newSuffix);
      if (res?.ok) {
        await refreshAccounts();
        setNewSuffix('');
        invalidate();
      } else {
        setCreateErr(res?.error || 'could not create the account dir');
      }
    } finally {
      setBusy(false);
    }
  }

  const canApply = !!plan && plan.problems.length === 0 && !busy;

  return (
    <Panel
      className="acc-wiz"
      title="multi-account setup"
      right={<span className="panel-note">generate the claude-* wrappers for your shell</span>}
    >
      {/* 1 — accounts + their wrapper names */}
      <div className="wiz-step">
        <div className="wiz-step-label">1 · accounts → wrapper command</div>
        {roots.map((root) => (
          <div className="wiz-acct" key={root}>
            <input
              className="wiz-name"
              value={names[root] ?? ''}
              spellCheck={false}
              onChange={(e) => {
                setNames((p) => ({ ...p, [root]: e.target.value }));
                invalidate();
              }}
            />
            <span className="wiz-arrow">→</span>
            <code className="wiz-root">{tildify(root)}</code>
          </div>
        ))}
        <div className="wiz-add">
          <span className="wiz-add-pre">~/.claude-</span>
          <input
            className="wiz-suffix"
            value={newSuffix}
            placeholder="work"
            spellCheck={false}
            onChange={(e) => setNewSuffix(e.target.value)}
          />
          <button
            type="button"
            className="acc-scope-btn"
            disabled={busy || !newSuffix.trim()}
            onClick={createAccount}
          >
            create account dir
          </button>
          {createErr && <span className="wiz-err">{createErr}</span>}
        </div>
      </div>

      {/* 2 — which shell's startup file to link */}
      <div className="wiz-step">
        <div className="wiz-step-label">
          2 · shell to link {platform && <span className="wiz-os">· {osLabel(platform)} detected</span>}
        </div>
        <div className="wiz-shells">
          {shells.map((s) => (
            <button
              key={s.rcPath}
              type="button"
              className={`wiz-shell${picked.has(s.rcPath) ? ' is-picked' : ''}${s.detected ? ' is-detected' : ''}`}
              onClick={() => togglePick(s.rcPath)}
            >
              <span className="wiz-shell-name">{s.shell}</span>
              <span className="wiz-shell-rc">{tildify(s.rcPath)}</span>
              <span className="wiz-shell-note">{s.note}</span>
            </button>
          ))}
        </div>
        {platform === 'win32' ? (
          <div className="wiz-os-note">
            on Windows ccmon writes a PowerShell <code>function</code> per account and
            dot-sources them from your <code>$PROFILE</code>. The bash{' '}
            <code>claude-cross-resume</code> helper is Unix-only, so cross-account resume from
            the dashboard needs WSL or Git Bash.
          </div>
        ) : (
          <label className="wiz-helper">
            <input
              type="checkbox"
              checked={installHelper}
              onChange={(e) => {
                setInstallHelper(e.target.checked);
                invalidate();
              }}
            />
            install the <code>claude-cross-resume</code> helper to ~/.local/bin
          </label>
        )}
        <label className="wiz-helper">
          <input
            type="checkbox"
            checked={tidy}
            onChange={(e) => {
              setTidy(e.target.checked);
              invalidate();
            }}
          />
          tidy up: comment out any existing hand-written <code>claude-*</code> defs the
          managed file replaces (single-line only · shown in the preview)
        </label>
      </div>

      {/* 3 — preview (always) then apply */}
      <div className="wiz-step">
        <div className="wiz-step-label">3 · review &amp; apply</div>
        <div className="wiz-actions">
          <button type="button" className="acc-scope-btn" onClick={preview} disabled={busy}>
            {busy && !report ? 'working…' : 'preview changes'}
          </button>
          <button type="button" className="wiz-apply" onClick={apply} disabled={!canApply}>
            apply
          </button>
          {plan && plan.problems.length > 0 && (
            <span className="wiz-err">{plan.problems.join(' · ')}</span>
          )}
        </div>

        {plan && (
          <div className="wiz-preview">
            {plan.warnings.map((w, i) => (
              <div className="wiz-warn" key={i}>
                ⚠ {w}
              </div>
            ))}
            <div className="wiz-pre-label">
              {tildify(plan.managedPath)} <span className="wiz-dim">(rewritten)</span>
            </div>
            <pre className="wiz-pre">{plan.managedScript}</pre>
            {plan.rcEdits.map((e) => (
              <div className="wiz-rc" key={e.rcPath}>
                <div className="wiz-pre-label">
                  {tildify(e.rcPath)}{' '}
                  <span className="wiz-dim">
                    {e.alreadyLinked ? '(already linked — no change)' : '(append)'}
                  </span>
                </div>
                {!e.alreadyLinked && <pre className="wiz-pre wiz-pre-sm">{e.blockToAdd}</pre>}
                {e.existing.length > 0 && (
                  <div className="wiz-conflicts">
                    <div className="wiz-conflicts-head">
                      existing hand-written defs in this file:
                    </div>
                    {e.existing.map((x) => (
                      <div className="wiz-conflict" key={x.line}>
                        <span className="wiz-conflict-tag">
                          {tidy
                            ? x.canTidy
                              ? 'comment out'
                              : 'remove by hand'
                            : 'shadowed'}
                        </span>
                        <code className="wiz-conflict-line">
                          L{x.line}: {x.text}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="wiz-pre-label">
              {tildify(plan.helperDest)}{' '}
              <span className="wiz-dim">
                {!installHelper
                  ? '(skipped)'
                  : plan.helperInstalled
                    ? '(already current)'
                    : '(install, chmod +x)'}
              </span>
            </div>
          </div>
        )}

        {report && (
          <div className={`wiz-report${report.ok ? ' is-ok' : ' is-err'}`}>
            <div className="wiz-report-head">{report.ok ? 'done ✓' : 'finished with errors'}</div>
            {report.tidiedRc.length > 0 && (
              <div className="wiz-report-line">
                commented out superseded defs in{' '}
                {report.tidiedRc.map((p) => tildify(p)).join(', ')}
              </div>
            )}
            {report.reloadHint && <div className="wiz-report-line">{report.reloadHint}</div>}
            {report.errors.map((err, i) => (
              <div className="wiz-report-line wiz-err" key={i}>
                {err}
              </div>
            ))}
          </div>
        )}
      </div>

      <Hint label="what this writes (and won't break)">
        ccmon writes one file it owns — <code>~/.config/ccmon/claude-accounts.sh</code> — with
        a <code>claude-&lt;name&gt;</code> launcher per account (each sets{' '}
        <code>CLAUDE_CONFIG_DIR</code> in a subshell) plus the cross-account resume helpers. It
        then appends a single guarded <code>source</code> line to the shell rc you pick.
        Re-running is safe: the guarded block is added at most once (never duplicated), and your
        rc is only ever appended to — unless you tick <b>tidy up</b>, the one option that edits
        existing lines, and even then only to comment out single-line <code>claude-*</code>{' '}
        definitions the managed file replaces (shown in the preview, reversible, written
        atomically). If you already have hand-written wrappers, the preview flags them so you
        choose: leave them (the managed copies are identical, so they just shadow) or tidy them
        away. Remove the <code>ccmon managed</code> block to uninstall. Nothing runs until you
        open a new shell and call a wrapper.
      </Hint>
    </Panel>
  );
}
