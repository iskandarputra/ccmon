/**
 * @file themes.ts
 * @brief The 17 themes — every token enforced by the Theme type.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Theme registry. A theme is a complete set of design tokens — every theme
 * MUST define every key in TOKEN_KEYS (the Theme type enforces it at compile
 * time now; applyTheme still validates in dev).
 *
 * Color slots keep their lofi names (--sage/--amber/--rose/--blue) but act
 * as semantic accent slots: sage = positive/live, amber = primary/cost,
 * rose = negative/warning, blue = informational. --chart-1..6 drive series
 * colors. Alpha variants are derived in CSS via color-mix().
 *
 * Contrast targets (vs bg0): text ≥ 7:1 dark / ≥ 8:1 light, text-dim ≥ 4.5:1,
 * text-faint ≥ 3:1. `description` is the one-liner shown in the settings
 * gallery; `dark` drives color-scheme (false for light themes, which also use
 * a slightly higher grain-opacity so the texture survives the light bg).
 */

export const TOKEN_KEYS = [
  'bg0', 'bg1', 'bg2', 'line', 'line-soft',
  'text', 'text-dim', 'text-faint',
  'sage', 'amber', 'rose', 'blue',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6',
  'ok', 'warn', 'bad',
  'grain-opacity',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export interface Theme {
  id: string;
  name: string;
  description: string;
  dark: boolean;
  tokens: Record<TokenKey, string>;
}

export const THEMES: Theme[] = [
  {
    id: 'lofi',
    name: 'lofi',
    description: 'warm charcoal and dusty earth tones — the original',
    dark: true,
    tokens: {
      bg0: '#131110', bg1: '#181512', bg2: '#201c18',
      line: '#2a251f', 'line-soft': '#221e19',
      text: '#eae4d6', 'text-dim': '#9a9183', 'text-faint': '#6b6354',
      sage: '#a8b894', amber: '#d9a86c', rose: '#c98a7d', blue: '#8fa8bf',
      'chart-1': '#a8b894', 'chart-2': '#d9a86c', 'chart-3': '#c98a7d',
      'chart-4': '#8fa8bf', 'chart-5': '#b5a8c9', 'chart-6': '#8f8a7b',
      ok: '#a8b894', warn: '#d9a86c', bad: '#c98a7d',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'paper',
    name: 'paper',
    description: 'warm off-white paper with ink text and dusty accents',
    dark: false,
    tokens: {
      bg0: '#f2ede3', bg1: '#f7f3ea', bg2: '#fbf8f1',
      line: '#d9d1c0', 'line-soft': '#e3dccd',
      text: '#2b2620', 'text-dim': '#6e6557', 'text-faint': '#8d8270',
      sage: '#5f7350', amber: '#a06f33', rose: '#ab5f55', blue: '#4f6e8a',
      'chart-1': '#5f7350', 'chart-2': '#a06f33', 'chart-3': '#ab5f55',
      'chart-4': '#4f6e8a', 'chart-5': '#7d6a96', 'chart-6': '#857c6b',
      ok: '#5f7350', warn: '#a06f33', bad: '#ab5f55',
      'grain-opacity': '0.035',
    },
  },
  {
    id: 'midnight',
    name: 'midnight',
    description: 'cool blue-black with desaturated steel accents',
    dark: true,
    tokens: {
      bg0: '#0c0f14', bg1: '#11151c', bg2: '#171c25',
      line: '#232a36', 'line-soft': '#1c222c',
      text: '#d7dde6', 'text-dim': '#8a93a3', 'text-faint': '#5c6573',
      sage: '#8caf9b', amber: '#c9a97a', rose: '#c08484', blue: '#82a3c4',
      'chart-1': '#8caf9b', 'chart-2': '#c9a97a', 'chart-3': '#c08484',
      'chart-4': '#82a3c4', 'chart-5': '#ab8fc9', 'chart-6': '#7d8799',
      ok: '#8caf9b', warn: '#c9a97a', bad: '#c08484',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'gruvbox',
    name: 'gruvbox',
    description: 'retro warmth — faded olive, orange and red on hard dark',
    dark: true,
    tokens: {
      bg0: '#1d2021', bg1: '#282828', bg2: '#32302f',
      line: '#3c3836', 'line-soft': '#34302c',
      text: '#ebdbb2', 'text-dim': '#a89984', 'text-faint': '#7c6f64',
      sage: '#a9b665', amber: '#d8a657', rose: '#d06d62', blue: '#83a598',
      'chart-1': '#a9b665', 'chart-2': '#d8a657', 'chart-3': '#d06d62',
      'chart-4': '#83a598', 'chart-5': '#d3869b', 'chart-6': '#928374',
      ok: '#a9b665', warn: '#d8a657', bad: '#d06d62',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'nord',
    name: 'nord',
    description: 'polar night blues with frost and aurora accents',
    dark: true,
    tokens: {
      bg0: '#2e3440', bg1: '#333a47', bg2: '#3b4252',
      line: '#4c566a', 'line-soft': '#434c5e',
      text: '#e5e9f0', 'text-dim': '#a3aec2', 'text-faint': '#76819a',
      sage: '#a3be8c', amber: '#ebcb8b', rose: '#ca737d', blue: '#81a1c1',
      'chart-1': '#a3be8c', 'chart-2': '#ebcb8b', 'chart-3': '#ca737d',
      'chart-4': '#81a1c1', 'chart-5': '#b48ead', 'chart-6': '#88c0d0',
      ok: '#a3be8c', warn: '#ebcb8b', bad: '#ca737d',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'mocha',
    name: 'mocha',
    description: 'soft muted pastels on a deep mocha base',
    dark: true,
    tokens: {
      bg0: '#1e1e2e', bg1: '#232336', bg2: '#2a2a40',
      line: '#3b3b54', 'line-soft': '#30304a',
      text: '#cdd6f4', 'text-dim': '#9399b8', 'text-faint': '#6c7086',
      sage: '#99c197', amber: '#dfa57e', rose: '#d98b9e', blue: '#8aa9d6',
      'chart-1': '#99c197', 'chart-2': '#dfa57e', 'chart-3': '#d98b9e',
      'chart-4': '#8aa9d6', 'chart-5': '#b39cd9', 'chart-6': '#8a8fad',
      ok: '#99c197', warn: '#dfa57e', bad: '#d98b9e',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'rose-pine',
    name: 'rosé pine',
    description: 'muted gold, foam and love on deep violet night',
    dark: true,
    tokens: {
      bg0: '#191724', bg1: '#1f1d2e', bg2: '#26233a',
      line: '#393650', 'line-soft': '#2a2740',
      text: '#e0def4', 'text-dim': '#908caa', 'text-faint': '#6e6a86',
      sage: '#9ccfd8', amber: '#f6c177', rose: '#d57a93', blue: '#6ca0b4',
      'chart-1': '#9ccfd8', 'chart-2': '#f6c177', 'chart-3': '#d57a93',
      'chart-4': '#6ca0b4', 'chart-5': '#c4a7e7', 'chart-6': '#ebbcba',
      ok: '#9ccfd8', warn: '#f6c177', bad: '#d57a93',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'phosphor',
    name: 'phosphor',
    description: 'green phosphor terminal — single-hue crt glow',
    dark: true,
    tokens: {
      bg0: '#0a0f0a', bg1: '#0e140e', bg2: '#131b13',
      line: '#1f2c1f', 'line-soft': '#182218',
      text: '#b4e3ac', 'text-dim': '#6faf68', 'text-faint': '#4a7a46',
      sage: '#8fdc84', amber: '#d6b25e', rose: '#cc7a4e', blue: '#82cfae',
      'chart-1': '#8fdc84', 'chart-2': '#d6b25e', 'chart-3': '#cc7a4e',
      'chart-4': '#82cfae', 'chart-5': '#d8dc8e', 'chart-6': '#55914f',
      ok: '#8fdc84', warn: '#d6b25e', bad: '#cc7a4e',
      'grain-opacity': '0.07',
    },
  },
  {
    id: 'sepia',
    name: 'sepia',
    description: 'aged sepia paper with brown ink and rust accents',
    dark: false,
    tokens: {
      bg0: '#efe4cf', bg1: '#f4ebd9', bg2: '#f9f1e2',
      line: '#d8c9ab', 'line-soft': '#e2d5ba',
      text: '#3a2e20', 'text-dim': '#72614a', 'text-faint': '#8f7d5d',
      sage: '#6d7a45', amber: '#9c6f2e', rose: '#9e4a3e', blue: '#5a7186',
      'chart-1': '#6d7a45', 'chart-2': '#9c6f2e', 'chart-3': '#9e4a3e',
      'chart-4': '#5a7186', 'chart-5': '#826688', 'chart-6': '#8a7a5e',
      ok: '#6d7a45', warn: '#9c6f2e', bad: '#9e4a3e',
      'grain-opacity': '0.035',
    },
  },
  {
    id: 'slate',
    name: 'slate',
    description: 'neutral graphite grayscale with one restrained amber',
    dark: true,
    tokens: {
      bg0: '#151617', bg1: '#1a1b1d', bg2: '#212224',
      line: '#2c2e31', 'line-soft': '#242629',
      text: '#e2e3e5', 'text-dim': '#97999d', 'text-faint': '#66686c',
      sage: '#a8b5a1', amber: '#c9a05f', rose: '#b3766b', blue: '#7e8c9a',
      'chart-1': '#a8b5a1', 'chart-2': '#c9a05f', 'chart-3': '#b3766b',
      'chart-4': '#7e8c9a', 'chart-5': '#d6d7d9', 'chart-6': '#6a6c70',
      ok: '#a8b5a1', warn: '#c9a05f', bad: '#b3766b',
      'grain-opacity': '0.05',
    },
  },

  /* ── vibrant set — saturated accents on deep modern bases ──────────────── */

  {
    id: 'aurora',
    name: 'aurora',
    description: 'northern lights — vivid mint, gold and violet on deep teal night',
    dark: true,
    tokens: {
      bg0: '#0b1117', bg1: '#0f161e', bg2: '#152029',
      line: '#233140', 'line-soft': '#1b2734',
      text: '#dbe7f1', 'text-dim': '#8da3b5', 'text-faint': '#5d7284',
      sage: '#46d39a', amber: '#ffb454', rose: '#f4718a', blue: '#54b9f0',
      'chart-1': '#46d39a', 'chart-2': '#ffb454', 'chart-3': '#f4718a',
      'chart-4': '#54b9f0', 'chart-5': '#a07bf5', 'chart-6': '#5ee2c8',
      ok: '#46d39a', warn: '#ffb454', bad: '#f4718a',
      'grain-opacity': '0.04',
    },
  },
  {
    id: 'synthwave',
    name: 'synthwave',
    description: 'hot pink, mint and ice blue over a deep indigo dusk',
    dark: true,
    tokens: {
      bg0: '#14101f', bg1: '#191428', bg2: '#211b34',
      line: '#332a4d', 'line-soft': '#281f3d',
      text: '#e8e3f5', 'text-dim': '#a195bd', 'text-faint': '#6f6590',
      sage: '#5ce8b5', amber: '#ffc25e', rose: '#ff6e9c', blue: '#6ea8ff',
      'chart-1': '#ff6e9c', 'chart-2': '#5ce8b5', 'chart-3': '#ffc25e',
      'chart-4': '#6ea8ff', 'chart-5': '#b388ff', 'chart-6': '#ff9e64',
      ok: '#5ce8b5', warn: '#ffc25e', bad: '#ff6e9c',
      'grain-opacity': '0.045',
    },
  },
  {
    id: 'ember',
    name: 'ember',
    description: 'molten orange, coral and gold on near-black charcoal',
    dark: true,
    tokens: {
      bg0: '#120d0a', bg1: '#171110', bg2: '#201715',
      line: '#32241e', 'line-soft': '#281c17',
      text: '#f3e6dc', 'text-dim': '#b39686', 'text-faint': '#7d6557',
      sage: '#a3c76d', amber: '#ff9d4d', rose: '#f06a55', blue: '#94a7c4',
      'chart-1': '#ff9d4d', 'chart-2': '#f06a55', 'chart-3': '#ffd166',
      'chart-4': '#a3c76d', 'chart-5': '#94a7c4', 'chart-6': '#b08568',
      ok: '#a3c76d', warn: '#ffd166', bad: '#f06a55',
      'grain-opacity': '0.05',
    },
  },
  {
    id: 'oceanic',
    name: 'oceanic',
    description: 'bright azure, turquoise and coral over deep navy water',
    dark: true,
    tokens: {
      bg0: '#0a141c', bg1: '#0e1a24', bg2: '#14222e',
      line: '#22384a', 'line-soft': '#1a2c3a',
      text: '#d9e8f2', 'text-dim': '#87a3b8', 'text-faint': '#587286',
      sage: '#4fd6be', amber: '#ffc04d', rose: '#ff7a76', blue: '#45aaf2',
      'chart-1': '#45aaf2', 'chart-2': '#4fd6be', 'chart-3': '#ffc04d',
      'chart-4': '#ff7a76', 'chart-5': '#9d8cff', 'chart-6': '#5e8ea8',
      ok: '#4fd6be', warn: '#ffc04d', bad: '#ff7a76',
      'grain-opacity': '0.04',
    },
  },
  {
    id: 'ultraviolet',
    name: 'ultraviolet',
    description: 'electric violet and magenta with mint highlights on black-purple',
    dark: true,
    tokens: {
      bg0: '#100b1a', bg1: '#150f23', bg2: '#1d1530',
      line: '#322550', 'line-soft': '#261c3e',
      text: '#e9e2fa', 'text-dim': '#a698c7', 'text-faint': '#71639a',
      sage: '#62e8a8', amber: '#f5b651', rose: '#f76e94', blue: '#8f7bff',
      'chart-1': '#8f7bff', 'chart-2': '#f5b651', 'chart-3': '#f76e94',
      'chart-4': '#62e8a8', 'chart-5': '#4fc7f0', 'chart-6': '#c4b1f5',
      ok: '#62e8a8', warn: '#f5b651', bad: '#f76e94',
      'grain-opacity': '0.045',
    },
  },
  {
    id: 'neon',
    name: 'neon',
    description: 'crisp cyan, mint and magenta on jet black — high contrast',
    dark: true,
    tokens: {
      bg0: '#0a0c10', bg1: '#0e1116', bg2: '#151920',
      line: '#262c38', 'line-soft': '#1d222c',
      text: '#e6f0f5', 'text-dim': '#93a4b3', 'text-faint': '#5f6e7d',
      sage: '#3ddc97', amber: '#f7c948', rose: '#ff5c7a', blue: '#29c4ff',
      'chart-1': '#29c4ff', 'chart-2': '#3ddc97', 'chart-3': '#f7c948',
      'chart-4': '#ff5c7a', 'chart-5': '#c16fff', 'chart-6': '#ff8a3d',
      ok: '#3ddc97', warn: '#f7c948', bad: '#ff5c7a',
      'grain-opacity': '0.03',
    },
  },
  {
    id: 'daylight',
    name: 'daylight',
    description: 'clean bright white with vivid blue, green and orange',
    dark: false,
    tokens: {
      bg0: '#f4f6f8', bg1: '#fafbfc', bg2: '#ffffff',
      line: '#d6dde4', 'line-soft': '#e3e8ee',
      text: '#1d2733', 'text-dim': '#576675', 'text-faint': '#7c8a99',
      sage: '#1d9e6f', amber: '#d97a08', rose: '#cf4a64', blue: '#1f7ad1',
      'chart-1': '#1f7ad1', 'chart-2': '#1d9e6f', 'chart-3': '#d97a08',
      'chart-4': '#cf4a64', 'chart-5': '#7b5bd6', 'chart-6': '#6b7d8e',
      ok: '#1d9e6f', warn: '#d97a08', bad: '#cf4a64',
      'grain-opacity': '0.025',
    },
  },
];

export const DEFAULT_THEME_ID = 'nord';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
