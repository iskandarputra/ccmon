/**
 * @file providers.ts
 * @brief Detect which LLM providers are in use from model id prefixes.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Shared because BOTH processes need it: the renderer splits billing by
 * provider, and main filters entries down to one provider's spend when
 * reconciling a DeepSeek balance against local transcripts (§5.7).
 */

/** Known provider prefixes — first match wins, checked in definition order. */
const PROVIDERS: Array<{ prefix: string; id: string; label: string }> = [
  { prefix: 'claude-', id: 'anthropic', label: 'Anthropic' },
  { prefix: 'deepseek-', id: 'deepseek', label: 'DeepSeek' },
];

export interface ProviderInfo {
  /** provider id, e.g. 'anthropic' | 'deepseek' */
  id: string;
  /** human label, e.g. 'Anthropic' | 'DeepSeek' */
  label: string;
}

/** Which provider a model id belongs to, or null when unrecognised. */
export function detectProvider(model: string): ProviderInfo | null {
  for (const p of PROVIDERS) {
    if (model.startsWith(p.prefix)) return { id: p.id, label: p.label };
  }
  return null;
}

/** Deduplicated set of providers detected across a list of model ids. */
export function detectProviders(models: string[]): ProviderInfo[] {
  const seen = new Set<string>();
  const out: ProviderInfo[] = [];
  for (const m of models) {
    const p = detectProvider(m);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** True when every detected provider is NOT Anthropic (i.e. API-key-only billing). */
export function isApiKeyOnly(models: string[]): boolean {
  const providers = detectProviders(models);
  return providers.length > 0 && providers.every((p) => p.id !== 'anthropic');
}

/** True when the model id belongs to DeepSeek — the balance reconciliation filter. */
export const isDeepseekModel = (model: string): boolean => detectProvider(model)?.id === 'deepseek';

/** True when ANY model in the list is DeepSeek (drives whether to offer the connect UI). */
export const usesDeepseek = (models: string[]): boolean => models.some(isDeepseekModel);
