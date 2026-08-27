/**
 * @file providers.ts
 * @brief Detect which LLM provider — and which billing channel — a model id belongs to.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Shared because BOTH processes need it: the renderer splits billing by
 * provider, and main filters entries down to one provider's spend when
 * reconciling a DeepSeek balance against local transcripts (§5.7).
 *
 * Matching is rule-based rather than a bare prefix list because the same model
 * arrives under several ids depending on how it is reached:
 *
 *   claude-opus-4-6                          first-party API / Claude Code
 *   anthropic.claude-opus-4-6-v1             Bedrock
 *   us.anthropic.claude-sonnet-4-5-v1:0      Bedrock regional inference profile
 *   arn:aws:bedrock:…/application-inference-profile/…   Bedrock ARN
 *   anthropic/claude-opus-4-5                Vertex
 *   claude-3-5-sonnet@20240620               Vertex (dated alias)
 *
 * Getting this wrong is not cosmetic: `isApiKeyOnly` decides whether ccmon
 * offers a subscription-value comparison, and Bedrock/Vertex usage is
 * consumption-billed with no subscription to compare against.
 */

/** How the model is reached, which determines how it is billed. */
export type Deployment = 'first-party' | 'bedrock' | 'vertex';

export interface ProviderInfo {
  /** provider id, e.g. 'anthropic' | 'deepseek' | 'google' */
  id: string;
  /** human label, e.g. 'Anthropic' | 'DeepSeek' */
  label: string;
  /** billing channel — 'first-party' may be subscription-backed, the rest are not */
  deployment: Deployment;
}

interface Rule extends ProviderInfo {
  test: RegExp;
}

/** First match wins, so more specific patterns come first. */
const RULES: Rule[] = [
  // Bedrock, most specific first: full ARN, then optional region prefix.
  { test: /^arn:aws:bedrock:/i, id: 'anthropic', label: 'Anthropic', deployment: 'bedrock' },
  {
    test: /^(?:[a-z]{2,4}\.)?anthropic\./i,
    id: 'anthropic',
    label: 'Anthropic',
    deployment: 'bedrock',
  },
  // Vertex: publisher-prefixed, or the dated `@YYYYMMDD` alias form.
  { test: /^anthropic\//i, id: 'anthropic', label: 'Anthropic', deployment: 'vertex' },
  { test: /^claude[-.].*@\d{8}$/i, id: 'anthropic', label: 'Anthropic', deployment: 'vertex' },
  // First-party.
  { test: /^claude[-.]/i, id: 'anthropic', label: 'Anthropic', deployment: 'first-party' },
  { test: /^deepseek[-/.]/i, id: 'deepseek', label: 'DeepSeek', deployment: 'first-party' },
  { test: /^gemini[-.]/i, id: 'google', label: 'Google', deployment: 'first-party' },
  // Codex CLI. Without a rule these bucketed as "Other" in the provider
  // breakdown — the same hole Bedrock and Vertex ids used to fall through.
  // `openai/` covers the prefixed spelling some catalogs use.
  { test: /^(?:gpt|o[134])[-.]/i, id: 'openai', label: 'OpenAI', deployment: 'first-party' },
  { test: /^openai\//i, id: 'openai', label: 'OpenAI', deployment: 'first-party' },
];

/** Which provider a model id belongs to, or null when unrecognised. */
export function detectProvider(model: string): ProviderInfo | null {
  if (!model) return null;
  // A `-fast` variant is the same model on the same channel.
  const base = model.endsWith('-fast') ? model.slice(0, -5) : model;
  for (const r of RULES) {
    if (r.test.test(base)) return { id: r.id, label: r.label, deployment: r.deployment };
  }
  return null;
}

/**
 * Deduplicated providers across a list of model ids, keyed by provider AND
 * channel — Bedrock and first-party Anthropic bill differently, so collapsing
 * them would hide exactly the distinction `isApiKeyOnly` depends on.
 */
export function detectProviders(models: string[]): ProviderInfo[] {
  const seen = new Set<string>();
  const out: ProviderInfo[] = [];
  for (const m of models) {
    const p = detectProvider(m);
    if (!p) continue;
    const key = `${p.id}:${p.deployment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * True when nothing here could be covered by a Claude subscription — i.e. every
 * detected provider is billed per-token.
 *
 * Non-Anthropic providers qualify, and so do Anthropic models reached through
 * Bedrock or Vertex: those are consumption-billed cloud-marketplace channels, so
 * comparing their spend against a subscription price would invent a saving the
 * user never had.
 */
export function isApiKeyOnly(models: string[]): boolean {
  const providers = detectProviders(models);
  return (
    providers.length > 0 &&
    providers.every((p) => p.id !== 'anthropic' || p.deployment !== 'first-party')
  );
}

/** True when the model id belongs to DeepSeek — the balance reconciliation filter. */
export const isDeepseekModel = (model: string): boolean => detectProvider(model)?.id === 'deepseek';

/** True when ANY model in the list is DeepSeek (drives whether to offer the connect UI). */
export const usesDeepseek = (models: string[]): boolean => models.some(isDeepseekModel);
