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
    const p = path.resolve(
      root.endsWith('projects') ? root : path.join(root, 'projects'),
    );
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
