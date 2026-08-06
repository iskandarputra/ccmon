/**
 * @file providerPresets.ts
 * @brief Ready-made wrapper environments for running Claude Code on another provider.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * Claude Code can talk to any Anthropic-compatible endpoint via
 * `ANTHROPIC_BASE_URL`, which is how people run it on DeepSeek. Doing that by
 * hand means knowing eight to ten environment variable names, several of them
 * undocumented — an onboarding wall that has nothing to do with the provider
 * being hard to use. These presets are that knowledge, written down once.
 *
 * A preset is only a starting point: it lands in the wizard's editable env box,
 * so model ids and budgets stay the user's to change (and MUST be, since model
 * ids move). Nothing here is applied automatically.
 */

/**
 * Placeholder for a secret ccmon already holds. The renderer never sees the
 * DeepSeek key — it is stored encrypted and only the main process can read it
 * — so the wizard writes this reference and main substitutes the real value at
 * write time. Two wins: the token is not typed twice, and it never crosses IPC
 * or lands in `settings.json`.
 */
export const SECRET_REF_DEEPSEEK = '${ccmon:deepseek-key}';

/** Matches any secret reference, resolved or not. */
export const SECRET_REF_RE = /\$\{ccmon:([a-z0-9-]+)\}/g;

export interface ProviderPreset {
  id: string;
  label: string;
  /** suggested `~/.claude-<suffix>` root, so its usage stays separately attributed */
  rootSuffix: string;
  /** one line for the UI: what this actually does */
  summary: string;
  /** where the user gets a key / checks model ids */
  docsUrl: string;
  env: Record<string, string>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    rootSuffix: 'deepseek',
    summary:
      'Claude Code against DeepSeek’s Anthropic-compatible endpoint — roughly 35× cheaper input, 86× cheaper output than Opus.',
    docsUrl: 'https://platform.deepseek.com',
    env: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: SECRET_REF_DEEPSEEK,
      // All three tiers map to one model: Claude Code picks a tier per task,
      // and an unmapped tier falls back to an Anthropic model id the endpoint
      // does not serve, which fails as an opaque 404 mid-session.
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-pro[1m]',
      // Without these, Claude Code drops effort/thinking params for models it
      // does not recognise — the reasoning quietly degrades with no error.
      ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: 'effort,thinking',
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: 'effort,thinking',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: 'effort,thinking',
      CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '1',
    },
  },
];

export const presetById = (id: string): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((p) => p.id === id);
