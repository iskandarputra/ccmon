/**
 * @file cross-account.ts
 * @brief Recent-session discovery for cross-account resume (continue a session on the other account).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { toolFor } from '../../shared/tools';
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
 * The most recent resumable Claude sessions under a `<root>/projects` dir,
 * newest first. Deduped by session id (keeping the newest transcript per id).
 * `cwd` may be null when the transcript head carries none — such a session can
 * still be shown, just not auto-`cd`-ed on resume.
 */
function claudeSessions(projectsDir: string, limit: number): RecentSession[] {
  const files: string[] = [];
  walkJsonl(projectsDir, files);

  const byId = new Map<string, RecentSession>();
  for (const file of files) {
    const id = path.basename(file, '.jsonl');
    // no initializer: every path either assigns or `continue`s, and letting
    // the checker enforce that is better than a 0 nobody reads
    let mtime: number;
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

/** Newest-first, deduped by id, capped at `limit`. Shared by both readers. */
const rank = (byId: Map<string, RecentSession>, limit: number): RecentSession[] =>
  [...byId.values()].sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(0, limit));

/**
 * The first `session_meta` payload in a rollout's head — `{id, cwd}` — or null.
 *
 * Codex writes this as line 1, so the 64KB head is far more than enough.
 */
function codexMeta(file: string): { id: string; cwd: string | null } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const d = JSON.parse(t) as {
          type?: unknown;
          payload?: { session_id?: unknown; cwd?: unknown };
        };
        if (d.type !== 'session_meta') continue;
        const id = d.payload?.session_id;
        if (typeof id !== 'string' || !id) return null;
        return { id, cwd: typeof d.payload?.cwd === 'string' ? d.payload.cwd : null };
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

/**
 * The most recent resumable Codex sessions under a `sessions/` or
 * `archived_sessions/` dir.
 *
 * BOTH of the Claude reader's assumptions are wrong here. A rollout is
 * `rollout-<timestamp>-<uuid>.jsonl`, so the id is embedded in the filename
 * rather than being the basename — and it is read out of the file instead of
 * parsed out of the name, because the name's format is not a contract. `cwd`
 * lives on the `session_meta` line, not on "the first line that has one".
 */
function codexSessions(sessionsDir: string, limit: number): RecentSession[] {
  const files: string[] = [];
  walkJsonl(sessionsDir, files);

  const byId = new Map<string, RecentSession>();
  for (const file of files) {
    // `history.jsonl` and friends sit beside the rollouts and carry no session
    if (!path.basename(file).startsWith('rollout-')) continue;
    let mtime: number;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const meta = codexMeta(file);
    if (!meta) continue;
    // an archived copy and its live twin share an id — keep the newer
    const existing = byId.get(meta.id);
    if (existing && existing.mtime >= mtime) continue;
    const project = meta.cwd
      ? meta.cwd.split(/[\\/]/).filter(Boolean).pop() || meta.cwd
      : path.basename(path.dirname(file));
    byId.set(meta.id, { id: meta.id, cwd: meta.cwd, project, mtime });
  }

  return rank(byId, limit);
}

/**
 * The most recent resumable sessions under a source dir, newest first,
 * dispatched to the reader for that dir's tool.
 */
export function recentSessions(sourceDir: string, limit = 8): RecentSession[] {
  return toolFor(sourceDir).id === 'codex'
    ? codexSessions(sourceDir, limit)
    : claudeSessions(sourceDir, limit);
}
