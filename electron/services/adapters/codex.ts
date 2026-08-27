/**
 * @file codex.ts
 * @brief OpenAI Codex CLI source adapter — the second real format ccmon reads.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Codex writes rollout logs to `${CODEX_HOME:-~/.codex}/sessions/**\/*.jsonl`
 * (plus `archived_sessions/`). Its shape differs from Claude Code's in the two
 * ways that actually matter to the seam:
 *
 *   1. LINES ARE NOT SELF-DESCRIBING. A `token_count` event usually names its
 *      own model, but the authoritative one comes from an earlier
 *      `turn_context` line, and the speed tier only ever arrives on an earlier
 *      `thread_settings_applied`. Pricing a usage line therefore needs what
 *      came before it — which is why `SourceAdapter.createState` exists. It was
 *      added FOR this adapter, not designed in advance.
 *
 *   2. TOKENS ARE CUMULATIVE. `info.total_token_usage` is a running total for
 *      the session; `info.last_token_usage` is the turn delta. We prefer the
 *      delta and fall back to subtracting the previous total, which is the
 *      only correct reading for older rollouts that omit the delta.
 *
 * Token mapping (verified against ccusage's Codex adapter, which is the
 * reference implementation for this format):
 *
 *   in   = input_tokens − cached_input_tokens   (Codex's input INCLUDES cache)
 *   read = cached_input_tokens
 *   out  = output_tokens                        (reasoning already counted in)
 *   w5m / w1h = 0                               (Codex bills no cache writes)
 *
 * Getting `in` wrong is the easy mistake here: billing the raw `input_tokens`
 * would double-charge every cached prompt token, and on a long session the
 * cache is most of the input.
 *
 * KNOWN LIMITATION — long-context tiers. Codex prices requests above a context
 * threshold at a higher rate, and ccmon's pricing engine is flat per model, so
 * a very long Codex turn is priced slightly low. Tokens are unaffected; only
 * dollars are, and only for the models that have a long-context tier.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { dayKeyFor, type Zone } from '../../../shared/daykey';
import { splitPathList } from '../paths';
import type { ParsedLine } from '../../../shared/types';
import type { SourceAdapter } from './types';

/** Model billed when a rollout never records one (ccusage uses the same). */
const FALLBACK_MODEL = 'gpt-5';

/**
 * The literal model id Codex writes for an auto-review turn. It is not a real
 * model and no pricing catalog carries it, so billing the string as-is prices
 * every auto-review turn at $0.
 */
const AUTO_REVIEW_MODEL = 'codex-auto-review';

/**
 * Which model auto-review actually ran, by date — newest first.
 *
 * A dated table for the same reason `shared/plans.ts` is one: the mapping is
 * historical fact, not something any API will tell us, and re-dating it would
 * rewrite the past. Mirrors ccusage's `codex-auto-review-fallbacks.json`.
 */
const AUTO_REVIEW_FALLBACKS: ReadonlyArray<{ releasedOn: string; model: string }> = [
  { releasedOn: '2026-04-23', model: 'gpt-5.5' },
  { releasedOn: '2026-03-05', model: 'gpt-5.4' },
  { releasedOn: '2026-02-05', model: 'gpt-5.3-codex' },
  { releasedOn: '2025-12-11', model: 'gpt-5.2-codex' },
  { releasedOn: '2025-11-13', model: 'gpt-5.1-codex' },
  { releasedOn: '2025-09-15', model: 'gpt-5-codex' },
  { releasedOn: '2025-08-07', model: 'gpt-5' },
];

/**
 * Resolve `codex-auto-review` to the model that ran on `iso`'s date. Any other
 * model id passes through untouched.
 *
 * Compared as `YYYY-MM-DD` strings, which sort lexicographically — and taken
 * from the raw timestamp rather than a zoned day key, because the release
 * dates are upstream facts in UTC, not entries in the user's calendar.
 */
function resolveAutoReview(model: string, iso: string | undefined): string {
  if (model !== AUTO_REVIEW_MODEL) return model;
  const date = iso?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return FALLBACK_MODEL;
  return AUTO_REVIEW_FALLBACKS.find((f) => date >= f.releasedOn)?.model ?? FALLBACK_MODEL;
}

/** Cheap reject before `JSON.parse`, mirroring `parser.mayCarryData`. */
const LINE_MARKERS = ['token_count', 'turn_context', 'thread_settings_applied'] as const;
const LINE_MARKER_BYTES = LINE_MARKERS.map((m) => Buffer.from(m, 'ascii'));

interface RawUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

/** Per-file parse state — everything a usage line needs from its predecessors. */
export interface CodexState {
  /** latest `turn_context` model */
  model: string | null;
  /** latest working directory, for project attribution */
  cwd: string | null;
  /** latest recognized service tier; null = never stated, so unclassified */
  fast: boolean | null;
  /** last cumulative totals, for delta recovery when no `last_token_usage` */
  prevTotals: RawUsage | null;
}

const zero = (u: RawUsage | null | undefined, k: keyof RawUsage): number =>
  u && typeof u[k] === 'number' && Number.isFinite(u[k]) ? u[k] : 0;

/**
 * `service_tier` → ccmon's fast flag.
 *
 * `priority` is the current spelling and `fast` the legacy one; `default` and
 * `standard` are the same tier spelled differently by the CLI and the desktop
 * app. An unrecognized value returns null, which CLEARS an inherited tier
 * rather than keeping a stale one — a wrong `-fast` suffix would price the
 * turn at the fast multiplier for no reason.
 */
export function tierToFast(tier: unknown): boolean | null {
  if (tier === 'priority' || tier === 'fast') return true;
  if (tier === 'default' || tier === 'standard') return false;
  return null;
}

/** The slice of a rollout line this adapter reads. */
interface RolloutLine {
  type?: string;
  timestamp?: string;
  cwd?: string;
  payload?: {
    type?: string;
    model?: string;
    cwd?: string;
    thread_settings?: { service_tier?: unknown };
    info?: {
      model?: string;
      model_name?: string;
      last_token_usage?: RawUsage;
      total_token_usage?: RawUsage;
    };
  };
}

export const codexAdapter: SourceAdapter = {
  id: 'codex',
  label: 'Codex CLI',

  /**
   * `sessions/` and `archived_sessions/` under each Codex home. Both are
   * indexed: archiving a session does not un-spend its tokens. Duplicates
   * between the two are handled by the dedupe key below, not by skipping a
   * directory, so an archived copy can never drop usage the active copy lacks.
   */
  detectRoots(extra: string[] = []): string[] {
    // CODEX_HOME holds a single path for Codex itself, but ccmon MONITORS
    // rather than launches — accepting a comma list costs nothing and matches
    // how CLAUDE_CONFIG_DIR is read. splitPathList also expands a leading `~`,
    // which a quoted shell value would otherwise leave literal.
    const env = splitPathList(process.env.CODEX_HOME);
    const homes = [...(env.length ? env : [path.join(os.homedir(), '.codex')]), ...extra];
    const out: string[] = [];
    const seen = new Set<string>();
    const isDir = (p: string) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false; // Codex not installed, or never run — the normal case
      }
    };
    for (const home of homes) {
      let found = false;
      for (const name of ['sessions', 'archived_sessions']) {
        const dir = path.join(home, name);
        if (seen.has(dir)) continue;
        if (!isDir(dir)) continue;
        seen.add(dir);
        out.push(dir);
        found = true;
      }
      // A home with NEITHER subdir is taken to be a directory of rollouts
      // itself — an export, a backup, a mounted share. Looking only one level
      // down found nothing at all for those, silently.
      if (!found && !seen.has(home) && isDir(home)) {
        seen.add(home);
        out.push(home);
      }
    }
    return out;
  },

  owns(file: string): boolean {
    return file.endsWith('.jsonl');
  },

  // Byte gate, same markers as the string scan in parseLine (see types.ts).
  mayCarryData(line: Buffer): boolean {
    for (const m of LINE_MARKER_BYTES) if (line.indexOf(m) !== -1) return true;
    return false;
  },

  createState(): CodexState {
    return { model: null, cwd: null, fast: null, prevTotals: null };
  },

  parseLine(raw, file, lineNo, zone: Zone, state?: unknown): ParsedLine {
    let hit = false;
    for (const m of LINE_MARKERS) {
      if (raw.includes(m)) {
        hit = true;
        break;
      }
    }
    if (!hit) return null;

    let j: RolloutLine;
    try {
      j = JSON.parse(raw) as RolloutLine;
    } catch {
      return null;
    }

    // A missing state would mean the watcher stopped calling createState —
    // fall back to a throwaway rather than crashing the whole tail.
    const st = (state as CodexState | undefined) ?? (codexAdapter.createState!() as CodexState);
    const p = j.payload;

    // Context lines: remembered, never billed.
    if (j.type === 'turn_context') {
      if (p?.model) st.model = p.model;
      if (p?.cwd || j.cwd) st.cwd = p?.cwd || j.cwd || null;
      return null;
    }
    if (j.type !== 'event_msg' || !p) return null;

    if (p.type === 'thread_settings_applied') {
      // A settings event with NO service_tier key leaves the tier alone
      // (auto-review threads emit these); one with an unknown value clears it.
      if (p.thread_settings && 'service_tier' in p.thread_settings) {
        st.fast = tierToFast(p.thread_settings.service_tier);
      }
      return null;
    }
    if (p.type !== 'token_count' || !p.info) return null;

    const info = p.info;
    const total = info.total_token_usage ?? null;

    // Prefer the recorded turn delta; otherwise recover it by subtracting the
    // previous cumulative total. Clamped at zero: a session that resets its
    // counter would otherwise contribute negative tokens.
    let delta: RawUsage;
    if (info.last_token_usage) {
      delta = info.last_token_usage;
    } else if (total) {
      const prev = st.prevTotals;
      delta = {
        input_tokens: Math.max(0, zero(total, 'input_tokens') - zero(prev, 'input_tokens')),
        cached_input_tokens: Math.max(
          0,
          zero(total, 'cached_input_tokens') - zero(prev, 'cached_input_tokens'),
        ),
        output_tokens: Math.max(0, zero(total, 'output_tokens') - zero(prev, 'output_tokens')),
        total_tokens: Math.max(0, zero(total, 'total_tokens') - zero(prev, 'total_tokens')),
      };
    } else {
      return null; // no usage of any kind on this event
    }
    if (total) st.prevTotals = total;

    const ts = Date.parse(j.timestamp ?? '');
    if (!Number.isFinite(ts)) return null;

    const cached = zero(delta, 'cached_input_tokens');
    const input = Math.max(0, zero(delta, 'input_tokens') - cached);
    const output = zero(delta, 'output_tokens');
    if (!input && !cached && !output) return null; // a no-op tick, not a turn

    let model = resolveAutoReview(
      info.model || info.model_name || st.model || FALLBACK_MODEL,
      j.timestamp,
    );
    const fast = st.fast === true;
    if (fast) model += '-fast';

    /**
     * Content-addressed dedupe key, NOT file#line.
     *
     * Codex duplicates usage events in two situations: an `archived_sessions`
     * copy of a rollout that also exists under `sessions/`, and a MultiAgent
     * subagent rollout that REPLAYS its parent's history before its own turn.
     * Both re-emit the original events verbatim, so keying on content makes the
     * watcher's existing best-wins dedupe collapse them for free — no pre-scan
     * of the file, which a streaming tailer could not do anyway.
     *
     * Cumulative totals are strictly increasing within a session, so
     * timestamp + running total is unique per real turn; two distinct turns
     * would have to share a millisecond AND a running total to collide.
     * Rollouts that record no cumulative total fall back to file position,
     * which is the old behaviour and cannot dedupe across files.
     */
    const key = total
      ? `codex:${ts}:${zero(total, 'total_tokens')}:${zero(total, 'input_tokens')}:${zero(total, 'output_tokens')}`
      : `codex:f:${file}#${lineNo}`;

    return {
      kind: 'entry',
      key,
      msgId: null,
      ts,
      dateKey: dayKeyFor(ts, zone),
      model,
      fast,
      project: st.cwd || 'codex',
      sessionId: path.basename(file, '.jsonl'),
      sidechain: false,
      in: input,
      out: output,
      read: cached,
      w5m: 0,
      w1h: 0,
      costUSD: null,
    };
  },
};
