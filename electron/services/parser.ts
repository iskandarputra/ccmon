/**
 * @file parser.ts
 * @brief Transcript line parser — usage entries plus reset and compaction markers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import path from 'path';
import { dayKeyFor, type Zone } from '../../shared/daykey';
import type { ParsedLine } from '../../shared/types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * String pool for the handful of values that recur across tens of thousands of
 * entries — model ids, project paths, day keys, session ids. JSON.parse hands
 * back a fresh string object per line, so without pooling every entry keeps its
 * own copy of (say) one of only a few model ids. Collapsing them to a single
 * shared instance is the largest cheap win on `entries[]` heap at scale.
 *
 * The pool is bounded by real cardinality (models: a handful; projects:
 * hundreds; day keys: ~365/yr; sessions: thousands over years) — well under a
 * megabyte even after years of use, against tens of MB saved. (`source` is
 * already shared via the watcher's `sourceOf`, so it isn't pooled here.)
 */
const pool = new Map<string, string>();
function intern(s: string): string {
  const hit = pool.get(s);
  if (hit !== undefined) return hit;
  pool.set(s, s);
  return s;
}

/**
 * SYSTEM-timezone YYYY-MM-DD bucket key.
 *
 * Correct for Dates built by local calendar arithmetic (noon-anchored day
 * walking), where the system zone is the one the Date was constructed in.
 * For a real event timestamp use `dayKeyFor(ts, zone)` from shared/daykey
 * instead, so the user's timezone setting is honoured.
 */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Fallback project label when a line has no `cwd`. Claude Code encodes the
 * project path into the directory name by replacing separators with `-`;
 * the decode is lossy but only used as a display fallback.
 */
export function decodeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

/** Usage-limit marker embedded in API-error lines: `...reached|<unix seconds>`. */
const USAGE_LIMIT_RE = /Claude AI usage limit reached\|(\d+)/;

/**
 * Substrings that gate every line kind `parseLine` can return, one per branch:
 *
 *   usage             → a billable entry needs `message.usage`
 *   isApiErrorMessage → a reset marker needs the flag (its regex also says
 *                       "usage", but keep the marker explicit alongside its
 *                       branch so the two can't drift apart)
 *   isCompactSummary  → a compaction marker needs the flag
 *   tool_result       → a tool-result marker needs a block of that type
 *
 * Anything missing all four cannot produce a result, so it never needs parsing.
 */
const LINE_MARKERS = ['usage', 'isApiErrorMessage', 'isCompactSummary', 'tool_result'] as const;

/**
 * Cheap reject for lines that cannot carry data, applied before `JSON.parse`.
 *
 * Transcripts are mostly user text, thinking blocks and system lines; parsing
 * each one allocates an object graph that is thrown away immediately. A
 * substring scan is far cheaper than a parse, so this trades a few scans on
 * rejected lines for skipping the parse entirely. ccusage does the same thing
 * with a SIMD `memmem` prefilter (`rust/crates/ccusage-core/src/fast.rs`).
 *
 * MUST NOT produce false negatives: every marker here is required by the
 * branch it guards, so a line that would have parsed to a non-null result
 * always contains at least one. False positives are harmless — they just pay
 * for the parse they would have paid for anyway.
 */
export function mayCarryData(raw: string): boolean {
  for (const m of LINE_MARKERS) if (raw.includes(m)) return true;
  return false;
}

/**
 * Character length of a tool_result `content` field, which is either a plain
 * string or an array of content blocks (text / image / nested). Text blocks
 * count their text; anything else counts its serialized length as a fallback.
 */
function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const b of content) {
      if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') {
        n += (b as { text: string }).text.length;
      } else if (b != null) {
        n += JSON.stringify(b).length;
      }
    }
    return n;
  }
  return 0;
}

/** The slice of a transcript line the parser reads (everything else ignored). */
interface TranscriptLine {
  type?: string;
  timestamp?: string;
  isApiErrorMessage?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  cwd?: string;
  sessionId?: string;
  requestId?: string;
  costUSD?: unknown;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string | null;
    content?: Array<{ type?: string; name?: string; content?: unknown }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
      speed?: string;
    };
  };
}

/**
 * Parse one transcript line. Returns:
 *
 *   null                           — nothing billable (user/tool/system lines,
 *                                    synthetic messages, malformed JSON)
 *   { kind: 'reset', ts, resetTs } — "usage limit reached" API error; resetTs
 *                                    is when the limit lifts (epoch ms)
 *   { kind: 'entry', ... }         — a billable usage entry
 *
 * Cost is deliberately NOT computed here: entries carry raw token splits plus
 * any costUSD the CLI wrote, and dollars are resolved at aggregate time so
 * cost-mode or pricing changes never require a rescan.
 */
export function parseLine(
  raw: string,
  file: string,
  lineNo: number,
  zone: Zone = null,
): ParsedLine {
  if (!mayCarryData(raw)) return null;

  let j: TranscriptLine;
  try {
    j = JSON.parse(raw) as TranscriptLine;
  } catch {
    return null;
  }

  // API errors carry no usage, but "limit reached" ones tell us the reset time.
  if (j.isApiErrorMessage) {
    const m = USAGE_LIMIT_RE.exec(raw);
    if (!m) return null;
    const ts = Date.parse(j.timestamp ?? '');
    return {
      kind: 'reset',
      ts: Number.isFinite(ts) ? ts : null,
      resetTs: Number(m[1]) * 1000,
    };
  }

  // Context compactions appear as user-side summary lines — surface them as
  // markers (per-session compaction analytics) before the assistant gate.
  if (j.isCompactSummary) {
    const cts = Date.parse(j.timestamp ?? '');
    if (!Number.isFinite(cts)) return null;
    return {
      kind: 'compact',
      ts: cts,
      sessionId: intern(j.sessionId || path.basename(file, '.jsonl')),
    };
  }

  // User-side tool_result lines carry NO usage, so they never become entries —
  // but we size their content to estimate the tool output re-fed as context on
  // later turns. Measured before the assistant gate; kept as a separate marker.
  if (j.type === 'user' && Array.isArray(j.message?.content)) {
    let chars = 0;
    for (const b of j.message.content) {
      if (b && b.type === 'tool_result') chars += contentChars(b.content);
    }
    if (chars > 0) {
      const tts = Date.parse(j.timestamp ?? '');
      if (Number.isFinite(tts)) {
        return {
          kind: 'toolresult',
          ts: tts,
          sessionId: intern(j.sessionId || path.basename(file, '.jsonl')),
          chars,
        };
      }
    }
  }

  if (j.type !== 'assistant' || !j.message || !j.message.usage) return null;

  let model = j.message.model;
  if (!model || model === '<synthetic>') return null;

  const ts = Date.parse(j.timestamp ?? '');
  if (!Number.isFinite(ts)) return null;

  const u = j.message.usage;
  const fast = u.speed === 'fast';
  if (fast) model += '-fast'; // fast-mode turns price (and aggregate) separately

  const cw = u.cache_creation_input_tokens || 0;
  // Prefer the ephemeral-tier breakdown when present (1h writes cost more).
  const cc = u.cache_creation;
  const w1h = (cc && cc.ephemeral_1h_input_tokens) || 0;
  let w5m = cc ? cc.ephemeral_5m_input_tokens || 0 : cw;
  if (cc && w5m + w1h < cw) w5m = cw - w1h; // incomplete breakdown — bill remainder at 5m

  // tool_use block names, in order (may repeat) — powers tool analytics
  let tools: string[] | undefined;
  if (Array.isArray(j.message.content)) {
    for (const b of j.message.content) {
      if (b && b.type === 'tool_use' && typeof b.name === 'string') (tools ??= []).push(b.name);
    }
  }

  const msgId = j.message.id || null;
  return {
    kind: 'entry',
    key:
      msgId && j.requestId
        ? `${msgId}:${j.requestId}`
        : msgId
          ? `m:${msgId}`
          : `f:${file}#${lineNo}`,
    msgId,
    ts,
    dateKey: intern(dayKeyFor(ts, zone)),
    model: intern(model),
    fast,
    project: intern(j.cwd || decodeProjectDir(path.basename(path.dirname(file)))),
    sessionId: intern(j.sessionId || path.basename(file, '.jsonl')),
    sidechain: !!j.isSidechain,
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    read: u.cache_read_input_tokens || 0,
    w5m,
    w1h,
    costUSD: typeof j.costUSD === 'number' ? j.costUSD : null,
    tools,
    stop: typeof j.message.stop_reason === 'string' ? j.message.stop_reason : null,
  };
}
