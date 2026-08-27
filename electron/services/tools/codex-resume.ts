/**
 * @file codex-resume.ts
 * @brief The embedded codex-cross-resume helper scripts (bash + PowerShell).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * The Codex twin of `claude-cross-resume`, embedded so the packaged app stays
 * self-contained. Same contract, same flags, same overwrite policy.
 *
 * Three things differ from the Claude twin, all forced by the format:
 *
 *   1. THE ID IS INSIDE THE FILENAME. A rollout is
 *      `rollout-<timestamp>-<uuid>.jsonl`, so the session id cannot be taken
 *      from the basename the way a Claude transcript's can.
 *   2. THE DESTINATION IS DATE-NESTED. Rollouts live under
 *      `sessions/YYYY/MM/DD/`, and `codex resume` will not find a session
 *      copied into a flat `sessions/`. The path relative to the sessions root
 *      has to be preserved.
 *   3. ARCHIVED SESSIONS ARE RESUMABLE. A rollout found under
 *      `archived_sessions/` is restored into the DESTINATION's `sessions/` —
 *      resuming an archived session is precisely un-archiving it.
 *
 * Escaping note: these are JS template literals, so every `${` a shell needs
 * is written `\${`. The scripts deliberately use `$( )` and avoid backticks
 * entirely so that is the ONLY escape in play. Verify changes with
 * `bash -n` / the PowerShell parser rather than by eye.
 */

export const CODEX_HELPER_SCRIPT = `#!/usr/bin/env bash
#
# codex-cross-resume — continue a Codex session under a different CODEX_HOME.
# Installed by ccmon. See the Claude twin at ~/.local/bin/claude-cross-resume.
#
# Copies a rollout log from one Codex home into another, preserving its
# sessions/YYYY/MM/DD/ path, reads the original working directory out of the
# session_meta line, then re-launches "codex resume <uuid>" there with
# CODEX_HOME pointed at the destination.
#
# Overwrite policy (identical to the Claude twin)
#   A resumed session only ever APPENDS to its rollout, so line count is a
#   reliable "which side is newer" signal.
#     - destination missing   -> copy
#     - source has MORE lines -> overwrite (destination backed up first)
#     - source has <= lines   -> keep destination (same-or-newer)
#   --force overwrites regardless; --keep never touches an existing
#   destination. Any overwrite backs the destination up to a timestamped
#   *.bak first, so nothing is lost.
#
# Usage: codex-cross-resume [--force|--keep|--dry-run|--no-launch] \\
#            <src-codex-home> <dst-codex-home> <session-uuid>

set -euo pipefail

readonly PROG=$(basename "$0")

usage() {
    cat <<EOF
$PROG — continue a Codex session under a different CODEX_HOME.

Usage:
  $PROG [options] <src-codex-home> <dst-codex-home> <session-uuid>

Options:
  -f, --force        Overwrite an existing destination rollout even if it is
                     same-or-newer (the old copy is still backed up).
      --keep         Never overwrite an existing destination (strict).
  -n, --dry-run      Report what would happen; copy nothing and do not launch.
      --no-launch    Copy as normal but do not exec "codex resume".
  -h, --help         Show this help and exit.

Default (no -f/--keep): overwrite only when the source has more lines than the
destination — a resumed session only appends, so more lines == newer.
EOF
}

log()  { printf '%s\\n' "$*" >&2; }
die()  { printf '%s: %s\\n' "$PROG" "$1" >&2; exit "\${2:-1}"; }

force=0
keep=0
dry_run=0
launch=1
positional=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f | --force)   force=1 ;;
        --keep)         keep=1 ;;
        -n | --dry-run) dry_run=1 ;;
        --no-launch)    launch=0 ;;
        -h | --help)    usage; exit 0 ;;
        --)             shift; while [[ $# -gt 0 ]]; do positional+=("$1"); shift; done; break ;;
        -*)             die "unknown option: $1" 64 ;;
        *)              positional+=("$1") ;;
    esac
    shift
done

src="\${positional[0]:-}"
dst="\${positional[1]:-}"
id="\${positional[2]:-}"

[[ -n $src && -n $dst && -n $id ]] || { usage >&2; exit 64; }
[[ $force -eq 1 && $keep -eq 1 ]] && die "--force and --keep are mutually exclusive" 64
[[ -d $src ]] || die "source Codex home not found: $src" 66
[[ -d $dst ]] || die "destination Codex home not found: $dst" 66

# The id is embedded in the filename, not the basename. Look under sessions/
# first, then archived_sessions/ — resuming an archived rollout un-archives it.
src_file=""
src_base=""
for base in sessions archived_sessions; do
    [[ -d "$src/$base" ]] || continue
    found=$(find "$src/$base" -name "rollout-*-\${id}.jsonl" -type f 2>/dev/null | head -1)
    if [[ -n $found ]]; then
        src_file="$found"
        src_base="$base"
        break
    fi
done
[[ -n $src_file ]] || die "session $id not found under $src/sessions or $src/archived_sessions" 66

# Preserve the YYYY/MM/DD/ path relative to the base dir: codex resume looks a
# session up by its date-nested location, so a flat copy is never found.
rel="\${src_file#$src/$src_base/}"
dst_file="$dst/sessions/$rel"
dst_dir=$(dirname "$dst_file")

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
        log "[dry-run] would copy rollout -> $dst_file ($(lines "$src_file") lines)"
        return
    fi
    mkdir -p "$dst_dir"
    if [[ -e $dst_file ]]; then
        local bak; bak=$(backup_path)
        cp -p "$dst_file" "$bak"
        log "backed up existing destination -> $bak"
    fi
    cp "$src_file" "$dst_file"
    echo "copied rollout -> $dst_file ($(lines "$src_file") lines)"
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
# Line 1 of a rollout is a session_meta event carrying cwd. node first: macOS
# ships no python3 until the command line tools are installed, and node is what
# ran ccmon in the first place.
cwd=""
read_cwd_node() {
    node -e '
const fs = require("fs");
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\\n")) {
  if (!line) continue;
  try {
    const d = JSON.parse(line);
    const p = (d && d.payload) || d;
    if (p && p.cwd) { process.stdout.write(p.cwd); break; }
  } catch {}
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
    p = d.get("payload", d) if isinstance(d, dict) else None
    if isinstance(p, dict) and p.get("cwd"):
        print(p["cwd"]); break
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
    log "  cd '\${cwd:-<project dir>}' && CODEX_HOME='$dst' codex resume $id"
    exit 0
fi

if [[ -n $cwd && -d $cwd ]]; then
    cd "$cwd"
    export CODEX_HOME="$dst"
    exec codex resume "$id"
fi

cat >&2 <<EOF
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  CODEX_HOME='$dst' codex resume $id
EOF
exit 1
`;

/**
 * The Windows port of the helper above — same contract, same overwrite policy,
 * PowerShell 5.1-compatible (no ternary, no null-coalescing: Windows ships 5.1,
 * and a script that only parses under pwsh 7 would be useless on a stock box).
 *
 * Reading `cwd` needs no external interpreter here: ConvertFrom-Json is built
 * in, which is the one thing the bash version has to shell out to node for.
 */
export const CODEX_PS_HELPER_SCRIPT = `# codex-cross-resume.ps1 — continue a Codex session under a different CODEX_HOME.
# Installed by ccmon. See the POSIX twin at ~/.local/bin/codex-cross-resume.
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
if (-not (Test-Path -LiteralPath $Src -PathType Container)) { Fail "source Codex home not found: $Src" }
if (-not (Test-Path -LiteralPath $Dst -PathType Container)) { Fail "destination Codex home not found: $Dst" }

# The id is inside the filename, not the basename. sessions/ first, then
# archived_sessions/ — resuming an archived rollout un-archives it.
$srcFile = $null
$srcBase = $null
foreach ($base in @('sessions', 'archived_sessions')) {
    $dir = Join-Path $Src $base
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    $hit = Get-ChildItem -LiteralPath $dir -Filter "rollout-*-$Id.jsonl" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $srcFile = $hit; $srcBase = $base; break }
}
if (-not $srcFile) { Fail "session $Id not found under $Src\\sessions or $Src\\archived_sessions" }

# Preserve the YYYY\\MM\\DD path relative to the base dir: codex resume looks a
# session up by its date-nested location, so a flat copy is never found.
$baseDir = (Resolve-Path -LiteralPath (Join-Path $Src $srcBase)).Path
$rel     = $srcFile.FullName.Substring($baseDir.Length).TrimStart('\\', '/')
$dstFile = Join-Path (Join-Path $Dst 'sessions') $rel
$dstDir  = Split-Path -Parent $dstFile

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
        Note "[dry-run] would copy rollout -> $dstFile ($(LineCount $srcFile.FullName) lines)"
        return
    }
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    if (Test-Path -LiteralPath $dstFile) {
        $bak = BackupPath
        Copy-Item -LiteralPath $dstFile -Destination $bak
        Note "backed up existing destination -> $bak"
    }
    Copy-Item -LiteralPath $srcFile.FullName -Destination $dstFile
    Write-Host "copied rollout -> $dstFile ($(LineCount $srcFile.FullName) lines)"
}

if (-not (Test-Path -LiteralPath $dstFile)) {
    DoCopy
} elseif ($Keep) {
    Note 'note: destination exists — keeping it (-Keep)'
} elseif ($Force) {
    Note 'overwriting destination (-Force)'
    DoCopy
} else {
    $srcLines = LineCount $srcFile.FullName
    $dstLines = LineCount $dstFile
    if ($srcLines -gt $dstLines) {
        Note "source is newer ($srcLines > $dstLines lines) — overwriting"
        DoCopy
    } else {
        Note "note: destination is same-or-newer ($dstLines >= $srcLines lines) — keeping it; use -Force to override"
    }
}

# --- locate the original working directory ----------------------------------
# Line 1 of a rollout is a session_meta event carrying cwd.
$cwd = ''
foreach ($line in (Get-Content -LiteralPath $srcFile.FullName -ErrorAction SilentlyContinue)) {
    if (-not $line) { continue }
    try { $d = $line | ConvertFrom-Json } catch { continue }
    $p = $d
    if ($d.PSObject.Properties.Name -contains 'payload') { $p = $d.payload }
    if ($p -and $p.PSObject.Properties.Name -contains 'cwd' -and $p.cwd) { $cwd = $p.cwd; break }
}

# --- launch (or explain how to) ---------------------------------------------
if ($DryRun -or $NoLaunch) {
    $reason = '-NoLaunch'
    if ($DryRun) { $reason = 'dry-run' }
    Note "[$reason] not launching. To resume manually:"
    $where = '<project dir>'
    if ($cwd) { $where = $cwd }
    Note "  cd '$where'; \\$env:CODEX_HOME = '$Dst'; codex resume $Id"
    exit 0
}

if ($cwd -and (Test-Path -LiteralPath $cwd -PathType Container)) {
    Set-Location -LiteralPath $cwd
    $env:CODEX_HOME = $Dst
    & codex resume $Id
    exit $LASTEXITCODE
}

Write-Error @"
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  \\$env:CODEX_HOME = '$Dst'; codex resume $Id
"@ -ErrorAction Continue
exit 1
`;
