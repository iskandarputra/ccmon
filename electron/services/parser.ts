/**
 * @file parser.ts
 * @brief Transcript line parser — usage entries plus reset and compaction markers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import path from 'path';
import type { ParsedLine } from '../../shared/types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local-timezone YYYY-MM-DD bucket key. */
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
    content?: Array<{ type?: string; name?: string }>;
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
export function parseLine(raw: string, file: string, lineNo: number): ParsedLine {
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
      sessionId: j.sessionId || path.basename(file, '.jsonl'),
    };
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
    dateKey: localDateKey(ts),
    model,
    fast,
    project: j.cwd || decodeProjectDir(path.basename(path.dirname(file))),
    sessionId: j.sessionId || path.basename(file, '.jsonl'),
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
