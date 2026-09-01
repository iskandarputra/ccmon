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

/**
 * Is ANY Codex process running on this machine?
 *
 *   true  — at least one; a lock file may well be genuine
 *   false — none at all; every lock file is therefore stale
 *   null  — cannot tell (not Linux, or /proc unreadable)
 *
 * Codex's writer lock is an EMPTY file, so unlike Claude's registry it carries
 * no pid to probe. But "no Codex is running" is enough on its own to condemn
 * every lock in the directory, and that is the case this exists for: a session
 * that crashed on 2026-08-27 left its lock behind and ccmon reported
 * "1 running" for the next five days.
 *
 * Linux only, and that is fine — it is a REFINEMENT, exactly like
 * `procStartTicks` above, not the liveness test. Elsewhere it returns null and
 * the count stays presence-based.
 *
 * Deliberately NOT an flock probe. On Linux `flock(2)` and `fcntl(F_SETLK)`
 * locks occupy independent spaces — a file held with one does not block the
 * other — and Codex's `thread-store/src/local/writer_lock.rs` gives no
 * guarantee which it uses. Guessing wrong would report ZERO sessions while one
 * was genuinely running, which is a worse error than the stale lock, and Node
 * cannot take an fcntl lock without a native module this project forbids.
 */
function codexProcessRunning(): boolean | null {
  if (process.platform !== 'linux') return null;
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  let sawProcess = false;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    sawProcess = true;
    // `comm` is the cheap check; it is truncated to 15 chars, which 'codex'
    // clears comfortably. A process that raced with us simply yields nothing.
    try {
      if (fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim() === 'codex') return true;
    } catch {
      continue;
    }
    // argv[0] as a fallback, for a renamed or wrapped binary
    try {
      const argv0 = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0')[0];
      if (argv0 && path.basename(argv0) === 'codex') return true;
    } catch {
      /* nothing more to try for this pid */
    }
  }
  // No numeric entries at all means /proc is not what we think it is.
  return sawProcess ? false : null;
}

function codexSessions(home: string, codexRunning: boolean | null): LiveSession[] {
  // Every lock is stale when nothing is running — see codexProcessRunning().
  if (codexRunning === false) return [];

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

/** Injection seam — the tests drive the Codex process check directly. */
export interface SessionProbe {
  /** See codexProcessRunning(): true | false | null (unknowable). */
  codexRunning?: () => boolean | null;
}

/**
 * Sessions running right now under this account root.
 *
 * Claude's registry carries a pid, so its count is exact. Codex's lock file is
 * empty and presence-only, so its count remains an UPPER BOUND — with one
 * exception that matters in practice: when no Codex process is running at all,
 * every lock is provably stale and the count is zero. That single check is what
 * stops a crashed session from being reported as live indefinitely.
 *
 * The bound still holds the other way: two stale locks plus one live session
 * report three. Narrowing that needs a way to tie a lock to a pid, which the
 * empty lock file does not offer.
 */
export function liveSessions(root: string, probe: SessionProbe = {}): LiveSession[] {
  if (toolForRoot(root).id !== 'codex') return claudeSessions(root);
  return codexSessions(root, (probe.codexRunning ?? codexProcessRunning)());
}
