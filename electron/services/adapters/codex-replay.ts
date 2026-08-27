/**
 * @file codex-replay.ts
 * @brief Fork/subagent replay detection for Codex rollouts.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';

/**
 * A forked or spawned-subagent Codex rollout REPLAYS its parent's history
 * before recording its own first turn, and Codex REWRITES those replayed
 * events to the fork instant.
 *
 * That rewrite is precisely what defeats a content-addressed dedupe key: the
 * token counts are identical to the parent's but the timestamp is not, so the
 * keys never collide and the parent's entire history bills a second time.
 * Matching therefore compares TOKEN VALUES and ignores timestamps — the same
 * choice ccusage makes, and the reason its state machine works at all.
 *
 * Two anchors, in order of trust:
 *
 *   1. THE PARENT'S OWN STREAM. `session_meta` names the parent
 *      (`forked_from_id`, or `source.subagent.thread_spawn.parent_thread_id`),
 *      and the parent's rollout is found by the uuid embedded in its filename.
 *      Skip the child's leading events while they match the parent's, in order.
 *   2. THE REWRITTEN BURST. When the parent is unavailable — pruned, or on a
 *      machine ccmon never scanned — the replay still has a shape: Codex
 *      writes it in one go (bursts measured upstream at 10–40 ms) and the
 *      child's own first turn follows a real pause (5.8–15.3 s). A one-second
 *      gap sits two orders of magnitude above the burst and well below the
 *      pause.
 *
 * Both are gated on the session DECLARING a parent. A rollout that forked from
 * nothing is never subjected to the burst heuristic: two quick turns in a row
 * are ordinary, and skipping them would silently delete real usage.
 */

/** The token shape a replay match compares. Timestamps are deliberately absent. */
export interface ReplayUsage {
  in: number;
  cached: number;
  out: number;
}

export type ReplayState =
  /** haven't seen a usage event yet — the anchor is resolved lazily */
  | { kind: 'idle' }
  /** comparing the child's leading usage against the parent's, in order */
  | { kind: 'matching'; prefix: ReplayUsage[]; index: number }
  /** no usable parent stream: skip the burst Codex wrote at the fork instant */
  | { kind: 'burst'; prevTs: number }
  /** past the replayed history — every remaining event is the child's own */
  | { kind: 'done' };

/** What `session_meta` says about where this rollout came from. */
export interface ForkInfo {
  parentId: string;
  /** epoch ms of the fork, from the session_meta timestamp */
  forkedAt: number | null;
}

interface SessionMetaPayload {
  id?: unknown;
  session_id?: unknown;
  forked_from_id?: unknown;
  source?: { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } };
}

/**
 * Read the fork declaration out of a parsed `session_meta` line, or null when
 * the session forked from nothing.
 *
 * A session naming ITSELF as its parent is treated as no fork: it would
 * otherwise match its whole stream against itself and drop every event it
 * recorded.
 */
export function forkInfoFrom(
  payload: SessionMetaPayload | undefined,
  timestamp: string | undefined,
): ForkInfo | null {
  if (!payload) return null;
  const raw =
    payload.forked_from_id ?? payload.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
  if (typeof raw !== 'string' || !raw) return null;
  const self = payload.id ?? payload.session_id;
  if (typeof self === 'string' && self === raw) return null;
  const ts = Date.parse(timestamp ?? '');
  return { parentId: raw, forkedAt: Number.isFinite(ts) ? ts : null };
}

/** Codex writes a replayed history in one go; this is the pause that ends it. */
export const REWRITTEN_BURST_PAUSE_MS = 1_000;

/**
 * The rollout whose filename carries `sessionId`, searched under the Codex
 * home that contains `childFile`.
 *
 * The uuid is embedded in the name (`rollout-<ts>-<uuid>.jsonl`), so this is a
 * targeted lookup rather than a corpus scan: `sessions/` and
 * `archived_sessions/` of ONE home, and only for a rollout that declared a
 * parent. A child's own path gives the home — walk up out of the date
 * directories to whichever of the two base dirs it sits under.
 */
export function findRolloutById(childFile: string, sessionId: string): string | null {
  const home = codexHomeOf(childFile);
  if (!home) return null;
  const suffix = `-${sessionId}.jsonl`;
  for (const base of ['sessions', 'archived_sessions']) {
    const found = findFileEndingWith(path.join(home, base), suffix, 0);
    if (found) return found;
  }
  return null;
}

/** The Codex home above a rollout path, or null when it sits outside one. */
function codexHomeOf(file: string): string | null {
  let dir = path.dirname(file);
  // date nesting is YYYY/MM/DD, so the base is at most a few levels up; the
  // cap keeps a symlink loop or an unexpected layout from walking to /
  for (let i = 0; i < 8; i++) {
    const base = path.basename(dir);
    if (base === 'sessions' || base === 'archived_sessions') return path.dirname(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const MAX_DEPTH = 6;

function findFileEndingWith(dir: string, suffix: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFileEndingWith(p, suffix, depth + 1);
      if (hit) return hit;
    } else if (e.isFile() && e.name.endsWith(suffix)) {
      return p;
    }
  }
  return null;
}

interface RolloutUsageLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    info?: {
      last_token_usage?: Record<string, number>;
      total_token_usage?: Record<string, number>;
    };
  };
}

const num = (o: Record<string, number> | null | undefined, k: string): number =>
  o && typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : 0;

/**
 * The parent's usage events, in order, up to `forkedAt`.
 *
 * Usage the parent recorded AFTER the branch was never replayed into the
 * child, so including it would let a later parent turn mask a child turn that
 * happens to have the same token shape.
 *
 * Deltas are recovered exactly as the adapter recovers them, so the two sides
 * compare like with like: prefer `last_token_usage`, else subtract the running
 * total. A parent read here is a whole-file read, but it happens once per
 * forked child and only when one exists.
 */
export function readParentPrefix(file: string, forkedAt: number | null): ReplayUsage[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: ReplayUsage[] = [];
  let prev: Record<string, number> | null = null;
  for (const line of text.split('\n')) {
    if (!line || !line.includes('token_count')) continue;
    let d: RolloutUsageLine;
    try {
      d = JSON.parse(line) as RolloutUsageLine;
    } catch {
      continue;
    }
    if (d.type !== 'event_msg' || d.payload?.type !== 'token_count') continue;
    const info = d.payload.info;
    if (!info) continue;
    const ts = Date.parse(d.timestamp ?? '');
    if (forkedAt != null && Number.isFinite(ts) && ts > forkedAt) break;

    const total = info.total_token_usage ?? null;
    let delta: Record<string, number>;
    if (info.last_token_usage) {
      delta = info.last_token_usage;
    } else if (total) {
      delta = {
        input_tokens: Math.max(0, num(total, 'input_tokens') - num(prev, 'input_tokens')),
        cached_input_tokens: Math.max(
          0,
          num(total, 'cached_input_tokens') - num(prev, 'cached_input_tokens'),
        ),
        output_tokens: Math.max(0, num(total, 'output_tokens') - num(prev, 'output_tokens')),
      };
    } else {
      continue;
    }
    if (total) prev = total;

    const cached = num(delta, 'cached_input_tokens');
    const usage = {
      in: Math.max(0, num(delta, 'input_tokens') - cached),
      cached,
      out: num(delta, 'output_tokens'),
    };
    if (!usage.in && !usage.cached && !usage.out) continue; // a no-op tick
    out.push(usage);
  }
  return out;
}

/**
 * Start of the burst of replayed usage at the head of `file`, or null when it
 * opens with a real turn instead.
 *
 * A session whose first two usage events were written back to back replayed a
 * history it did not spend; one that pauses between them was recording its own
 * turns from the start. Only the head is read.
 */
export function detectRewrittenBurst(file: string): number | null {
  let text: string;
  try {
    // 64KB is far more than the handful of lines a burst head occupies
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.toString('utf8', 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  let first: number | null = null;
  for (const line of text.split('\n')) {
    if (!line || !line.includes('token_count')) continue;
    let d: RolloutUsageLine;
    try {
      d = JSON.parse(line) as RolloutUsageLine;
    } catch {
      continue;
    }
    if (d.type !== 'event_msg' || d.payload?.type !== 'token_count') continue;
    const info = d.payload.info;
    if (!info || (!info.last_token_usage && !info.total_token_usage)) continue;
    const ts = Date.parse(d.timestamp ?? '');
    if (!Number.isFinite(ts)) continue;
    if (first === null) {
      first = ts;
      continue;
    }
    return ts - first >= 0 && ts - first <= REWRITTEN_BURST_PAUSE_MS ? first : null;
  }
  return null;
}

/**
 * Advance the replay state for one usage event, and say whether to bill it.
 *
 * Pure apart from the lazy anchor resolution the caller performs first: by the
 * time this runs the state is already `matching`, `burst` or `done`.
 */
export function stepReplay(
  state: ReplayState,
  usage: ReplayUsage,
  ts: number,
): { state: ReplayState; skip: boolean } {
  let s = state;
  // Each branch either answers or advances toward `done`, so this loops at
  // most once more to apply the event to the state it switched to.
  for (;;) {
    if (s.kind === 'done' || s.kind === 'idle') return { state: s, skip: false };
    if (s.kind === 'matching') {
      const want = s.prefix[s.index];
      if (want && want.in === usage.in && want.cached === usage.cached && want.out === usage.out) {
        return { state: { kind: 'matching', prefix: s.prefix, index: s.index + 1 }, skip: true };
      }
      // Nothing matched, so the parent cannot anchor this replay: its log is
      // gone, or Codex rewrote the copied history into a different shape.
      // Only at the very first event is the burst fallback still meaningful.
      s = { kind: 'done' };
      continue;
    }
    // burst
    if (ts - s.prevTs >= 0 && ts - s.prevTs <= REWRITTEN_BURST_PAUSE_MS) {
      return { state: { kind: 'burst', prevTs: ts }, skip: true };
    }
    s = { kind: 'done' };
  }
}
