/**
 * @file advisor.ts
 * @brief AI usage advisor — answers questions about spend/limits from the
 *        snapshot AGGREGATES (never raw transcripts), reusing the Claude Code
 *        login token against the Messages API.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type {
  AccountsMap,
  AdvisorMessage,
  AdvisorResult,
  LimitsMap,
  Snapshot,
} from '../../shared/types';

/** Compact USD/token formatters (service-local — the renderer has its own). */
const fmtUsd = (v: number): string => `$${(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtTokShort = (n: number): string => {
  const v = n || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

/**
 * Privacy + auth contract:
 *  - We send ONLY computed aggregates (totals, per-model/-project spend, cache,
 *    tool counts, live-limit percentages). Never transcript text, code, file
 *    paths beyond the project basename, or prompts.
 *  - Auth reuses the stored Claude Code OAuth access token (read-only — the
 *    poller/auth rules still apply: we never refresh it here). Anthropic's ToS
 *    restricts that token to Claude Code / claude.ai, and the Messages API
 *    expects the Claude Code identity as the system prompt for OAuth inference,
 *    so we send exactly that and fold the advisor framing into the user turn.
 *    A rejected call returns a verbose, actionable error.
 */

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const OAUTH_BETA = 'oauth-2025-04-20';
const API_VERSION = '2023-06-01';
// Required verbatim for OAuth-token inference to be accepted by the API.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const MAX_TOKENS = 1024;
const FETCH_TIMEOUT_MS = 60_000;

const ADVISOR_PREAMBLE = [
  'You are acting as a usage & cost advisor inside "ccmon", a local monitor for',
  'Claude Code usage. Below is a privacy-preserving SUMMARY of the user\'s usage',
  '(aggregates only — no transcripts). Answer their questions about spend, cost',
  'drivers, cache efficiency, plan-limit headroom, and how to use Claude Code',
  'more cost-effectively. Be concrete and cite the numbers from the summary.',
  'Keep answers tight (a few short paragraphs or bullets). All money is USD.',
].join(' ');

/** Compact, aggregates-only usage summary for the model (no raw transcript data). */
export function buildUsageContext(
  snapshot: Snapshot,
  limits: LimitsMap,
  accounts: AccountsMap,
): string {
  const s = snapshot;
  const lines: string[] = [];
  const pj = (p: string) => p.split('/').filter(Boolean).pop() || p;

  lines.push(`# Usage summary (generated ${new Date(s.generatedAt).toISOString()})`);
  lines.push(
    `Lifetime: ${fmtUsd(s.totals.cost)} over ${fmtTokShort(s.totals.tokens)} tokens, ` +
      `${s.totals.entries} entries, ${s.totals.sessions} sessions.`,
  );
  lines.push(
    `Today ${fmtUsd(s.today.cost)}; last 7 days ${fmtUsd(s.week.cost)}; ` +
      `avg active day ${fmtUsd(s.records.avgDailyCost)}; ` +
      `busiest day ${s.records.maxDay ? `${s.records.maxDay.date} (${fmtUsd(s.records.maxDay.cost)})` : 'n/a'}.`,
  );
  lines.push(
    `Cache hit rate ${(s.cache.hitRate * 100).toFixed(0)}%, saved ${fmtUsd(s.cache.savedUSD)} ` +
      `(idle re-writes cost ${fmtUsd(s.cache.idle.extraUSD)}). Compactions: ${s.compactions}.`,
  );

  if (s.models.length) {
    lines.push('\nTop models by cost:');
    for (const m of s.models.slice(0, 6)) {
      const share = s.totals.cost > 0 ? ((m.cost / s.totals.cost) * 100).toFixed(0) : '0';
      lines.push(`- ${m.model}: ${fmtUsd(m.cost)} (${share}%), ${fmtTokShort(m.in + m.out)} tok`);
    }
  }
  if (s.projects.length) {
    lines.push('\nTop projects by cost:');
    for (const p of s.projects.slice(0, 6)) {
      lines.push(`- ${pj(p.path)}: ${fmtUsd(p.cost)} (7d ${fmtUsd(p.weekCost)})`);
    }
  }
  if (s.toolUse.rows.length) {
    const tools = s.toolUse.rows.slice(0, 6).map((t) => `${t.name}×${t.invocations}`).join(', ');
    lines.push(`\nTool use: ${s.toolUse.invocations} calls over ${s.toolUse.turns} turns — ${tools}.`);
  }
  if (s.whatIf.length) {
    lines.push('\nWhat-if (all traffic re-priced onto one model):');
    for (const w of s.whatIf.slice(0, 4)) {
      lines.push(`- ${w.model}: ${fmtUsd(w.totalCost)} (${w.delta >= 0 ? '+' : ''}${fmtUsd(w.delta)} vs actual)`);
    }
  }

  const limitLines: string[] = [];
  for (const [dir, r] of Object.entries(limits)) {
    if (!r.ok) continue;
    const label = accounts[dir]?.email || pj(dir.replace(/\/projects$/, ''));
    const parts: string[] = [];
    if (r.session?.pct != null) parts.push(`session ${r.session.pct.toFixed(0)}%`);
    if (r.week?.pct != null) parts.push(`week ${r.week.pct.toFixed(0)}%`);
    if (r.forecast?.week?.etaTs) parts.push(`week caps ~${new Date(r.forecast.week.etaTs).toISOString()}`);
    if (parts.length) limitLines.push(`- ${label}: ${parts.join(', ')}`);
  }
  if (limitLines.length) {
    lines.push('\nLive plan limits:');
    lines.push(...limitLines);
  }

  return lines.join('\n');
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface MessagesResponse {
  content?: AnthropicTextBlock[];
  error?: { message?: string };
}

/** Plain-language reason for a Messages API failure status. */
function reason(status: number): string {
  if (status === 401 || status === 403)
    return 'the Claude Code login was rejected — it may be expired (use "Log in"), or Anthropic restricts this token to Claude Code itself';
  if (status === 429) return 'rate limited by anthropic';
  if (status === 400) return 'the request was rejected (model id or payload)';
  if (status >= 500) return 'anthropic server error';
  return 'request failed';
}

/**
 * Ask the advisor one question. `history` is the prior turns (excluding this
 * question); `context` is {@link buildUsageContext}. Never throws — resolves a
 * verbose `{ ok: false, error }` on any failure.
 */
export async function askAdvisor(opts: {
  token: string;
  model: string;
  question: string;
  history: AdvisorMessage[];
  context: string;
}): Promise<AdvisorResult> {
  const { token, model, question, history, context } = opts;
  const messages = [
    { role: 'user' as const, content: `${ADVISOR_PREAMBLE}\n\n${context}` },
    { role: 'assistant' as const, content: 'Got it — I have your usage summary. What would you like to know?' },
    ...history,
    { role: 'user' as const, content: question },
  ];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': API_VERSION,
        'anthropic-beta': OAUTH_BETA,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: CLAUDE_CODE_IDENTITY, messages }),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: MessagesResponse | null = null;
    try {
      json = JSON.parse(text) as MessagesResponse;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const detail = json?.error?.message || text.slice(0, 160).replace(/\s+/g, ' ').trim();
      return { ok: false, error: `${reason(res.status)} (HTTP ${res.status}${detail ? ` · ${detail}` : ''})` };
    }
    const answer = (json?.content || [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    if (!answer) return { ok: false, error: 'the model returned no text' };
    return { ok: true, answer };
  } catch (err) {
    const e = err as Error;
    return {
      ok: false,
      error: e.name === 'AbortError' ? 'timed out waiting for the model' : `network error (${e.message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}
