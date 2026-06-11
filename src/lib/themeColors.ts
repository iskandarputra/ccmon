/**
 * @file themeColors.ts
 * @brief Resolves CSS theme tokens to concrete colors for three.js materials.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Resolve theme tokens to concrete color strings for non-CSS consumers
 * (three.js materials can't read `var(--token)`). Callers should re-resolve
 * when the active theme changes — key a useMemo on `settings.theme`.
 */
export function tokenColor(token: string, fallback = '#888888'): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(token.startsWith('--') ? token : `--${token}`)
    .trim();
  return v || fallback;
}
