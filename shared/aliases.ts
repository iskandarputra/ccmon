/**
 * @file aliases.ts
 * @brief User-supplied display names for model ids and project paths.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * DISPLAY ONLY, and deliberately so. Aliases are applied at render time and
 * never before pricing, grouping or dedupe: a Bedrock ARN aliased to
 * `claude-opus-4-6` must still price as the ARN, and two ids sharing an alias
 * must still be two rows. Resolving them earlier would silently merge distinct
 * models and break `npm run parity`.
 *
 * Configured in `~/.config/ccmon/config.json`:
 *
 *   "modelAliases":   { "arn:aws:bedrock:…/abcde12345": "opus-4-6 (bedrock)" }
 *   "projectAliases": { "/home/me/Documents/work/api": "api" }
 */

/** raw id → display label */
export type AliasMap = Record<string, string>;

/**
 * Resolve a display label for `raw`.
 *
 * Exact match first, then a `-fast` variant inherits its base model's alias with
 * the suffix preserved (so a Bedrock ARN aliased once covers both its normal and
 * fast-mode rows). Unmatched values are returned unchanged, and an empty alias
 * is ignored rather than blanking the label.
 */
export function aliasFor(raw: string, aliases: AliasMap | null | undefined): string {
  if (!raw || !aliases) return raw;
  const exact = aliases[raw];
  if (exact) return exact;
  if (raw.endsWith('-fast')) {
    const base = aliases[raw.slice(0, -5)];
    if (base) return `${base}-fast`;
  }
  return raw;
}

/**
 * Shorten a project path for display when no explicit alias exists: the last
 * path segment, which is what distinguishes sibling projects. Falls back to the
 * whole string when there is nothing to trim.
 */
export function shortProject(raw: string): string {
  if (!raw) return raw;
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

/** Alias if one exists, else the shortened path. */
export function projectLabel(raw: string, aliases: AliasMap | null | undefined): string {
  const alias = aliasFor(raw, aliases);
  return alias === raw ? shortProject(raw) : alias;
}
