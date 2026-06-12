/**
 * @file account-setup.ts
 * @brief Shell-aware multi-account setup — detect the shell, generate the `claude-*` wrappers, link them idempotently.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import type {
  AccountSpec,
  RcExisting,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellDetection,
  ShellTarget,
} from '../../shared/types';

/**
 * The wizard writes ONE file it fully owns — `~/.config/ccmon/claude-accounts`
 * (`.sh` on Linux/macOS, `.ps1` on Windows) — and appends a single guarded
 * `source`/dot-source line to the chosen shell startup file. That keeps risky
 * edits to a tiny, idempotent, easy-to-remove block while the wrappers
 * themselves live in a file ccmon can rewrite freely.
 *
 * It is OS-aware. POSIX shells (zy/zsh/bash on Linux & macOS) get
 * `name() { ( export CLAUDE_CONFIG_DIR=…; claude "$@" ); }` in the rc the
 * shell loads (macOS bash → `~/.bash_profile`). Windows gets PowerShell
 * `function name { $env:CLAUDE_CONFIG_DIR = …; claude @args }` dot-sourced
 * from `$PROFILE`. The bash cross-resume helper is Unix-only. Nothing here
 * runs a shell or a session — it only writes scripts the user then sources.
 */

type Family = 'posix' | 'powershell';

const MARK_BEGIN = '# >>> ccmon managed >>>';
const MARK_END = '# <<< ccmon managed <<<';

const MANAGED_FILE: Record<Family, string> = {
  posix: 'claude-accounts.sh',
  powershell: 'claude-accounts.ps1',
};
/** `$HOME`-relative reference to the managed file (forward slashes work in PS too). */
const managedRef = (family: Family) => `$HOME/.config/ccmon/${MANAGED_FILE[family]}`;

const familyOf = (platform: string): Family => (platform === 'win32' ? 'powershell' : 'posix');

/** The guarded block appended to the rc — sources the managed wrapper file. */
function rcSourceBlock(family: Family): string {
  const ref = managedRef(family);
  if (family === 'powershell') {
    return [
      MARK_BEGIN,
      '# Claude Code multi-account wrappers, managed by ccmon. Remove this block',
      `# (and ${ref}) to uninstall.`,
      `if (Test-Path "${ref}") { . "${ref}" }`,
      MARK_END,
    ].join('\n');
  }
  return [
    MARK_BEGIN,
    '# Claude Code multi-account wrappers, managed by ccmon. Remove this block',
    `# (and ${ref}) to uninstall.`,
    `[ -f "${ref}" ] && . "${ref}"`,
    MARK_END,
  ].join('\n');
}

/**
 * The cross-account resume helper, embedded so the packaged app is
 * self-contained. Installed to ~/.local/bin/claude-cross-resume; mirrors the
 * canonical script (copies a transcript into another account's config dir and
 * relaunches `claude --resume` from the original cwd).
 */
const HELPER_SCRIPT = `#!/usr/bin/env bash
# Continue a Claude Code session on a different account.
# Installed by ccmon. Copies the conversation transcript JSONL from one
# CLAUDE_CONFIG_DIR's projects/ tree into another, reads the original working
# directory out of the transcript, then re-launches \`claude --resume <id>\`
# there with CLAUDE_CONFIG_DIR pointed at the destination account.
#
# Usage: claude-cross-resume <src-config-dir> <dst-config-dir> <session-id>
set -euo pipefail

src="\${1:-}"
dst="\${2:-}"
id="\${3:-}"

if [[ -z $src || -z $dst || -z $id ]]; then
    echo "usage: $(basename "$0") <src-config-dir> <dst-config-dir> <session-id>" >&2
    exit 64
fi

src_file=$(find "$src/projects" -maxdepth 2 -name "\${id}.jsonl" -type f 2>/dev/null | head -1)
if [[ -z $src_file ]]; then
    echo "session $id not found under $src/projects" >&2
    exit 1
fi

proj=$(basename "$(dirname "$src_file")")
dst_dir="$dst/projects/$proj"
mkdir -p "$dst_dir"

if [[ -e "$dst_dir/\${id}.jsonl" ]]; then
    echo "note: $dst_dir/\${id}.jsonl already exists — keeping existing destination copy" >&2
else
    cp "$src_file" "$dst_dir/"
    echo "copied transcript → $dst_dir/\${id}.jsonl"
fi

cwd=$(python3 - "$src_file" <<'PY' 2>/dev/null || true
import json, sys
for line in open(sys.argv[1]):
    try:
        d = json.loads(line)
    except Exception:
        continue
    if isinstance(d, dict) and d.get("cwd"):
        print(d["cwd"]); break
PY
)

if [[ -n $cwd && -d $cwd ]]; then
    cd "$cwd"
    export CLAUDE_CONFIG_DIR="$dst"
    exec claude --resume "$id"
fi

cat >&2 <<EOF
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  CLAUDE_CONFIG_DIR=$dst claude --resume $id
EOF
exit 1
`;

export interface SetupEnv {
  home: string;
  /** the user's login shell path, or null when undetectable / on Windows */
  loginShell: string | null;
  /** Node's process.platform ('linux' | 'darwin' | 'win32' | …) */
  platform: string;
  /** resolved PowerShell $PROFILE path (Windows only); injectable for tests */
  psProfile?: string;
}

/**
 * Resolve the login shell the way a setup tool should: trust the system
 * account record (/etc/passwd via getent) over `$SHELL`, because `$SHELL`
 * lies in nested or wrapped shells (e.g. it reads `zsh` while the login shell
 * is actually `zy`). Falls back to `$SHELL` only when getent is unavailable
 * (e.g. macOS).
 */
export function resolveLoginShell(): string | null {
  try {
    const user = os.userInfo().username;
    const out = execFileSync('getent', ['passwd', user], { encoding: 'utf8', timeout: 2000 });
    const shell = out.split('\n')[0]?.split(':')[6];
    if (shell && shell.trim()) return shell.trim();
  } catch {
    /* getent missing or failed (macOS/Windows) — fall back to $SHELL */
  }
  return process.env.SHELL || null;
}

/** Ask PowerShell for the user's profile path; fall back to the PS7 default. */
export function resolvePowershellProfile(home = os.homedir()): string {
  for (const exe of ['pwsh', 'powershell']) {
    try {
      const out = execFileSync(exe, ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'], {
        encoding: 'utf8',
        timeout: 4000,
      });
      if (out.trim()) return out.trim();
    } catch {
      /* not installed / not Windows — try the next, then the default */
    }
  }
  return path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
}

function defaultEnv(): SetupEnv {
  const platform = process.platform;
  return {
    home: os.homedir(),
    loginShell: platform === 'win32' ? null : resolveLoginShell(),
    platform,
    psProfile: platform === 'win32' ? resolvePowershellProfile() : undefined,
  };
}

const managedScriptPath = (home: string, family: Family) =>
  path.join(home, '.config', 'ccmon', MANAGED_FILE[family]);
const helperPath = (home: string) => path.join(home, '.local', 'bin', 'claude-cross-resume');

function fileText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
const fileExists = (file: string) => fileText(file) != null;
const rcLinked = (rcPath: string) => (fileText(rcPath) ?? '').includes(MARK_BEGIN);
const fileEquals = (file: string, content: string) => fileText(file) === content;
const tilde = (p: string, home: string) => (p.startsWith(home) ? p.replace(home, '~') : p);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Quote a value for POSIX shell, preferring `$HOME`-relative for home paths. */
function shConfigDir(root: string, home: string): string {
  if (root === home) return '"$HOME"';
  if (root.startsWith(home + path.sep)) return `"$HOME${root.slice(home.length)}"`;
  if (/^[A-Za-z0-9_./-]+$/.test(root)) return root;
  return `"${root.replace(/(["$`\\])/g, '\\$1')}"`;
}

/**
 * A PowerShell double-quoted config dir, `$HOME`-relative for home paths.
 * Forward slashes are kept (PowerShell accepts them on Windows) so the literal
 * is host-independent. `$HOME` is a PowerShell automatic variable.
 */
function psConfigDir(root: string, home: string): string {
  const rel =
    root === home ? '$HOME' : root.startsWith(home + path.sep) ? `$HOME${root.slice(home.length)}` : root;
  return `"${rel.replace(/[\\]/g, '/').replace(/(["`])/g, '`$1')}"`;
}

/** A nice default wrapper name for a config root (~/.claude → claude-personal). */
export function suggestLabel(root: string): string {
  const base = path.basename(root);
  if (base === '.claude') return 'claude-personal';
  const suffix = base.replace(/^\.+/, '').replace(/^claude[-_]?/, '');
  return suffix ? `claude-${suffix}` : 'claude-account';
}

/** Drop a leading `claude-` so cross-resume names read `claude-X-from-Y`. */
const shortName = (name: string) => name.replace(/^claude-/, '');

/**
 * The ordered cross-resume pairs, shared by the generator and the scanner.
 * Only POSIX: the `claude-cross-resume` helper they call is a bash script, so
 * Windows gets launchers only (no `-from-` functions).
 */
function crossPairs(
  accounts: AccountSpec[],
  family: Family,
): Array<{ name: string; from: AccountSpec; to: AccountSpec }> {
  const pairs: Array<{ name: string; from: AccountSpec; to: AccountSpec }> = [];
  if (family !== 'posix' || accounts.length < 2) return pairs;
  for (const to of accounts) {
    for (const from of accounts) {
      if (to.name === from.name) continue;
      pairs.push({ name: `${to.name}-from-${shortName(from.name)}`, from, to });
    }
  }
  return pairs;
}

/** Every function name the managed file defines (launchers + resume helpers). */
export function managedNames(accounts: AccountSpec[], family: Family = 'posix'): string[] {
  return [...accounts.map((a) => a.name), ...crossPairs(accounts, family).map((p) => p.name)];
}

/**
 * The full contents of the managed wrapper file for `family`: one launcher per
 * account, plus (POSIX only) a `claude-<to>-from-<from>` resume helper per
 * ordered pair. Regenerated wholesale on every apply, so it always matches the
 * chosen accounts.
 */
export function renderManagedScript(
  accounts: AccountSpec[],
  home: string,
  family: Family = 'posix',
): string {
  const lines: string[] = [
    '# ccmon-managed — Claude Code account wrappers',
    '# Generated by ccmon (Accounts → multi-account setup). This whole file is',
    '# owned by ccmon and rewritten on each apply; delete it (and the',
    '# `ccmon managed` block in your shell startup file) to uninstall.',
    '',
  ];
  if (family === 'powershell') {
    for (const a of accounts) {
      lines.push(
        `function ${a.name} { $env:CLAUDE_CONFIG_DIR = ${psConfigDir(a.root, home)}; claude @args }`,
      );
    }
    return lines.join('\n') + '\n';
  }
  for (const a of accounts) {
    lines.push(`${a.name}() { ( export CLAUDE_CONFIG_DIR=${shConfigDir(a.root, home)}; claude "$@" ); }`);
  }
  const pairs = crossPairs(accounts, family);
  if (pairs.length) {
    lines.push('', '# Continue a session on another account when one hits its limit:');
    for (const p of pairs) {
      lines.push(
        `${p.name}() { claude-cross-resume ${shConfigDir(p.from.root, home)} ${shConfigDir(p.to.root, home)} "$1"; }`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches the start of a wrapper definition (POSIX `name() {` or PS `function name {`). */
function defStartRe(name: string, family: Family): RegExp {
  return family === 'powershell'
    ? new RegExp(`^\\s*function\\s+${escapeRe(name)}\\s*[({]`, 'i')
    : new RegExp(`^\\s*${escapeRe(name)}\\s*\\(\\)\\s*\\{`);
}
/** Matches a self-contained single-line definition we can safely comment out. */
function singleLineRe(name: string, family: Family): RegExp {
  return family === 'powershell'
    ? new RegExp(`^\\s*function\\s+${escapeRe(name)}\\s*(\\([^)]*\\))?\\s*\\{.*\\}\\s*$`, 'i')
    : new RegExp(`^\\s*${escapeRe(name)}\\s*\\(\\)\\s*\\{.*\\}\\s*;?\\s*$`);
}

const TIDY_PREFIX = '# ccmon superseded → ';

/** [start, end) line indices of the ccmon managed block in `lines`, or null. */
function managedBlockRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => l.includes(MARK_BEGIN));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.includes(MARK_END));
  return [start, end < 0 ? lines.length : end + 1];
}

/**
 * Pre-existing hand-written definitions of any managed wrapper found in `rc`,
 * OUTSIDE ccmon's own managed block. These would be shadowed by the managed
 * file (identical → harmless, but redundant); the UI surfaces them and the
 * optional tidy comments out the single-line ones.
 */
export function scanRcForWrappers(
  rcPath: string,
  names: string[],
  family: Family = 'posix',
): RcExisting[] {
  const text = fileText(rcPath);
  if (!text) return [];
  const lines = text.split('\n');
  const block = managedBlockRange(lines);
  const inBlock = (i: number) => block != null && i >= block[0] && i < block[1];
  const out: RcExisting[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inBlock(i) || lines[i].startsWith(TIDY_PREFIX)) continue;
    for (const name of names) {
      if (defStartRe(name, family).test(lines[i])) {
        out.push({ name, line: i + 1, text: lines[i].trim(), canTidy: singleLineRe(name, family).test(lines[i]) });
        break; // one match per line is enough
      }
    }
  }
  return out;
}

/** Comment out single-line managed-wrapper defs outside ccmon's block. */
function commentOutWrappers(text: string, names: string[], family: Family): string {
  const lines = text.split('\n');
  const block = managedBlockRange(lines);
  const inBlock = (i: number) => block != null && i >= block[0] && i < block[1];
  return lines
    .map((line, i) => {
      if (inBlock(i) || line.startsWith(TIDY_PREFIX)) return line;
      return names.some((n) => singleLineRe(n, family).test(line)) ? TIDY_PREFIX + line : line;
    })
    .join('\n');
}

/** Write via temp-file + rename so a rewrite can never leave a truncated rc. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.ccmon-tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * The OS and the shells whose startup files could hold the wrappers, with the
 * login/default shell flagged. On Windows that's a single PowerShell `$PROFILE`
 * target; on Linux/macOS it's zy/zsh/bash (bash → `~/.bash_profile` on macOS,
 * which is the file login shells read there). The login shell comes from the
 * system account record, not `$SHELL` (see resolveLoginShell). zy is only
 * offered when it's actually in play. The `detected` shell is what the UI
 * should pre-select.
 */
export function detectShells(env: SetupEnv = defaultEnv()): ShellDetection {
  if (familyOf(env.platform) === 'powershell') {
    const rcPath =
      env.psProfile ??
      path.join(env.home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const exists = fileExists(rcPath);
    const linked = rcLinked(rcPath);
    return {
      platform: env.platform,
      shells: [
        {
          shell: 'powershell',
          family: 'powershell',
          rcPath,
          exists,
          detected: true,
          linked,
          note: linked ? 'already linked' : exists ? 'your PowerShell profile' : 'profile would be created',
        },
      ],
    };
  }

  const loginName = env.loginShell ? path.basename(env.loginShell) : '';
  const bashRc = env.platform === 'darwin' ? '.bash_profile' : '.bashrc';
  const defs: Array<{ shell: 'zy' | 'zsh' | 'bash'; rc: string }> = [
    { shell: 'zy', rc: '.zyrc' },
    { shell: 'zsh', rc: '.zshrc' },
    { shell: 'bash', rc: bashRc },
  ];
  const shells = defs
    .map<ShellTarget>((d) => {
      const rcPath = path.join(env.home, d.rc);
      const exists = fileExists(rcPath);
      const detected = loginName === d.shell;
      const linked = rcLinked(rcPath);
      const note = linked
        ? 'already linked'
        : detected
          ? exists
            ? 'your login shell'
            : `login shell · creates ~/${d.rc}`
          : 'rc present';
      return { shell: d.shell, family: 'posix', rcPath, exists, detected, linked, note };
    })
    // Only surface shells the user actually uses: the login shell, or any with
    // an rc file already present. A shell that's neither is just noise — we
    // don't offer to create configs for shells you don't run (e.g. zsh on a
    // machine with no ~/.zshrc).
    .filter((s) => s.detected || s.exists);
  return { platform: env.platform, shells };
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Validation problems that must block an apply. */
function validate(opts: SetupOptions): string[] {
  const problems: string[] = [];
  if (!opts.accounts.length) problems.push('no accounts to set up');
  const seen = new Set<string>();
  for (const a of opts.accounts) {
    if (!NAME_RE.test(a.name)) problems.push(`invalid wrapper name "${a.name}"`);
    if (seen.has(a.name)) problems.push(`duplicate wrapper name "${a.name}"`);
    seen.add(a.name);
    if (!a.root || !path.isAbsolute(a.root)) problems.push(`"${a.name}" has no config dir`);
  }
  if (!opts.rcPaths.length) problems.push('pick at least one shell to link');
  return problems;
}

/** Dry-run: exactly what an apply would write, with nothing written. */
export function planSetup(opts: SetupOptions, env: SetupEnv = defaultEnv()): SetupPlan {
  const { home } = env;
  const family = familyOf(env.platform);
  const block = rcSourceBlock(family);
  const helperDest = helperPath(home);
  const names = managedNames(opts.accounts, family);
  const warnings: string[] = [];

  const rcEdits = opts.rcPaths.map((rcPath) => {
    const alreadyLinked = rcLinked(rcPath);
    const existing = scanRcForWrappers(rcPath, names, family);
    if (existing.length) {
      const display = tilde(rcPath, home);
      const tidyable = existing.filter((e) => e.canTidy).length;
      const manual = existing.length - tidyable;
      warnings.push(
        `${display} already defines ${existing.map((e) => e.name).join(', ')} by hand — ` +
          (opts.tidyExisting
            ? `tidy will comment out ${tidyable} single-line def${tidyable === 1 ? '' : 's'}` +
              (manual ? `; ${manual} multi-line def${manual === 1 ? '' : 's'} need manual removal` : '')
            : `they'd be shadowed by the managed file (identical → harmless). Enable tidy to comment them out`),
      );
    }
    return { rcPath, alreadyLinked, blockToAdd: alreadyLinked ? '' : block, existing };
  });

  // the cross-resume helper is a bash script — Unix only
  if (family === 'powershell' && opts.installHelper) {
    warnings.push('the claude-cross-resume helper is Unix-only and is skipped on Windows');
  }

  return {
    managedPath: managedScriptPath(home, family),
    managedScript: renderManagedScript(opts.accounts, home, family),
    rcEdits,
    helperDest,
    helperInstalled: family === 'posix' && fileEquals(helperDest, HELPER_SCRIPT),
    problems: validate(opts),
    warnings,
  };
}

/**
 * Apply the setup: (re)write the managed wrapper file, append the guarded
 * source line to each chosen rc that doesn't already have it, and optionally
 * install the cross-resume helper. Idempotent — re-running changes nothing
 * once everything is in place. Never rejects; collects per-step errors so a
 * partial success still reports what landed.
 */
export function applySetup(opts: SetupOptions, env: SetupEnv = defaultEnv()): SetupReport {
  const problems = validate(opts);
  if (problems.length) {
    return { ok: false, wroteManaged: false, linkedRc: [], tidiedRc: [], helperInstalled: false, reloadHint: '', errors: problems };
  }
  const { home } = env;
  const family = familyOf(env.platform);
  const errors: string[] = [];

  let wroteManaged = false;
  const managedPath = managedScriptPath(home, family);
  try {
    fs.mkdirSync(path.dirname(managedPath), { recursive: true });
    fs.writeFileSync(managedPath, renderManagedScript(opts.accounts, home, family));
    wroteManaged = true;
  } catch (e) {
    errors.push(`managed file: ${msg(e)}`);
  }

  const names = managedNames(opts.accounts, family);
  const block = rcSourceBlock(family);
  const linkedRc: string[] = [];
  const tidiedRc: string[] = [];
  for (const rcPath of opts.rcPaths) {
    try {
      const original = fileText(rcPath);
      let body = original ?? '';
      let mutated = false;

      // optional tidy: comment out conflicting single-line hand-written defs.
      // This is the only path that rewrites the rc — done atomically. Default
      // (tidy off) stays pure-append: existing lines are never touched.
      if (opts.tidyExisting && original) {
        const tidied = commentOutWrappers(original, names, family);
        if (tidied !== original) {
          body = tidied;
          mutated = true;
          tidiedRc.push(rcPath);
        }
      }

      if (!body.includes(MARK_BEGIN)) {
        const lead = body && !body.endsWith('\n') ? '\n' : '';
        body = `${body}${lead}\n${block}\n`;
        mutated = true;
        linkedRc.push(rcPath);
      }

      if (mutated) writeAtomic(rcPath, body); // creates the rc if it was absent
    } catch (e) {
      errors.push(`${tilde(rcPath, home)}: ${msg(e)}`);
    }
  }

  // the embedded helper is a bash script — install on POSIX only
  let helperInstalled = false;
  if (opts.installHelper && family === 'posix') {
    const dest = helperPath(home);
    try {
      if (!fileEquals(dest, HELPER_SCRIPT)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, HELPER_SCRIPT, { mode: 0o755 });
        fs.chmodSync(dest, 0o755); // writeFileSync mode is masked by umask — force it
      }
      helperInstalled = true;
    } catch (e) {
      errors.push(`helper: ${msg(e)}`);
    }
  }

  const reloadTargets = (linkedRc.length ? linkedRc : opts.rcPaths).map((p) => tilde(p, home));
  const reloadHint = reloadTargets.length
    ? `run: ${reloadTargets.map((t) => `source ${t}`).join('   ')}  (or open a new terminal)`
    : 'open a new terminal to load the wrappers';

  return { ok: errors.length === 0, wroteManaged, linkedRc, tidiedRc, helperInstalled, reloadHint, errors };
}

/**
 * Create a sibling config dir `~/.claude-<suffix>` (with its projects/ subdir)
 * so it shows up as a new account. The user still logs in there once via the
 * generated wrapper. Returns the new root or a validation/error reason.
 */
export function createAccountDir(
  suffix: string,
  env: SetupEnv = defaultEnv(),
): { ok: boolean; root: string; error?: string } {
  const clean = suffix.trim().replace(/^[.\s]+/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(clean)) {
    return { ok: false, root: '', error: 'use letters, digits, dash or underscore' };
  }
  const root = path.join(env.home, `.claude-${clean}`);
  if (fileExists(path.join(root, 'projects'))) {
    return { ok: true, root }; // already there — treat as success
  }
  try {
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    return { ok: true, root };
  } catch (e) {
    return { ok: false, root, error: msg(e) };
  }
}
