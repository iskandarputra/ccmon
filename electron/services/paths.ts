/**
 * @file paths.ts
 * @brief Claude Code data-root discovery across standard and configured locations.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Expand a leading `~` to the home directory. Shells don't expand `~` inside
 * quotes, so `CLAUDE_CONFIG_DIR="~/.claude"` arrives here literally.
 */
export function expandHome(p: string): string {
  const home = os.homedir();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

/**
 * Split a comma-separated path list, trimming and dropping empties.
 * Claude Code itself accepts a list in `CLAUDE_CONFIG_DIR` (so a user can
 * combine a current profile with an archive), and a single path is just a
 * list of one — so this is safe for both shapes.
 */
export function splitPathList(raw: string | undefined | null): string[] {
  return (raw || '')
    .split(',')
    .map((p) => expandHome(p.trim()))
    .filter((p) => p.length > 0);
}

/** Candidate Claude Code config roots, ordered by precedence. */
export function candidateRoots(): string[] {
  const roots: string[] = [];
  const home = os.homedir();
  roots.push(...splitPathList(process.env.CLAUDE_CONFIG_DIR));
  roots.push(path.join(home, '.claude'));
  // multi-account setups keep sibling roots like ~/.claude-work — pick up any
  // ~/.claude* directory; detectProjectDirs() drops ones without projects/
  try {
    const siblings = fs
      .readdirSync(home, { withFileTypes: true })
      .filter(
        (e) =>
          (e.isDirectory() || e.isSymbolicLink()) &&
          e.name.startsWith('.claude') &&
          e.name !== '.claude',
      )
      .map((e) => path.join(home, e.name))
      .sort();
    roots.push(...siblings);
  } catch {
    /* unreadable home dir — keep the static candidates */
  }
  roots.push(path.join(home, '.config', 'claude'));
  return roots;
}

/**
 * Resolve every existing `<root>/projects` directory (deduped, order kept).
 * `extra` lets ~/.config/ccmon/config.json add custom locations.
 */
export function detectProjectDirs(extra: string[] = []): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const raw of [...extra, ...candidateRoots()]) {
    if (!raw) continue;
    // `~` expansion is idempotent on absolute paths, so re-applying it to
    // already-expanded candidateRoots() entries is harmless.
    const root = expandHome(raw.trim());
    if (!root) continue;
    const p = path.resolve(root.endsWith('projects') ? root : path.join(root, 'projects'));
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      if (fs.statSync(p).isDirectory()) dirs.push(p);
    } catch {
      /* not present — skip */
    }
  }
  return dirs;
}

const rootCache = new Map<string, string>();

/**
 * Clear the project root resolution cache (useful for testing).
 */
export function clearProjectRootCache(): void {
  rootCache.clear();
}

/**
 * Pick the path FLAVOUR a stored path is written in, rather than the host's.
 *
 * A `cwd` in a transcript is DATA, not a path on this machine: a Windows
 * transcript carries `C:\repo\src`, a Linux one `/home/u/repo/src`, and the
 * same file can be read on either OS. Running a POSIX path through the win32
 * `path` module rewrites `/p/alpha` to `\p\alpha`, which silently changes the
 * project key everything groups, labels and exports by — so the flavour has to
 * follow the string, not `process.platform`.
 */
function flavourFor(p: string): path.PlatformPath {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.includes('\\') ? path.win32 : path.posix;
}

/**
 * Resolve the canonical repository / project root for a given working directory path.
 *
 * When developers run Claude Code in subfolders (e.g. `repo/backend`, `repo/frontend`,
 * `repo/docs`), or when tool commands `cd` into subdirectories during turns, the raw
 * transcript `cwd` reflects the subfolder. This function detects the enclosing `.git`
 * repository root or worktree parent so sessions and turns in the same repo roll up
 * cohesively into a single unified project in the Project Explorer and Session Explorer.
 *
 * The `.git` probe only ever succeeds for paths that exist on THIS machine; for a
 * path from another OS the walk finds nothing and the normalised path comes back
 * unchanged, which is the right answer rather than an error.
 */
export function resolveProjectRoot(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return rawPath;
  const cached = rootCache.get(rawPath);
  if (cached !== undefined) return cached;

  const pp = flavourFor(rawPath);
  let p = pp.normalize(rawPath);

  // If inside a worktree (e.g. .../.claude/worktrees/wf_123 or .../.worktrees/feature),
  // collapse to main repo root. The markers are built from the flavour's separator —
  // hardcoded '/' never matched a Windows path and left the collapse dead there.
  const claudeWtIdx = p.indexOf(`${pp.sep}.claude${pp.sep}worktrees`);
  if (claudeWtIdx !== -1) {
    p = p.slice(0, claudeWtIdx);
  } else {
    const wtIdx = p.indexOf(`${pp.sep}.worktrees`);
    if (wtIdx !== -1) {
      p = p.slice(0, wtIdx);
    }
  }

  const home = os.homedir();
  // Relative paths are resolved against this process; absolute ones are already
  // canonical in their own flavour and must not be re-rooted onto the host drive.
  let current = pp.isAbsolute(p) ? p : path.resolve(p);

  // Walk up checking for .git (directory or worktree file). `dirname` is a fixed
  // point at the root, which terminates the walk for both `/` and `C:\`.
  while (current && current !== home && current !== pp.dirname(current)) {
    try {
      const gitPath = pp.join(current, '.git');
      if (fs.existsSync(gitPath)) {
        rootCache.set(rawPath, current);
        return current;
      }
    } catch {
      /* inaccessible folder — stop upward traversal */
      break;
    }
    current = pp.dirname(current);
  }

  rootCache.set(rawPath, p);
  return p;
}
