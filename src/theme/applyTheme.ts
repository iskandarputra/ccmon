/**
 * @file applyTheme.ts
 * @brief Applies a theme by writing its tokens as CSS variables.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { getTheme, TOKEN_KEYS, type Theme } from './themes';

let fadeTimer: number | undefined;

/**
 * Write a theme's tokens onto :root as CSS custom properties.
 * Pins `html.theme-fade` for the duration of the swap so every surface
 * crossfades to the new palette (see the motion section of global.css).
 */
export function applyTheme(id: string | null | undefined): Theme {
  const theme = getTheme(id);
  const root = document.documentElement;

  root.classList.add('theme-fade');
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => root.classList.remove('theme-fade'), 360);

  for (const key of TOKEN_KEYS) {
    const value = theme.tokens[key];
    if (value == null) {
      if (import.meta.env.DEV) console.warn(`theme "${theme.id}" missing token --${key}`);
      continue;
    }
    root.style.setProperty(`--${key}`, value);
  }
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
  return theme;
}
