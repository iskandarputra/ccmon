/**
 * @file SetupWizard.tsx
 * @brief Guided multi-account setup — name wrappers, pick the shell, preview the exact diff, then apply.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../ui/Panel';
import { Hint } from '../ui/Hint';
import { useUsageStore } from '../../store/useUsageStore';
import { refreshAccounts, updateSettings } from '../../bootstrap';
import { tildify } from '../../lib/format';
import { accountRoot, suggestWrapperName } from '../../lib/crossAccount';
import { PROVIDER_PRESETS } from '../../../shared/providerPresets';
import { TOOLS, toolForRoot } from '../../../shared/tools';
import type {
  AccountSpec,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellTarget,
  ToolId,
} from '../../../shared/types';

/**
 * `KEY=value` lines → an env map. Deliberately forgiving about spacing and a
 * stray `export` prefix, because the text people paste in comes straight out
 * of a hand-written launcher script. Blank lines and `#` comments are dropped;
 * surrounding quotes are stripped so a pasted `KEY="v"` doesn't export the
 * quotes as part of the value.
 */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** The inverse, for seeding the editor from saved prefs. */
export const envToText = (env?: Record<string, string>): string =>
  Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

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

export function SetupWizard() {
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const prefs = useUsageStore((s) => s.settings?.accountWrapperPrefs) ?? {};

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
  const [newTool, setNewTool] = useState<ToolId>('claude');
  const [createErr, setCreateErr] = useState<string | null>(null);
  /** raw `KEY=value` text per root, and which rows have the editor open */
  const [envText, setEnvText] = useState<Record<string, string>>({});
  const [envOpen, setEnvOpen] = useState<Set<string>>(new Set());
  /** roots whose editor state has been seeded once — see the effect below */
  const seeded = useRef<Set<string>>(new Set());

  // detect OS + shells once; pre-pick the login shell (and anything linked).
  // A lone candidate is pre-picked too: when detection falls back to the
  // platform default (macOS with no resolvable login shell), it is the only
  // thing to link, and leaving it unticked would block apply for no reason.
  useEffect(() => {
    let alive = true;
    void window.ccmon?.detectShells().then((found) => {
      if (!alive) return;
      const only = found.shells.length === 1;
      setShells(found.shells);
      setPlatform(found.platform);
      setPicked(
        new Set(found.shells.filter((s) => only || s.detected || s.linked).map((s) => s.rcPath)),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  // untracked (deleted) accounts stay out of the wizard entirely — re-add
  // them from the Accounts view, which doesn't need a confirmation
  const roots = useMemo(
    () => sourceDirs.map(accountRoot).filter((root) => !prefs[root]?.disabled),
    [sourceDirs, prefs],
  );

  // seed wrapper-name suggestions for every account root, preferring a saved
  // rename over the auto-suggested default
  useEffect(() => {
    setNames((prev) => {
      const next = { ...prev };
      for (const root of roots) {
        if (next[root] === undefined) next[root] = prefs[root]?.name ?? suggestWrapperName(root);
      }
      return next;
    });
    // an account's extra env is persisted: regenerating the wrapper file
    // without it would silently strip a provider account's whole config
    setEnvText((prev) => {
      const next = { ...prev };
      for (const root of roots) {
        if (next[root] === undefined) next[root] = envToText(prefs[root]?.env);
      }
      return next;
    });
    // reveal the editor for accounts that already have env — but only the FIRST
    // time each root is seen, or applying (which updates prefs) would re-open a
    // box the user just collapsed
    const fresh = roots.filter((root) => !seeded.current.has(root));
    if (fresh.length) {
      fresh.forEach((root) => seeded.current.add(root));
      const withEnv = fresh.filter((root) => Object.keys(prefs[root]?.env ?? {}).length);
      if (withEnv.length) setEnvOpen((prev) => new Set([...prev, ...withEnv]));
    }
  }, [roots, prefs]);

  const envByRoot = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const root of roots) out[root] = parseEnvText(envText[root] ?? '');
    return out;
  }, [roots, envText]);

  const opts: SetupOptions = useMemo(
    () => ({
      accounts: roots.map<AccountSpec>((root) => {
        const env = envByRoot[root];
        return {
          tool: toolForRoot(root).id,
          name: names[root] || suggestWrapperName(root),
          root,
          ...(env && Object.keys(env).length ? { env } : {}),
        };
      }),
      rcPaths: [...picked],
      installHelper,
      tidyExisting: tidy,
    }),
    [roots, names, envByRoot, picked, installHelper, tidy],
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
      if (r?.ok) {
        // persist wizard-typed names AND env so they survive reopening the
        // wizard — a later apply would otherwise regenerate the file without them
        const nextPrefs = { ...prefs };
        for (const root of roots) {
          const env = envByRoot[root];
          nextPrefs[root] = {
            ...nextPrefs[root],
            name: names[root],
            ...(Object.keys(env ?? {}).length ? { env } : { env: undefined }),
          };
        }
        void updateSettings({ accountWrapperPrefs: nextPrefs });
      }
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
      const res = await window.ccmon?.createAccount(newSuffix, newTool);
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
      <div className="wiz-columns">
        {/* Step 1 Column */}
        <div className="wiz-col">
          <div className="wiz-step-label">1 · accounts → wrapper command</div>
          {/* the `+ env` control is the only way to reach the provider presets,
              and nothing else on this screen says they exist — the DeepSeek card
              that would is hidden until you already use DeepSeek */}
          <div className="wiz-step-note">
            each wrapper sets <code>CLAUDE_CONFIG_DIR</code>; <code>+ env</code> adds provider
            settings — that is how an account runs on DeepSeek instead of Anthropic
          </div>
          <div className="wiz-accts-list">
            {roots.map((root) => {
              const envCount = Object.keys(envByRoot[root] ?? {}).length;
              return (
                <div className="wiz-acct-row" key={root}>
                  <div className="wiz-acct">
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
                    <button
                      type="button"
                      className={`wiz-env-toggle${envCount ? ' is-set' : ''}`}
                      onClick={() =>
                        setEnvOpen((p) => {
                          const next = new Set(p);
                          if (next.has(root)) next.delete(root);
                          else next.add(root);
                          return next;
                        })
                      }
                      title="extra environment this wrapper exports (alternate provider, model mapping)"
                    >
                      {envCount ? `env · ${envCount}` : '+ env'}
                    </button>
                  </div>
                  {envOpen.has(root) && (
                    <div className="wiz-env-presets">
                      <span className="wiz-env-presets-label">preset</span>
                      {PROVIDER_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="wiz-preset"
                          title={p.summary}
                          onClick={() => {
                            setEnvText((prev) => ({ ...prev, [root]: envToText(p.env) }));
                            invalidate();
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                      {envText[root] ? (
                        <button
                          type="button"
                          className="wiz-preset is-clear"
                          onClick={() => {
                            setEnvText((prev) => ({ ...prev, [root]: '' }));
                            invalidate();
                          }}
                        >
                          clear
                        </button>
                      ) : null}
                    </div>
                  )}
                  {envOpen.has(root) && (
                    <textarea
                      className="wiz-env"
                      spellCheck={false}
                      // grows with the content: a provider preset is ~11 lines,
                      // and a 3-row box hides all but the first two of them
                      rows={Math.min(12, Math.max(3, (envText[root] ?? '').split('\n').length))}
                      placeholder={
                        'ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic\nANTHROPIC_AUTH_TOKEN=sk-…'
                      }
                      value={envText[root] ?? ''}
                      onChange={(e) => {
                        setEnvText((p) => ({ ...p, [root]: e.target.value }));
                        invalidate();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="wiz-add">
            {/* the tool decides both the home name and the subdir that makes
                it discoverable, so it has to be chosen before creating */}
            <select
              className="wiz-tool"
              value={newTool}
              onChange={(e) => setNewTool(e.target.value as ToolId)}
              aria-label="which CLI this account is for"
            >
              {TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="wiz-add-pre">~/.{newTool}-</span>
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

        {/* Step 2 Column */}
        <div className="wiz-col">
          <div className="wiz-step-label">
            2 · shell to link{' '}
            {platform && <span className="wiz-os">· {osLabel(platform)} detected</span>}
          </div>
          <div className="wiz-shells">
            {shells.map((s) => (
              <button
                key={s.rcPath}
                type="button"
                className={`wiz-shell${picked.has(s.rcPath) ? ' is-picked' : ''}${s.detected ? ' is-detected' : ''}`}
                onClick={() => togglePick(s.rcPath)}
              >
                <div className="wiz-shell-top">
                  <span className="wiz-shell-name">{s.shell}</span>
                  <div className="wiz-shell-radio" aria-hidden="true" />
                </div>
                <span className="wiz-shell-rc">{tildify(s.rcPath)}</span>
                <span className="wiz-shell-note">{s.note}</span>
              </button>
            ))}
          </div>
          {platform === 'win32' ? (
            <div className="wiz-os-note">
              on Windows ccmon writes a PowerShell <code>function</code> per account and dot-sources
              them from your <code>$PROFILE</code>. The bash <code>claude-cross-resume</code> helper
              is Unix-only, so cross-account resume from the dashboard needs WSL or Git Bash.
            </div>
          ) : (
            <label className="wiz-toggle">
              <input
                type="checkbox"
                checked={installHelper}
                onChange={(e) => {
                  setInstallHelper(e.target.checked);
                  invalidate();
                }}
              />
              <span className="wiz-toggle-track" aria-hidden="true" />
              <span className="wiz-toggle-text">
                install the <code>claude-cross-resume</code> helper to ~/.local/bin
              </span>
            </label>
          )}
          <label className="wiz-toggle">
            <input
              type="checkbox"
              checked={tidy}
              onChange={(e) => {
                setTidy(e.target.checked);
                invalidate();
              }}
            />
            <span className="wiz-toggle-track" aria-hidden="true" />
            <span className="wiz-toggle-text">
              tidy up: comment out any existing hand-written <code>claude-*</code> defs the managed
              file replaces (single-line only · shown in preview)
            </span>
          </label>
        </div>
      </div>

      {/* Step 3 — review & apply */}
      <div className="wiz-step wiz-step-apply">
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
            {plan.managed.map((m) => (
              <div key={m.path}>
                <div className="wiz-pre-label">
                  {tildify(m.path)} <span className="wiz-dim">(rewritten)</span>
                </div>
                <pre className="wiz-pre">{m.script}</pre>
              </div>
            ))}
            {plan.rcEdits.map((e) => (
              <div className="wiz-rc" key={e.rcPath}>
                <div className="wiz-pre-label">
                  {tildify(e.rcPath)}{' '}
                  <span className="wiz-dim">
                    {e.blockReplaces
                      ? '(update the existing ccmon block — it predates Codex support)'
                      : e.alreadyLinked
                        ? '(already linked — no change)'
                        : '(append)'}
                  </span>
                </div>
                {/* show the block whenever it will actually be written, so a
                    replacement is previewed rather than happening silently */}
                {e.blockToAdd && <pre className="wiz-pre wiz-pre-sm">{e.blockToAdd}</pre>}
                {e.existing.length > 0 && (
                  <div className="wiz-conflicts">
                    <div className="wiz-conflicts-head">
                      existing hand-written defs in this file:
                    </div>
                    {e.existing.map((x) => (
                      <div className="wiz-conflict" key={x.line}>
                        <span className="wiz-conflict-tag">
                          {tidy ? (x.canTidy ? 'comment out' : 'remove by hand') : 'shadowed'}
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
            {plan.helpers.map((h) => (
              <div className="wiz-pre-label" key={h.dest}>
                {tildify(h.dest)}{' '}
                <span className="wiz-dim">
                  {!installHelper
                    ? '(skipped)'
                    : h.installed
                      ? '(already current)'
                      : '(install, chmod +x)'}
                </span>
              </div>
            ))}
          </div>
        )}

        {report && (
          <div className={`wiz-report${report.ok ? ' is-ok' : ' is-err'}`}>
            <div className="wiz-report-head">{report.ok ? 'done ✓' : 'finished with errors'}</div>
            {report.tidiedRc.length > 0 && (
              <div className="wiz-report-line">
                commented out superseded defs in {report.tidiedRc.map((p) => tildify(p)).join(', ')}
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
        ccmon writes one file it owns — <code>~/.config/ccmon/claude-accounts.sh</code> — with a{' '}
        <code>claude-&lt;name&gt;</code> launcher per account (each sets{' '}
        <code>CLAUDE_CONFIG_DIR</code> in a subshell) plus the cross-account resume helpers. It then
        appends a single guarded <code>source</code> line to the shell rc you pick. Re-running is
        safe: the guarded block is added at most once (never duplicated), and your rc is only ever
        appended to — unless you tick <b>tidy up</b>, the one option that edits existing lines, and
        even then only to comment out single-line <code>claude-*</code> definitions the managed file
        replaces (shown in the preview, reversible, written atomically). If you already have
        hand-written wrappers, the preview flags them so you choose: leave them (the managed copies
        are identical, so they just shadow) or tidy them away. Remove the <code>ccmon managed</code>{' '}
        block to uninstall. Nothing runs until you open a new shell and call a wrapper.
      </Hint>
      <Hint label="env: running an account on another provider">
        <code>+ env</code> adds variables the wrapper exports alongside{' '}
        <code>CLAUDE_CONFIG_DIR</code>, which is what an alternate-provider account needs — Claude
        Code pointed at DeepSeek is <code>ANTHROPIC_BASE_URL</code> +{' '}
        <code>ANTHROPIC_AUTH_TOKEN</code> + a model mapping, none of which is a config dir. Give
        that account its own root (<code>~/.claude-deepseek</code>) so its usage stays separate:
        ccmon prices every model it finds, but transcripts written into <code>~/.claude</code>{' '}
        belong to that account. Values are exported in a subshell (on Windows, restored afterwards)
        so they never leak into your session, and the cross-resume wrappers re-export the
        destination's env — resuming into a DeepSeek account keeps DeepSeek. A token typed here is
        stored in the generated wrapper file and in ccmon's settings, both written <code>0600</code>
        : private to your user, not encrypted.
      </Hint>
    </Panel>
  );
}
