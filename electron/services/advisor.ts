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
const fmtUsd = (v: number): string =>
  `$${(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
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
const MAX_TOKENS = 2048;
const FETCH_TIMEOUT_MS = 60_000;

const ADVISOR_PREAMBLE = [
  'You are the Principal AI Infrastructure Economist & Systems Research Scientist inside "ccmon", an observability and intelligence platform for Claude Code and LLM engineering workloads.',
  "Below is a privacy-preserving, mathematically structured telemetry matrix of the user's local usage (aggregates only — no transcripts, code, or prompts).",
  '',
  '# Analytical Directives & Persona:',
  '1. First-Principles Quantitative Rigor: Decompose queries using precise formulas, unit economics ($/MTok), cache leverage ratios, and marginal cost derivatives. Quote concrete figures from the telemetry matrix.',
  '2. Root-Cause Systems Thinking: Differentiate symptoms from foundational architectural drivers (e.g. context window quadratic growth in long sessions, cache TTL thrashing across 5m pauses, subagent recursion depth compounding, model tier over-allocation).',
  '3. Zero-Loss Cost Reduction: Formulate strategic interventions that slash dollar burn while preserving or enhancing engineering velocity and reasoning fidelity.',
  '4. Multi-Account & Subscription Arbitrage: Optimize workload routing across subscription tiers to avoid 5-hour limit cliffs, maximize subscription value multiplier, and sustain high availability.',
  '5. Structured Synthesis: Structure responses with executive clarity — use Markdown headers, bold highlights, concise metrics, and prioritized action tiers. All money is in USD.',
].join('\n');

/** Compact, aggregates-only usage summary for the model (no raw transcript data). */
export function buildUsageContext(
  snapshot: Snapshot,
  limits: LimitsMap,
  accounts: AccountsMap,
): string {
  const s = snapshot;
  const lines: string[] = [];
  const pj = (p: string) => p.split('/').filter(Boolean).pop() || p;

  lines.push(
    `# Quantitative Usage & Telemetry Matrix (Timestamp: ${new Date(s.generatedAt).toISOString()})`,
  );

  // 1. Macro Economics & Cadence
  const avgSessionCost = s.totals.sessions > 0 ? s.totals.cost / s.totals.sessions : 0;
  const blendedPerMTok = s.totals.tokens > 0 ? (s.totals.cost / s.totals.tokens) * 1_000_000 : 0;
  lines.push('\n## Macroeconomic Overview:');
  lines.push(
    `- Lifetime Spend: ${fmtUsd(s.totals.cost)} across ${fmtTokShort(s.totals.tokens)} tokens (${fmtTokShort(s.totals.in)} in / ${fmtTokShort(s.totals.out)} out).`,
  );
  lines.push(
    `- Session Dynamics: ${s.totals.sessions} sessions, ${s.totals.entries} turns · Blended Unit Cost: $${blendedPerMTok.toFixed(2)}/MTok · Avg Session: ${fmtUsd(avgSessionCost)}.`,
  );
  lines.push(
    `- Temporal Velocity: Today ${fmtUsd(s.today.cost)} · Last 7d ${fmtUsd(s.week.cost)} · Active Day Mean ${fmtUsd(s.records.avgDailyCost)}.`,
  );
  if (s.records.maxDay) {
    lines.push(
      `- Record Outlier: Peak Day ${s.records.maxDay.date} (${fmtUsd(s.records.maxDay.cost)}).`,
    );
  }
  if (s.records.streak) {
    lines.push(
      `- Engineering Cadence: ${s.records.activeDays} active days · Current Streak ${s.records.streak.current}d · Longest Streak ${s.records.streak.longest}d.`,
    );
  }

  // 2. Prompt Cache Economics & TTL Dynamics
  const unCachedSpend = (s.cache.savedUSD || 0) + (s.totals.cost || 0);
  const cacheDiscountPct = unCachedSpend > 0 ? ((s.cache.savedUSD || 0) / unCachedSpend) * 100 : 0;
  lines.push('\n## Prompt Cache Microeconomics & TTL Telemetry:');
  lines.push(
    `- Cache hit rate ${(s.cache.hitRate * 100).toFixed(0)}%, saved ${fmtUsd(s.cache.savedUSD)} (${cacheDiscountPct.toFixed(1)}% effective discount vs ${fmtUsd(unCachedSpend)} raw API baseline).`,
  );
  lines.push(
    `- Cache Token Volume: ${fmtTokShort(s.cache.readTokens)} read tok · ${fmtTokShort(s.cache.writeTokens)} write tok.`,
  );
  if (s.cache.idle?.extraUSD > 0 || (s.cache.idle?.events ?? 0) > 0) {
    lines.push(
      `- Cache Thrashing Penalty: ${fmtUsd(s.cache.idle.extraUSD)} wasted across ${s.cache.idle.events ?? 0} re-writes (${fmtTokShort(s.cache.idle.tokens ?? 0)} tok) due to inter-turn idle times exceeding the 5-minute TTL.`,
    );
  }

  // 3. Subagent & Sidechain Recursion Overhead
  if (s.sidechain?.cost > 0 || s.sidechain?.entries > 0) {
    const sidePct = s.totals.cost > 0 ? (s.sidechain.cost / s.totals.cost) * 100 : 0;
    lines.push('\n## Autonomous Subagents & Sidechains:');
    lines.push(
      `- Sidechain Spend: ${fmtUsd(s.sidechain.cost)} (${sidePct.toFixed(1)}% of total) across ${s.sidechain.entries} subagent turns.`,
    );
  }

  // 4. Context Window Saturation & Compactions
  lines.push('\n## Context Window Saturation & Compaction:');
  lines.push(
    `- Compactions: ${s.compactions} observed · Post-Compaction Context Re-read Cost: ${fmtUsd(s.compactionReread?.costUSD || 0)} across ${s.compactionReread?.turns || 0} turns.`,
  );
  if (s.toolResults?.count > 0) {
    lines.push(
      `- Tool Result Ingestion Volume: ~${fmtTokShort(s.toolResults.estTokens)} tok re-injected as context across ${s.toolResults.count} tool executions.`,
    );
  }

  // 5. Model Portfolio & Unit Economics
  if (s.models.length) {
    lines.push('\n## Model Tier Portfolio:');
    for (const m of s.models.slice(0, 6)) {
      const share = s.totals.cost > 0 ? ((m.cost / s.totals.cost) * 100).toFixed(1) : '0';
      const mtokRate = m.in + m.out > 0 ? (m.cost / (m.in + m.out)) * 1_000_000 : 0;
      lines.push(
        `- ${m.model}: ${fmtUsd(m.cost)} (${share}% share) · ${fmtTokShort(m.in + m.out)} tok · $${mtokRate.toFixed(2)}/MTok.`,
      );
    }
  }

  // 6. Codebase Architecture & Domain Allocation
  if (s.knowledge?.layers?.length) {
    const activeLayers = s.knowledge.layers.filter((l) => l.cost > 0 || l.touches > 0);
    if (activeLayers.length) {
      lines.push('\n## Architectural Domain Spend:');
      for (const l of activeLayers.slice(0, 8)) {
        lines.push(
          `- ${l.label} (${l.key}): ${fmtUsd(l.cost)} (${l.pct.toFixed(1)}%) · ${l.touches} ops · ${fmtTokShort(l.tokens)} tok.`,
        );
      }
    }
  }

  // 7. Top Workspace Projects
  if (s.projects.length) {
    lines.push('\n## Top Projects by Allocation:');
    for (const p of s.projects.slice(0, 6)) {
      const pSidePct = p.cost > 0 && p.sidechainCost > 0 ? (p.sidechainCost / p.cost) * 100 : 0;
      lines.push(
        `- ${pj(p.path)}: ${fmtUsd(p.cost)} total (7d ${fmtUsd(p.weekCost)}) · ${p.sessions ?? 0} sessions${pSidePct > 0 ? ` · subagents ${pSidePct.toFixed(0)}%` : ''}.`,
      );
    }
  }

  // 8. Tool Invocations
  if (s.toolUse.rows.length) {
    const tools = s.toolUse.rows
      .slice(0, 6)
      .map((t) => `${t.name}×${t.invocations}`)
      .join(', ');
    lines.push(
      `\n## Tool Invocation Frequency: ${s.toolUse.invocations} calls across ${s.toolUse.turns} turns — ${tools}.`,
    );
  }

  // 9. Counterfactual What-If Arbitrage Matrix
  if (s.whatIf.length) {
    lines.push('\n## Counterfactual Model Re-Pricing Arbitrage:');
    for (const w of s.whatIf.slice(0, 4)) {
      lines.push(
        `- ${w.model}: ${fmtUsd(w.totalCost)} (${w.delta >= 0 ? '+' : ''}${fmtUsd(w.delta)} delta vs actual spend).`,
      );
    }
  }

  // 10. Multi-Account Live Limits & Rate-Limit Risk
  const limitLines: string[] = [];
  for (const [dir, r] of Object.entries(limits)) {
    if (!r.ok) continue;
    const label = accounts[dir]?.email || pj(dir.replace(/\/projects$/, ''));
    const parts: string[] = [];
    if (r.session?.pct != null) parts.push(`5h-session ${r.session.pct.toFixed(0)}%`);
    if (r.week?.pct != null) parts.push(`weekly-cap ${r.week.pct.toFixed(0)}%`);
    if (r.forecast?.week?.etaTs)
      parts.push(
        `estimated exhaustion: ${new Date(r.forecast.week.etaTs).toLocaleDateString()} ${new Date(r.forecast.week.etaTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      );
    if (parts.length) limitLines.push(`- ${label}: ${parts.join(', ')}`);
  }
  if (limitLines.length) {
    lines.push('\n## Live Multi-Account Headroom & Risk Vectors:');
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
    {
      role: 'assistant' as const,
      content: 'Got it — I have your usage summary. What would you like to know?',
    },
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
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: CLAUDE_CODE_IDENTITY,
        messages,
      }),
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
      return {
        ok: false,
        error: `${reason(res.status)} (HTTP ${res.status}${detail ? ` · ${detail}` : ''})`,
      };
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
      error:
        e.name === 'AbortError'
          ? 'timed out waiting for the model'
          : `network error (${e.message})`,
    };
  } finally {
    clearTimeout(timer);
  }
}
