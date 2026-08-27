/**
 * @file sessions.ts
 * @brief Which coding-CLI sessions are running right now, per account.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { toolForRoot } from '../../../shared/tools';
import type { LiveSession } from '../../../shared/types';

/**
 * Both tools already track their own running sessions on disk — this reads
 * that, rather than inventing a heuristic from file mtimes.
 *
 *   Claude Code  `<root>/sessions/<pid>.json`  — a registry per process, with
 *                `pid`, `sessionId`, `cwd`, `kind` and a live `status`
 *                (busy | idle) the CLI keeps updated.
 *   Codex        `<home>/thread-writer-locks/<session-id>.lock` — one lock
 *                file per running session, removed on exit.
 *
 * Neither is documented, so both are read defensively: an unreadable or
 * unexpected file yields nothing rather than throwing, and the count simply
 * reads low. Showing one session fewer is a small wrong; taking down the
 * accounts view is not.
 */

/**
 * Process start time in clock ticks, from `/proc/<pid>/stat` field 22.
 *
 * Linux only, and that is fine — it is a REFINEMENT, not the liveness test.
 * `comm` (field 2) can itself contain spaces and parentheses, so the fields
 * are taken from after the LAST `)` rather than by splitting the whole line.
 */
function procStartTicks(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return rest[19] ?? null; // field 22 counting from 1
  } catch {
    return null;
  }
}

/**
 * Is this pid still the process that wrote the record?
 *
 * `process.kill(pid, 0)` is the portable liveness probe — it sends no signal
 * and throws ESRCH when the process is gone — and it is the whole test on
 * macOS and Windows. On Linux we additionally compare the recorded start time,
 * which is what rules out a REUSED pid: a long-dead session whose number has
 * come around again would otherwise be reported as running.
 *
 * EPERM means the pid exists but belongs to another user, so it is alive.
 */
function pidAlive(pid: number, procStart: string | null | undefined): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  if (procStart) {
    const now = procStartTicks(pid);
    // only decide against it when we could actually read a start time
    if (now != null && now !== String(procStart)) return false;
  }
  return true;
}

interface ClaudeSessionFile {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  startedAt?: number;
  procStart?: string;
  kind?: string;
  status?: string;
  name?: string;
  updatedAt?: number;
}

function claudeSessions(root: string): LiveSession[] {
  const dir = path.join(root, 'sessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // no registry — an older CLI, or this account has never run
  }
  const out: LiveSession[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue; // `.key` files sit alongside
    let j: ClaudeSessionFile;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ClaudeSessionFile;
    } catch {
      continue;
    }
    if (typeof j.pid !== 'number' || !pidAlive(j.pid, j.procStart)) continue;
    out.push({
      id: j.sessionId ?? String(j.pid),
      cwd: j.cwd ?? null,
      startedAt: typeof j.startedAt === 'number' ? j.startedAt : null,
      // 'busy' | 'idle' as the CLI reports it; null when it says nothing
      status: j.status === 'busy' || j.status === 'idle' ? j.status : null,
      label: j.name ?? null,
    });
  }
  return out;
}

function codexSessions(home: string): LiveSession[] {
  const dir = path.join(home, 'thread-writer-locks');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const name of names) {
    // `.coordination.lock` is Codex's own cross-process lock, not a session
    if (!name.endsWith('.lock') || name.startsWith('.')) continue;
    const id = name.slice(0, -'.lock'.length);
    let startedAt: number | null = null;
    try {
      startedAt = fs.statSync(path.join(dir, name)).mtimeMs;
    } catch {
      /* raced with the session exiting — still counts as seen */
    }
    out.push({ id, cwd: null, startedAt, status: null, label: null });
  }
  return out;
}

/**
 * Sessions running right now under this account root.
 *
 * Codex's lock file is presence-only: a crashed session can leave one behind,
 * so its count is an upper bound. Claude's is pid-checked and therefore exact.
 */
export function liveSessions(root: string): LiveSession[] {
  return toolForRoot(root).id === 'codex' ? codexSessions(root) : claudeSessions(root);
}
