/**
 * @file paths.ts
 * @brief Claude Code data-root discovery across standard and configured locations.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Candidate Claude Code config roots, ordered by precedence. */
export function candidateRoots(): string[] {
  const roots: string[] = [];
  const home = os.homedir();
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(process.env.CLAUDE_CONFIG_DIR);
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
  for (const root of [...extra, ...candidateRoots()]) {
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
