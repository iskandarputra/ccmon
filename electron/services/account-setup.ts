/**
 * @file account-setup.ts
 * @brief Shell-aware multi-account setup — detect the shell, generate the per-tool wrappers, link them idempotently.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { SECRET_REF_RE } from '../../shared/providerPresets';
import { TOOLS, toolById, toolForRoot, type ToolProfile } from '../../shared/tools';
import type {
  AccountSpec,
  AccountWrapperPrefs,
  RcExisting,
  SetupOptions,
  SetupPlan,
  SetupReport,
  ShellDetection,
  ShellTarget,
  ToolId,
} from '../../shared/types';

/**
 * The wizard writes files it fully owns — one per tool, under
 * `~/.config/ccmon/` (`<tool>-accounts.sh` on Linux/macOS, `.ps1` on Windows)
 * — and maintains a single guarded block in the chosen shell startup file that
 * sources all of them. That keeps risky edits to a tiny, idempotent,
 * easy-to-remove block while the wrappers themselves live in files ccmon can
 * rewrite freely.
 *
 * ONE FILE PER TOOL, not one shared file: a Claude-only user's
 * `claude-accounts.sh` must not churn because a Codex account appeared, and
 * removing your last account of a tool should delete that tool's file rather
 * than leave a stale one behind.
 *
 * It is OS-aware. POSIX shells (zy/zsh/bash on Linux & macOS) get
 * `name() { ( export <HOME_VAR>=…; <bin> "$@" ); }` in the rc the shell loads
 * (macOS bash → `~/.bash_profile`). Windows gets PowerShell
 * `function name { $env:<HOME_VAR> = …; <bin> @args }` dot-sourced from
 * `$PROFILE`. Which variable and which binary come from the tool's profile in
 * `shared/tools.ts`. Nothing here runs a shell or a session — it only writes
 * scripts the user then sources.
 */

type Family = 'posix' | 'powershell';

const MARK_BEGIN = '# >>> ccmon managed >>>';
const MARK_END = '# <<< ccmon managed <<<';

/** `$HOME`-relative reference to a tool's managed file (forward slashes work in PS too). */
const managedRef = (tool: ToolProfile, family: Family) =>
  `$HOME/.config/ccmon/${tool.managedFile[family]}`;

const familyOf = (platform: string): Family => (platform === 'win32' ? 'powershell' : 'posix');

/**
 * The guarded block in the rc — sources EVERY tool's managed wrapper file.
 *
 * Every line is emitted unconditionally and guarded by an existence test, so
 * the block's content does not depend on which accounts exist. That is
 * deliberate: a block whose content varied would need rewriting whenever the
 * account set changed, and a user who never re-ran the wizard would silently
 * stop loading a tool.
 */
function rcSourceBlock(family: Family): string {
  const refs = TOOLS.map((t) => managedRef(t, family));
  const head = [
    MARK_BEGIN,
    '# Coding-CLI account wrappers, managed by ccmon. Remove this block (and',
    '# the files it sources, under ~/.config/ccmon/) to uninstall.',
  ];
  const body =
    family === 'powershell'
      ? refs.map((ref) => `if (Test-Path "${ref}") { . "${ref}" }`)
      : refs.map((ref) => `[ -f "${ref}" ] && . "${ref}"`);
  return [...head, ...body, MARK_END].join('\n');
}

/**
 * The cross-account resume helper, embedded so the packaged app is
 * self-contained. Installed to ~/.local/bin/claude-cross-resume; mirrors the
 * canonical script (copies a transcript into another account's config dir and
 * relaunches `claude --resume` from the original cwd).
 */
const HELPER_SCRIPT = `#!/usr/bin/env bash
#
# claude-cross-resume — continue a Claude Code session on a different account.
# Installed by ccmon.
#
# Copies a conversation transcript (the <id>.jsonl) from one
# CLAUDE_CONFIG_DIR's projects/ tree into another, reads the original
# working directory out of the transcript, then re-launches
# \`claude --resume <id>\` there with CLAUDE_CONFIG_DIR pointed at the
# destination account.
#
# Auxiliary state (tasks/, file-history/, session-env/) is NOT copied; the
# conversation resumes fine without it, but those caches start empty on the
# destination side.
#
# Overwrite policy
#   A resumed session only ever APPENDS lines to its JSONL, so line count is
#   a reliable "which side holds the newer conversation" signal. This makes
#   the personal <-> work round-trip seamless:
#     - destination missing        -> copy
#     - source has MORE lines       -> overwrite (destination backed up first)
#     - source has <= lines         -> keep destination (same-or-newer)
#   --force overwrites regardless; --keep never touches an existing
#   destination. Any overwrite backs the destination up to a timestamped
#   *.bak first, so nothing is lost.
#
# Usage: claude-cross-resume [--force|--keep|--dry-run|--no-launch] \\
#            <src-config-dir> <dst-config-dir> <session-id>

set -euo pipefail

readonly PROG=$(basename "$0")

usage() {
    cat <<EOF
$PROG — continue a Claude Code session on a different account.

Usage:
  $PROG [options] <src-config-dir> <dst-config-dir> <session-id>

Options:
  -f, --force        Overwrite an existing destination transcript even if it
                     is same-or-newer (the old copy is still backed up).
      --keep         Never overwrite an existing destination (strict).
  -n, --dry-run      Report what would happen; copy nothing and do not launch.
      --no-launch    Copy as normal but do not exec \\\`claude --resume\\\`.
  -h, --help         Show this help and exit.

Default (no -f/--keep): overwrite only when the source has more lines than
the destination — a resumed session only appends, so more lines == newer.
EOF
}

log()  { printf '%s\\n' "$*" >&2; }        # human-facing status
die()  { printf '%s: %s\\n' "$PROG" "$1" >&2; exit "\${2:-1}"; }

force=0
keep=0
dry_run=0
launch=1
positional=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f | --force)  force=1 ;;
        --keep)        keep=1 ;;
        -n | --dry-run) dry_run=1 ;;
        --no-launch)   launch=0 ;;
        -h | --help)   usage; exit 0 ;;
        --)            shift; while [[ $# -gt 0 ]]; do positional+=("$1"); shift; done; break ;;
        -*)            die "unknown option: $1" 64 ;;
        *)             positional+=("$1") ;;
    esac
    shift
done

src="\${positional[0]:-}"
dst="\${positional[1]:-}"
id="\${positional[2]:-}"

[[ -n $src && -n $dst && -n $id ]] || { usage >&2; exit 64; }
[[ $force -eq 1 && $keep -eq 1 ]] && die "--force and --keep are mutually exclusive" 64
[[ -d $src ]] || die "source config dir not found: $src" 66
[[ -d $dst ]] || die "destination config dir not found: $dst" 66

src_file=$(find "$src/projects" -maxdepth 2 -name "\${id}.jsonl" -type f 2>/dev/null | head -1)
[[ -n $src_file ]] || die "session $id not found under $src/projects"

proj=$(basename "$(dirname "$src_file")")
dst_dir="$dst/projects/$proj"
dst_file="$dst_dir/\${id}.jsonl"

lines() { wc -l < "$1" 2>/dev/null | tr -d ' '; }

# A collision-safe backup name: <file>.<timestamp>.bak, then .bak-1, .bak-2…
backup_path() {
    local base="\${dst_file}.$(date +%Y%m%d-%H%M%S).bak" candidate n=1
    candidate="$base"
    while [[ -e $candidate ]]; do candidate="\${base}-\${n}"; ((n++)); done
    printf '%s' "$candidate"
}

do_copy() {
    if [[ $dry_run -eq 1 ]]; then
        [[ -e $dst_file ]] && log "[dry-run] would back up existing destination"
        log "[dry-run] would copy transcript → $dst_file ($(lines "$src_file") lines)"
        return
    fi
    mkdir -p "$dst_dir"
    if [[ -e $dst_file ]]; then
        local bak; bak=$(backup_path)
        cp -p "$dst_file" "$bak"
        log "backed up existing destination → $bak"
    fi
    cp "$src_file" "$dst_file"
    echo "copied transcript → $dst_file ($(lines "$src_file") lines)"
}

# --- decide whether to copy -------------------------------------------------
if [[ ! -e $dst_file ]]; then
    do_copy
elif [[ $keep -eq 1 ]]; then
    log "note: destination exists — keeping it (--keep)"
elif [[ $force -eq 1 ]]; then
    log "overwriting destination (--force)"
    do_copy
else
    src_lines=$(lines "$src_file"); dst_lines=$(lines "$dst_file")
    if [[ \${src_lines:-0} -gt \${dst_lines:-0} ]]; then
        log "source is newer (\${src_lines} > \${dst_lines} lines) — overwriting"
        do_copy
    else
        log "note: destination is same-or-newer (\${dst_lines} >= \${src_lines} lines) — keeping it; use --force to override"
    fi
fi

# --- locate the original working directory ----------------------------------
# node first: macOS ships NO python3 until the Xcode command line tools are
# installed, and node is what ran ccmon in the first place. python3 stays as a
# fallback for a box with python but no node.
cwd=""
read_cwd_node() {
    node -e '
const fs = require("fs");
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\\n")) {
  if (!line) continue;
  try { const d = JSON.parse(line); if (d && d.cwd) { process.stdout.write(d.cwd); break; } } catch {}
}' "$1" 2>/dev/null || true
}
read_cwd_python() {
    python3 - "$1" <<'PY' 2>/dev/null || true
import json, sys
for line in open(sys.argv[1]):
    try:
        d = json.loads(line)
    except Exception:
        continue
    if isinstance(d, dict) and d.get("cwd"):
        print(d["cwd"]); break
PY
}
if command -v node >/dev/null 2>&1; then
    cwd=$(read_cwd_node "$src_file")
elif command -v python3 >/dev/null 2>&1; then
    cwd=$(read_cwd_python "$src_file")
fi

# --- launch (or explain how to) ---------------------------------------------
if [[ $dry_run -eq 1 || $launch -eq 0 ]]; then
    reason=$([[ $dry_run -eq 1 ]] && echo "dry-run" || echo "--no-launch")
    log "[$reason] not launching. To resume manually:"
    log "  cd '\${cwd:-<project dir>}' && CLAUDE_CONFIG_DIR='$dst' claude --resume $id"
    exit 0
fi

if [[ -n $cwd && -d $cwd ]]; then
    cd "$cwd"
    export CLAUDE_CONFIG_DIR="$dst"
    exec claude --resume "$id"
fi

cat >&2 <<EOF
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  CLAUDE_CONFIG_DIR='$dst' claude --resume $id
EOF
exit 1
`;

/**
 * The Windows port of the helper above — same contract, same overwrite policy,
 * PowerShell 5.1-compatible (no ternary, no null-coalescing: Windows ships 5.1
 * and a script that only runs under pwsh 7 would be useless on a stock box).
 *
 * Reading `cwd` needs no external interpreter here: ConvertFrom-Json is built
 * in, which is the one thing the bash version has to shell out to node for.
 */
const PS_HELPER_SCRIPT = `# claude-cross-resume.ps1 — continue a Claude Code session on a different account.
# Installed by ccmon. See the POSIX twin at ~/.local/bin/claude-cross-resume.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string] $Src,
    [Parameter(Mandatory = $true, Position = 1)][string] $Dst,
    [Parameter(Mandatory = $true, Position = 2)][string] $Id,
    [switch] $Force,
    [switch] $Keep,
    [switch] $DryRun,
    [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'

# -ErrorAction Continue: the preference above is Stop, which would make
# Write-Error terminating here and leave the exit below unreachable — the
# caller would see an exception instead of the exit code the POSIX twin gives.
function Fail($m) { Write-Error $m -ErrorAction Continue; exit 1 }
function Note($m) { Write-Host $m -ForegroundColor DarkGray }

if ($Force -and $Keep) { Fail '-Force and -Keep are mutually exclusive' }
if (-not (Test-Path -LiteralPath $Src -PathType Container)) { Fail "source config dir not found: $Src" }
if (-not (Test-Path -LiteralPath $Dst -PathType Container)) { Fail "destination config dir not found: $Dst" }

$srcFile = Get-ChildItem -LiteralPath (Join-Path $Src 'projects') -Filter "$Id.jsonl" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $srcFile) { Fail "session $Id not found under $Src\\projects" }

$proj    = Split-Path -Leaf $srcFile.DirectoryName
$dstDir  = Join-Path (Join-Path $Dst 'projects') $proj
$dstFile = Join-Path $dstDir "$Id.jsonl"

function LineCount($p) {
    if (-not (Test-Path -LiteralPath $p)) { return 0 }
    return (Get-Content -LiteralPath $p -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
}

function BackupPath {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $base = "$dstFile.$stamp.bak"
    $candidate = $base
    $n = 1
    while (Test-Path -LiteralPath $candidate) { $candidate = "$base-$n"; $n++ }
    return $candidate
}

function DoCopy {
    if ($DryRun) {
        if (Test-Path -LiteralPath $dstFile) { Note '[dry-run] would back up existing destination' }
        Note "[dry-run] would copy transcript -> $dstFile ($(LineCount $srcFile.FullName) lines)"
        return
    }
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    if (Test-Path -LiteralPath $dstFile) {
        $bak = BackupPath
        Copy-Item -LiteralPath $dstFile -Destination $bak
        Note "backed up existing destination -> $bak"
    }
    Copy-Item -LiteralPath $srcFile.FullName -Destination $dstFile
    Write-Host "copied transcript -> $dstFile ($(LineCount $srcFile.FullName) lines)"
}

# A resumed session only APPENDS, so more lines == newer. Same policy as POSIX.
if (-not (Test-Path -LiteralPath $dstFile)) { DoCopy }
elseif ($Keep) { Note 'note: destination exists - keeping it (-Keep)' }
elseif ($Force) { Note 'overwriting destination (-Force)'; DoCopy }
else {
    $s = LineCount $srcFile.FullName
    $d = LineCount $dstFile
    if ($s -gt $d) { Note "source is newer ($s > $d lines) - overwriting"; DoCopy }
    else { Note "note: destination is same-or-newer ($d >= $s lines) - keeping it; use -Force to override" }
}

$cwd = $null
foreach ($line in Get-Content -LiteralPath $srcFile.FullName) {
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if ($o -and $o.cwd) { $cwd = $o.cwd; break }
}

if ($DryRun -or $NoLaunch) {
    $reason = 'dry-run'
    if (-not $DryRun) { $reason = '-NoLaunch' }
    $where = $cwd
    if (-not $where) { $where = '<project dir>' }
    Note "[$reason] not launching. To resume manually:"
    Note "  cd '$where'; \`$env:CLAUDE_CONFIG_DIR = '$Dst'; claude --resume $Id"
    exit 0
}

if ($cwd -and (Test-Path -LiteralPath $cwd -PathType Container)) {
    Set-Location -LiteralPath $cwd
    $env:CLAUDE_CONFIG_DIR = $Dst
    claude --resume $Id
    if ($null -eq $LASTEXITCODE) { exit 0 }
    exit $LASTEXITCODE
}

Write-Error -ErrorAction Continue -Message @"
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  \`$env:CLAUDE_CONFIG_DIR = '$Dst'; claude --resume $Id
"@
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

/** Run a probe command for the login shell; null on any failure. Injectable for tests. */
export type ShellProbe = (file: string, args: string[]) => string | null;

const execProbe: ShellProbe = (file, args) => {
  try {
    return execFileSync(file, args, { encoding: 'utf8', timeout: 2000 });
  } catch {
    return null;
  }
};

/**
 * Resolve the login shell the way a setup tool should: trust the system
 * account record over `$SHELL`, because `$SHELL` lies in nested or wrapped
 * shells (it reads `zsh` while the login shell is actually `zy`) and is not
 * guaranteed to be in our environment at all.
 *
 * The record lives in a different place per OS:
 * - Linux/BSD: `/etc/passwd`, read via `getent passwd $USER` (field 7).
 * - macOS: Directory Services — there is NO `getent`. `dscl . -read
 *   /Users/$USER UserShell` is the equivalent, and it matters more here than
 *   on Linux: a GUI app started from Finder or the Dock inherits launchd's
 *   environment, which need not carry `$SHELL`, so the old fallback could
 *   leave us with no login shell at all and an empty shell list in the wizard.
 *
 * `$SHELL` stays as the last resort for anything neither probe answers.
 */
export function resolveLoginShell(
  platform: string = process.platform,
  probe: ShellProbe = execProbe,
): string | null {
  let user = '';
  try {
    user = os.userInfo().username;
  } catch {
    /* no passwd entry for this uid (containers) — probes are pointless */
  }
  if (user) {
    if (platform === 'darwin') {
      // "UserShell: /bin/zsh" — the key is echoed back with the value
      const shell = probe('dscl', ['.', '-read', `/Users/${user}`, 'UserShell'])?.match(
        /UserShell:\s*(\S+)/,
      )?.[1];
      if (shell) return shell;
    } else {
      const shell = probe('getent', ['passwd', user])?.split('\n')[0]?.split(':')[6]?.trim();
      if (shell) return shell;
    }
  }
  return process.env.SHELL || null;
}

/**
 * Ask PowerShell for the user's profile path; fall back to the PS7 default.
 *
 * Asking the shell is what makes this correct — the answer accounts for both
 * `Documents\PowerShell` (PS7, via `pwsh`) and `Documents\WindowsPowerShell`
 * (5.1, via `powershell`), and for OneDrive Known Folder Move, which
 * redirects `Documents` to `%USERPROFILE%\OneDrive\Documents`. The hardcoded
 * fallback can only guess, so it at least honours the OneDrive redirect when
 * that folder is the one that exists.
 */
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
  const plain = path.join(home, 'Documents');
  const oneDrive = path.join(home, 'OneDrive', 'Documents');
  const docs = !dirExists(plain) && dirExists(oneDrive) ? oneDrive : plain;
  return path.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
}

function defaultEnv(): SetupEnv {
  const platform = process.platform;
  return {
    home: os.homedir(),
    loginShell: platform === 'win32' ? null : resolveLoginShell(platform),
    platform,
    psProfile: platform === 'win32' ? resolvePowershellProfile() : undefined,
  };
}

const managedScriptPath = (tool: ToolProfile, home: string, family: Family) =>
  path.join(home, '.config', 'ccmon', tool.managedFile[family]);

/**
 * Where the cross-resume helper lands. POSIX keeps the Unix convention
 * (`~/.local/bin`, mode 0755, called by absolute path since macOS does not put
 * it on PATH). Windows has no such convention and no executable bit, so the
 * `.ps1` sits next to the managed wrapper file that calls it.
 */
const helperPath = (home: string, family: Family = 'posix'): string =>
  family === 'powershell'
    ? path.join(home, '.config', 'ccmon', 'claude-cross-resume.ps1')
    : path.join(home, '.local', 'bin', 'claude-cross-resume');

// The `$HOME`-relative PowerShell helper reference is now derived per tool
// inside renderManagedScript, from `ToolProfile.helperName`.

const helperScript = (family: Family) =>
  family === 'powershell' ? PS_HELPER_SCRIPT : HELPER_SCRIPT;

function fileText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
const fileExists = (file: string) => fileText(file) != null;
/** fileExists() reads the file, so it says no for a directory — this is the dir test. */
function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
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
    root === home
      ? '$HOME'
      : root.startsWith(home + path.sep)
        ? `$HOME${root.slice(home.length)}`
        : root;
  return `"${rel.replace(/[\\]/g, '/').replace(/(["`])/g, '`$1')}"`;
}

/**
 * A POSIX single-quoted literal: nothing inside is expanded, which is what an
 * API token or a URL with `$` or backticks needs. `'` closes, escapes, reopens.
 */
const shLiteral = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** A PowerShell single-quoted literal — no expansion; `'` doubles to escape. */
const psLiteral = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** `KEY='value'` pairs for the POSIX `export` line, in insertion order. */
const shEnvSets = (env?: Record<string, string>): string[] =>
  Object.entries(env ?? {}).map(([k, v]) => `${k}=${shLiteral(v)}`);

/** `'KEY' = 'value'` entries for the PowerShell hashtable literal. */
const psEnvSets = (env?: Record<string, string>): string[] =>
  Object.entries(env ?? {}).map(([k, v]) => `${psLiteral(k)} = ${psLiteral(v)}`);

/**
 * A PowerShell function body that sets env vars, runs `body`, and puts the
 * environment back exactly as it was.
 *
 * `$env:X = …` inside a PowerShell function writes the PROCESS environment,
 * not a local scope — the previous single-line wrapper leaked
 * `CLAUDE_CONFIG_DIR` into the whole session, so a later bare `claude` silently
 * ran against the last wrapper's account. The save/restore in `finally` is what
 * makes the Windows wrapper behave like the POSIX subshell.
 */
function psScopedBody(sets: string[], body: string): string {
  return [
    '    $ccmonVars = @{ ' + sets.join('; ') + ' }',
    '    $ccmonPrev = @{}',
    '    try {',
    '        foreach ($k in $ccmonVars.Keys) {',
    '            $ccmonPrev[$k] = [Environment]::GetEnvironmentVariable($k)',
    // Set-Item refuses an empty -Value, so an empty variable is an unset one
    // in both directions — otherwise a `KEY=` line would throw at call time.
    '            if ([string]::IsNullOrEmpty($ccmonVars[$k])) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }',
    '            else { Set-Item -Path "env:$k" -Value $ccmonVars[$k] }',
    '        }',
    `        ${body}`,
    '    } finally {',
    '        foreach ($k in $ccmonPrev.Keys) {',
    '            if ([string]::IsNullOrEmpty($ccmonPrev[$k])) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }',
    '            else { Set-Item -Path "env:$k" -Value $ccmonPrev[$k] }',
    '        }',
    '    }',
  ].join('\n');
}

/** A nice default wrapper name for a home (~/.claude → claude-personal). */
export const suggestLabel = (root: string): string => toolForRoot(root).suggestWrapperName(root);

/** Drop the tool prefix so cross-resume names read `<tool>-X-from-Y`. */
const shortName = (spec: AccountSpec) => spec.name.replace(new RegExp(`^${spec.tool}-`), '');

/**
 * The ordered cross-resume pairs, grouped BY TOOL and shared by the generator
 * and the scanner. Both families: each tool's helper ships as a bash script
 * for POSIX and a PowerShell script for Windows, so `<to>-from-<from>` exists
 * everywhere.
 *
 * The partition is not cosmetic. A `claude-work-from-codex-personal` wrapper
 * would copy a Claude transcript into a Codex home, which is nonsense — two
 * accounts per tool yield 2 + 2 pairs, not 12.
 */
function crossPairs(
  accounts: AccountSpec[],
): Array<{ name: string; tool: ToolId; from: AccountSpec; to: AccountSpec }> {
  const pairs: Array<{ name: string; tool: ToolId; from: AccountSpec; to: AccountSpec }> = [];
  for (const tool of TOOLS) {
    const group = accounts.filter((a) => a.tool === tool.id);
    if (group.length < 2) continue;
    for (const to of group) {
      for (const from of group) {
        if (to.name === from.name) continue;
        pairs.push({ name: `${to.name}-from-${shortName(from)}`, tool: tool.id, from, to });
      }
    }
  }
  return pairs;
}

/**
 * Every function name the managed file defines (launchers + resume helpers).
 * Family-independent since Windows gained its own cross-resume helper — both
 * families now define the same set of names.
 */
export function managedNames(accounts: AccountSpec[]): string[] {
  return [...accounts.map((a) => a.name), ...crossPairs(accounts).map((p) => p.name)];
}

/**
 * The full contents of ONE tool's managed wrapper file for `family`: a
 * launcher per account of that tool, plus a `<to>-from-<from>` resume helper
 * per ordered pair within it. Regenerated wholesale on every apply, so it
 * always matches the chosen accounts.
 *
 * `accounts` is the WHOLE list and is filtered here, so a caller can render
 * every file from one array without partitioning it first.
 */
export function renderManagedScript(
  accounts: AccountSpec[],
  home: string,
  family: Family = 'posix',
  toolId: ToolId = 'claude',
): string {
  const tool = toolById(toolId);
  const mine = accounts.filter((a) => a.tool === toolId);
  const lines: string[] = [
    `# ccmon-managed — ${tool.label} account wrappers`,
    '# Generated by ccmon (Accounts → multi-account setup). This whole file is',
    '# owned by ccmon and rewritten on each apply; delete it (and the',
    '# `ccmon managed` block in your shell startup file) to uninstall.',
    '',
  ];
  const pairs = crossPairs(accounts).filter((p) => p.tool === toolId);
  const psHelperRef = `"$HOME/.config/ccmon/${tool.helperName}.ps1"`;

  if (family === 'powershell') {
    for (const a of mine) {
      const sets = [
        `${psLiteral(tool.homeEnvVar)} = ${psConfigDir(a.root, home)}`,
        ...psEnvSets(a.env),
      ];
      lines.push(`function ${a.name} {`, psScopedBody(sets, `${tool.bin} @args`), '}', '');
    }
    if (pairs.length) {
      lines.push('# Continue a session on another account when one hits its limit:');
      for (const p of pairs) {
        // The destination's env is applied around the helper call, so the
        // relaunched session lands on the right account AND the right provider.
        const sets = [
          `${psLiteral(tool.homeEnvVar)} = ${psConfigDir(p.to.root, home)}`,
          ...psEnvSets(p.to.env),
        ];
        // `$args[0]` is $null when called with no session id, and the helper's
        // Mandatory parameter would then prompt interactively for it — a
        // confusing hang. Say what is wrong and stop.
        const call =
          `if ($args.Count -lt 1) { Write-Error "usage: ${p.name} <session-id>"; return }; ` +
          `& ${psHelperRef} ${psConfigDir(p.from.root, home)} ${psConfigDir(p.to.root, home)} $args[0]`;
        lines.push(`function ${p.name} {`, psScopedBody(sets, call), '}', '');
      }
    }
    return lines.join('\n') + '\n';
  }

  for (const a of mine) {
    const sets = [`${tool.homeEnvVar}=${shConfigDir(a.root, home)}`, ...shEnvSets(a.env)];
    // the subshell ( … ) is what keeps every export local to the one command
    lines.push(`${a.name}() { ( export ${sets.join(' ')}; ${tool.bin} "$@" ); }`);
  }
  if (pairs.length) {
    lines.push('', '# Continue a session on another account when one hits its limit:');
    for (const p of pairs) {
      // Called by absolute path, not by name: ccmon installs the helper into
      // ~/.local/bin, which most Linux distros add to PATH but macOS does NOT
      // — a bare `claude-cross-resume` there is a command-not-found. `$HOME`
      // keeps the generated file host-independent either way.
      //
      // The DESTINATION's extra env is exported around the call: the helper
      // ends in an `exec` of the tool's resume command, which inherits it, so
      // resuming into an alternate-provider account (DeepSeek) keeps that
      // provider instead of silently falling back to Anthropic's endpoint.
      const sets = shEnvSets(p.to.env);
      const exports = sets.length ? `export ${sets.join(' ')}; ` : '';
      lines.push(
        `${p.name}() { ( ${exports}"$HOME/.local/bin/${tool.helperName}" ${shConfigDir(p.from.root, home)} ${shConfigDir(p.to.root, home)} "$1" ); }`,
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
 * Swap ccmon's managed block for `block`, or append it when absent. Returns
 * the text UNCHANGED when the block is already exactly right, so a caller can
 * use identity to decide whether anything needs writing at all.
 *
 * Replacement — rather than the old append-only behaviour — is what lets the
 * block's contents evolve. When Codex support added a second source line,
 * every already-linked user would otherwise have kept a block that loads only
 * the Claude wrappers: their Codex wrappers would be written and never
 * sourced, with no error anywhere to point at.
 *
 * Only the marker-delimited region is touched. Everything outside it is
 * preserved verbatim, in place — this is the one thing in the module that
 * rewrites a file ccmon did not create, so it stays as narrow as possible and
 * goes through `writeAtomic`.
 */
function upsertManagedBlock(text: string, block: string): string {
  const lines = text.split('\n');
  const range = managedBlockRange(lines);
  if (!range) {
    const lead = text && !text.endsWith('\n') ? '\n' : '';
    return `${text}${lead}\n${block}\n`;
  }
  const [start, end] = range;
  if (lines.slice(start, end).join('\n') === block) return text;
  return [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)].join('\n');
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
        out.push({
          name,
          line: i + 1,
          text: lines[i].trim(),
          canTidy: singleLineRe(name, family).test(lines[i]),
        });
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

/**
 * Write via temp-file + rename so a rewrite can never leave a truncated rc.
 *
 * The parent dir is created first for Windows: a POSIX rc always sits in
 * `$HOME`, but the PowerShell `$PROFILE` target is
 * `Documents\PowerShell\Microsoft.PowerShell_profile.ps1` and that directory
 * does not exist until a profile is created — writing straight into it fails
 * with ENOENT on a machine that has never had one. No-op everywhere else.
 */
function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.ccmon-tmp`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows fails the rename with EPERM/EBUSY while another process holds the
    // destination open — an editor or an antivirus scanner is enough, and it
    // never happens on Linux. Fall back to an in-place rewrite: strictly worse
    // (a crash mid-write could truncate) but the alternative is a setup that
    // just refuses to apply. POSIX errors still propagate untouched.
    const code = (e as NodeJS.ErrnoException).code;
    if (
      process.platform !== 'win32' ||
      (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')
    ) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      throw e;
    }
    fs.writeFileSync(file, content);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
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
          note: linked
            ? 'already linked'
            : exists
              ? 'your PowerShell profile'
              : 'profile would be created',
        },
      ],
    };
  }

  const mac = env.platform === 'darwin';
  const loginName = env.loginShell ? path.basename(env.loginShell) : '';
  const defs: Array<{ shell: 'zy' | 'zsh' | 'bash'; rc: string; alsoRc?: string }> = [
    { shell: 'zy', rc: '.zyrc' },
    { shell: 'zsh', rc: '.zshrc' },
    // macOS bash reads ~/.bash_profile at login, so that stays the write
    // target — but plenty of people keep their config in ~/.bashrc and source
    // it from there, so its presence still counts as "you run bash".
    { shell: 'bash', rc: mac ? '.bash_profile' : '.bashrc', alsoRc: mac ? '.bashrc' : undefined },
  ];
  const all = defs.map<ShellTarget & { inPlay: boolean }>((d) => {
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
        : exists
          ? 'rc present'
          : `~/${d.alsoRc} present · creates ~/${d.rc}`;
    const inPlay =
      detected || exists || (d.alsoRc ? fileExists(path.join(env.home, d.alsoRc)) : false);
    return { shell: d.shell, family: 'posix', rcPath, exists, detected, linked, note, inPlay };
  });
  // Only surface shells the user actually uses: the login shell, or any with
  // an rc file already present. A shell that's neither is just noise — we
  // don't offer to create configs for shells you don't run (e.g. zsh on a
  // machine with no ~/.zshrc).
  let shells: ShellTarget[] = all.filter((s) => s.inPlay).map(({ inPlay: _inPlay, ...s }) => s);
  // ...but never hand the UI an empty list. A fresh macOS account is exactly
  // that case: zsh is the login shell with no ~/.zshrc yet, and if the login
  // shell could not be resolved at all (see resolveLoginShell) nothing above
  // matches. Fall back to the platform's default shell so the wizard always
  // has a target, and say plainly that this is a guess.
  if (!shells.length) {
    const fallback = all.find((s) => s.shell === (mac ? 'zsh' : 'bash'))!;
    const { inPlay: _inPlay, ...target } = fallback;
    shells = [
      { ...target, note: `no login shell detected · creates ~/${path.basename(target.rcPath)}` },
    ];
  }
  return { platform: env.platform, shells };
}

/**
 * Substitute `${ccmon:<name>}` references in every account's env.
 *
 * Secrets ccmon already holds (the DeepSeek key) are stored encrypted and
 * readable only by the main process, so the wizard writes a reference and main
 * resolves it here — the token is never typed twice, never crosses IPC, and
 * never lands in `settings.json`. `resolve` returning null leaves the
 * reference in place, and `validateAccounts` then refuses to write it.
 *
 * Pure: returns new objects, mutates nothing.
 */
export function resolveEnvSecrets(
  accounts: AccountSpec[],
  resolve: (name: string) => string | null,
): AccountSpec[] {
  return accounts.map((a) => {
    if (!a.env) return a;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.env)) {
      env[k] = v.replace(SECRET_REF_RE, (whole, name: string) => resolve(name) ?? whole);
    }
    return { ...a, env };
  });
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A portable environment-variable name — the only shape both shells accept. */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * A tool's home env var (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) is derived from the
 * account's root, never taken from the env map: two sources for one variable
 * is a silent-mismatch bug waiting to happen, and the root is what every other
 * part of ccmon keys on.
 */
const RESERVED_ENV = new Set(TOOLS.map((t) => t.homeEnvVar));

/**
 * Validation problems with the account list itself (name format, dupes,
 * root). An empty list is valid here — it just means "no wrapper file
 * entries" — the full wizard flow additionally requires at least one.
 */
function validateAccounts(accounts: AccountSpec[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const a of accounts) {
    if (!TOOLS.some((t) => t.id === a.tool)) problems.push(`"${a.name}" has an unknown tool`);
    if (!NAME_RE.test(a.name)) problems.push(`invalid wrapper name "${a.name}"`);
    if (seen.has(a.name)) problems.push(`duplicate wrapper name "${a.name}"`);
    seen.add(a.name);
    if (!a.root || !path.isAbsolute(a.root)) problems.push(`"${a.name}" has no config dir`);
    for (const [k, v] of Object.entries(a.env ?? {})) {
      if (!ENV_NAME_RE.test(k))
        problems.push(`"${a.name}": invalid environment variable name "${k}"`);
      else if (RESERVED_ENV.has(k))
        problems.push(`"${a.name}": ${k} comes from the config dir — remove it`);
      // Both generators emit fully-literal quoting, so a value can hold
      // anything printable; a newline is the one thing that would break out of
      // the single line it is written on.
      if (/[\r\n]/.test(v)) problems.push(`"${a.name}": ${k} must not contain a line break`);
      // an unresolved reference would be written verbatim and the wrapper would
      // send the literal string as a token — fail loudly instead
      for (const m of v.matchAll(SECRET_REF_RE)) {
        problems.push(
          `"${a.name}": ${k} references the ${m[1].replace(/-/g, ' ')} ccmon does not have — ` +
            'connect it in the DeepSeek panel, or paste a token here',
        );
      }
    }
  }
  return problems;
}

/** Validation problems that must block a full apply (accounts + rc selection). */
function validate(opts: SetupOptions): string[] {
  const problems = validateAccounts(opts.accounts);
  if (!opts.accounts.length) problems.push('no accounts to set up');
  if (!opts.rcPaths.length) problems.push('pick at least one shell to link');
  return problems;
}

/** Dry-run: exactly what an apply would write, with nothing written. */
export function planSetup(opts: SetupOptions, env: SetupEnv = defaultEnv()): SetupPlan {
  const { home } = env;
  const family = familyOf(env.platform);
  const block = rcSourceBlock(family);
  const helperDest = helperPath(home, family);
  const names = managedNames(opts.accounts);
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
              (manual
                ? `; ${manual} multi-line def${manual === 1 ? '' : 's'} need manual removal`
                : '')
            : `they'd be shadowed by the managed file (identical → harmless). Enable tidy to comment them out`),
      );
    }
    // A STALE block still needs writing, so the preview must show it rather
    // than reporting "already linked" while apply quietly rewrites the file.
    const current = fileText(rcPath) ?? '';
    const changes = upsertManagedBlock(current, block) !== current;
    return {
      rcPath,
      alreadyLinked,
      blockToAdd: changes ? block : '',
      blockReplaces: alreadyLinked && changes,
      existing,
    };
  });

  if (family === 'powershell' && opts.installHelper) {
    // PowerShell blocks unsigned scripts under the default machine policy, and
    // the wizard cannot change that for the user — say so before they rely on it.
    warnings.push(
      'cross-resume runs a PowerShell script: if it is blocked, allow local scripts once with ' +
        'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned',
    );
  }

  // one file per tool that actually has accounts; the rest are removed on apply
  const managed = TOOLS.filter((t) => opts.accounts.some((a) => a.tool === t.id)).map((t) => ({
    tool: t.id,
    path: managedScriptPath(t, home, family),
    script: renderManagedScript(opts.accounts, home, family, t.id),
  }));

  return {
    managed,
    rcEdits,
    helperDest,
    helperInstalled: fileEquals(helperDest, helperScript(family)),
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
    return {
      ok: false,
      wroteManaged: false,
      linkedRc: [],
      tidiedRc: [],
      helperInstalled: false,
      reloadHint: '',
      errors: problems,
    };
  }
  const { home } = env;
  const family = familyOf(env.platform);
  const errors: string[] = [];

  let wroteManaged = false;
  for (const tool of TOOLS) {
    const dest = managedScriptPath(tool, home, family);
    const inUse = opts.accounts.some((a) => a.tool === tool.id);
    try {
      if (!inUse) {
        // deleting your last account of a tool cleans up after itself, rather
        // than leaving a stale file the rc block keeps sourcing
        fs.rmSync(dest, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // 0600: an account's env may carry a provider API token, and this file is
      // only ever read by the user's own shell.
      fs.writeFileSync(dest, renderManagedScript(opts.accounts, home, family, tool.id), {
        mode: 0o600,
      });
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o600); // umask cannot loosen it
      wroteManaged = true;
    } catch (e) {
      errors.push(`managed file (${tool.id}): ${msg(e)}`);
    }
  }

  const names = managedNames(opts.accounts);
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

      // append when absent, replace when stale, no-op when already current
      const withBlock = upsertManagedBlock(body, block);
      if (withBlock !== body) {
        body = withBlock;
        mutated = true;
        linkedRc.push(rcPath);
      }

      if (mutated) writeAtomic(rcPath, body); // creates the rc if it was absent
    } catch (e) {
      errors.push(`${tilde(rcPath, home)}: ${msg(e)}`);
    }
  }

  // the cross-resume helper ships per family: a bash script for POSIX, a
  // PowerShell script for Windows. Both are idempotent (content-compared).
  let helperInstalled = false;
  if (opts.installHelper) {
    const dest = helperPath(home, family);
    const script = helperScript(family);
    try {
      if (!fileEquals(dest, script)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (family === 'powershell') {
          fs.writeFileSync(dest, script);
        } else {
          fs.writeFileSync(dest, script, { mode: 0o755 });
          fs.chmodSync(dest, 0o755); // writeFileSync mode is masked by umask — force it
        }
      }
      helperInstalled = true;
    } catch (e) {
      errors.push(`helper: ${msg(e)}`);
    }
  }

  // `source` is POSIX-only; PowerShell dot-sources with a bare `.`
  const sourceVerb = family === 'powershell' ? '.' : 'source';
  const reloadTargets = (linkedRc.length ? linkedRc : opts.rcPaths).map((p) => tilde(p, home));
  const reloadHint = reloadTargets.length
    ? `run: ${reloadTargets.map((t) => `${sourceVerb} ${t}`).join('   ')}  (or open a new terminal)`
    : 'open a new terminal to load the wrappers';

  return {
    ok: errors.length === 0,
    wroteManaged,
    linkedRc,
    tidiedRc,
    helperInstalled,
    reloadHint,
    errors,
  };
}

/**
 * Rewrite just the managed wrapper file for a rename or untrack — never
 * touches rc files or the cross-resume helper, since neither depends on
 * which accounts are in the wrapper. Used by the Accounts view's quick
 * rename / remove-from-shell controls, outside the full setup wizard flow.
 */
export function writeWrapperAccounts(
  accounts: AccountSpec[],
  env: SetupEnv = defaultEnv(),
): { ok: boolean; errors: string[] } {
  const problems = validateAccounts(accounts);
  if (problems.length) return { ok: false, errors: problems };
  const { home } = env;
  const family = familyOf(env.platform);
  const errors: string[] = [];
  for (const tool of TOOLS) {
    const dest = managedScriptPath(tool, home, family);
    try {
      if (!accounts.some((a) => a.tool === tool.id)) {
        fs.rmSync(dest, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, renderManagedScript(accounts, home, family, tool.id), { mode: 0o600 });
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o600);
    } catch (e) {
      errors.push(`managed file (${tool.id}): ${msg(e)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The source dirs ccmon should actually show, given every discovered dir and
 * the per-root prefs. Hiding is how an account is "removed": it drops out of
 * the grid, the scope picker, the limits poll and the snapshot, while nothing
 * on disk is touched and the shell wrapper is left exactly as it was.
 *
 * ccmon deliberately has no delete: an account root holds the OAuth
 * credentials AND every session transcript — the app's entire data source —
 * so removing one would be an irreversible `rm -rf` with no preview that
 * could make it safe. Every other write in this module is narrow and
 * reversible, and this stays in line with that.
 *
 * Hiding everything is refused: an empty source list would leave the app with
 * nothing to render and no obvious way back, so a prefs file that would do
 * that (hand-edited, or an account list that shrank) falls back to showing
 * all of them.
 */
export function visibleAccountDirs(
  dirs: string[],
  prefs: Record<string, AccountWrapperPrefs> = {},
): string[] {
  const visible = dirs.filter((dir) => !prefs[path.dirname(dir)]?.hidden);
  return visible.length ? visible : dirs;
}

const SUFFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

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
  if (!SUFFIX_RE.test(clean)) {
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

/**
 * Rename a sibling account's config dir on disk: `~/.claude-<old>` →
 * `~/.claude-<suffix>`. The default `~/.claude` root is refused — Claude
 * Code's CLI (and anything else that doesn't go through a ccmon wrapper)
 * falls back to that literal path when `CLAUDE_CONFIG_DIR` isn't set, so
 * moving it would break tools outside ccmon's control. Live file-watching
 * of the new path needs an app relaunch, same as `createAccountDir`.
 */
export function renameAccountDir(
  root: string,
  suffix: string,
  env: SetupEnv = defaultEnv(),
): { ok: boolean; root: string; error?: string } {
  const { home } = env;
  if (root === path.join(home, '.claude')) {
    return { ok: false, root, error: "can't rename the default ~/.claude account" };
  }
  const clean = suffix.trim().replace(/^[.\s]+/, '');
  if (!SUFFIX_RE.test(clean)) {
    return { ok: false, root, error: 'use letters, digits, dash or underscore' };
  }
  const newRoot = path.join(home, `.claude-${clean}`);
  if (newRoot === root) return { ok: true, root };
  if (!fs.existsSync(root)) return { ok: false, root, error: 'account folder not found' };
  if (fs.existsSync(newRoot)) {
    return { ok: false, root, error: `~/.claude-${clean} already exists` };
  }
  try {
    fs.renameSync(root, newRoot);
    return { ok: true, root: newRoot };
  } catch (e) {
    return { ok: false, root, error: msg(e) };
  }
}
