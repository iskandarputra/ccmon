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
 * Resolve the canonical repository / project root for a given working directory path.
 *
 * When developers run Claude Code in subfolders (e.g. `repo/backend`, `repo/frontend`,
 * `repo/docs`), or when tool commands `cd` into subdirectories during turns, the raw
 * transcript `cwd` reflects the subfolder. This function detects the enclosing `.git`
 * repository root or worktree parent so sessions and turns in the same repo roll up
 * cohesively into a single unified project in the Project Explorer and Session Explorer.
 */
export function resolveProjectRoot(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return rawPath;
  const cached = rootCache.get(rawPath);
  if (cached !== undefined) return cached;

  let p = path.normalize(rawPath);

  // If inside a worktree (e.g. .../.claude/worktrees/wf_123 or .../.worktrees/feature), collapse to main repo root
  const claudeWtIdx = p.indexOf('/.claude/worktrees');
  if (claudeWtIdx !== -1) {
    p = p.slice(0, claudeWtIdx);
  } else {
    const wtIdx = p.indexOf('/.worktrees');
    if (wtIdx !== -1) {
      p = p.slice(0, wtIdx);
    }
  }

  const home = os.homedir();
  let current = path.resolve(p);

  // Walk up checking for .git (directory or worktree file)
  while (current && current !== '/' && current !== home && current !== path.dirname(current)) {
    try {
      const gitPath = path.join(current, '.git');
      if (fs.existsSync(gitPath)) {
        rootCache.set(rawPath, current);
        return current;
      }
    } catch {
      /* inaccessible folder — stop upward traversal */
      break;
    }
    current = path.dirname(current);
  }

  rootCache.set(rawPath, p);
  return p;
}
