/**
 * @file palette.ts
 * @brief Chart accent and token-color palettes (theme-token based).
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Chart colors as CSS custom properties so every theme flows into SVG
 * charts automatically (SVG fill/stroke accept var()).
 */
export const ACCENTS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

export const TOKEN_COLORS = {
  out: 'var(--chart-2)', //   output
  in: 'var(--chart-1)', //    input
  read: 'var(--chart-4)', //  cache read
  write: 'var(--chart-3)', // cache write
} as const;

/** alpha-variant of any theme color (modern Chromium: color-mix). */
export const withAlpha = (cssColor: string, alpha: number): string =>
  `color-mix(in srgb, ${cssColor} ${Math.round(alpha * 100)}%, transparent)`;
