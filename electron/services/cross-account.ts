/**
 * @file cross-account.ts
 * @brief Recent-session discovery for cross-account resume (continue a session on the other account).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type { RecentSession } from '../../shared/types';

/**
 * Cross-account resume mechanics (mirrors the shell `claude-cross-resume`
 * helper, but read-only): a session transcript lives at
 * `<root>/projects/<encoded-cwd>/<id>.jsonl`. To continue it on another
 * account you copy that file into the other root and relaunch
 * `claude --resume <id>` from the original `cwd`. ccmon never copies or
 * launches anything — it only surfaces the most recent resumable sessions so
 * the user can run their own wrapper. This module just reads.
 */

const HEAD_BYTES = 64 * 1024; // enough to reach a line carrying `cwd`
const MAX_DEPTH = 6; // transcripts nest (subagents/workflows) but not deeply

/** Read the first `cwd` out of a transcript without loading the whole file. */
function firstCwd(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const d = JSON.parse(t) as { cwd?: unknown };
        if (typeof d.cwd === 'string' && d.cwd) return d.cwd;
      } catch {
        /* truncated trailing line in the 64KB head — ignore */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

/** Collect every `*.jsonl` under `dir` (recursive, depth-capped). */
function walkJsonl(dir: string, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

/**
 * The most recent resumable sessions under a `<root>/projects` dir, newest
 * first. Deduped by session id (keeping the newest transcript per id). `cwd`
 * may be null when the transcript head carries none — such a session can
 * still be shown, just not auto-`cd`-ed on resume.
 */
export function recentSessions(projectsDir: string, limit = 8): RecentSession[] {
  const files: string[] = [];
  walkJsonl(projectsDir, files);

  const byId = new Map<string, RecentSession>();
  for (const file of files) {
    const id = path.basename(file, '.jsonl');
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const prev = byId.get(id);
    if (prev && prev.mtime >= mtime) continue;
    const cwd = firstCwd(file);
    const project = cwd
      ? cwd.split('/').filter(Boolean).pop() || cwd
      : path.basename(path.dirname(file));
    byId.set(id, { id, cwd, project, mtime });
  }

  return [...byId.values()].sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(0, limit));
}
