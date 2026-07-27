/**
 * @file themes.ts
 * @brief Executive-grade, sophisticated, balanced color themes — zero neon, zero childish glow.
 * @author Iskandar Putra <www.iskandarputra.com>
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
    id: 'midnight',
    name: 'midnight pro',
    description: 'refined graphite slate with sapphire, warm amber and emerald accents',
    dark: true,
    tokens: {
      bg0: '#12141c', bg1: '#1a1d28', bg2: '#232838',
      line: '#30374a', 'line-soft': '#252b3b',
      text: '#f1f5f9', 'text-dim': '#94a3b8', 'text-faint': '#64748b',
      sage: '#10b981', amber: '#f59e0b', rose: '#f43f5e', blue: '#3b82f6',
      'chart-1': '#f59e0b', 'chart-2': '#10b981', 'chart-3': '#3b82f6',
      'chart-4': '#f43f5e', 'chart-5': '#8b5cf6', 'chart-6': '#06b6d4',
      ok: '#10b981', warn: '#f59e0b', bad: '#f43f5e',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'slate',
    name: 'graphite slate',
    description: 'minimalist neutral graphite workspace with restrained accents',
    dark: true,
    tokens: {
      bg0: '#14161a', bg1: '#1c1e24', bg2: '#262930',
      line: '#353944', 'line-soft': '#2a2d36',
      text: '#f3f4f6', 'text-dim': '#9ca3af', 'text-faint': '#6b7280',
      sage: '#059669', amber: '#d97706', rose: '#e11d48', blue: '#2563eb',
      'chart-1': '#d97706', 'chart-2': '#059669', 'chart-3': '#2563eb',
      'chart-4': '#e11d48', 'chart-5': '#7c3aed', 'chart-6': '#4b5563',
      ok: '#059669', warn: '#d97706', bad: '#e11d48',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'nord',
    name: 'nord studio',
    description: 'cool polar night charcoal blue with muted arctic teal and frost blue',
    dark: true,
    tokens: {
      bg0: '#161b22', bg1: '#1f2530', bg2: '#293140',
      line: '#3a4456', 'line-soft': '#2d3544',
      text: '#f0f4f8', 'text-dim': '#9bb0c1', 'text-faint': '#687b8c',
      sage: '#2dd4bf', amber: '#fb923c', rose: '#f87171', blue: '#38bdf8',
      'chart-1': '#38bdf8', 'chart-2': '#2dd4bf', 'chart-3': '#fb923c',
      'chart-4': '#f87171', 'chart-5': '#a78bfa', 'chart-6': '#64748b',
      ok: '#2dd4bf', warn: '#fb923c', bad: '#f87171',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'aurora',
    name: 'aurora dark',
    description: 'deep indigo slate with soft emerald, warm copper and muted violet',
    dark: true,
    tokens: {
      bg0: '#10141d', bg1: '#181e2b', bg2: '#222a3a',
      line: '#323c52', 'line-soft': '#262f42',
      text: '#f1f5f9', 'text-dim': '#94a3b8', 'text-faint': '#62728d',
      sage: '#10b981', amber: '#f59e0b', rose: '#f43f5e', blue: '#3b82f6',
      'chart-1': '#f59e0b', 'chart-2': '#10b981', 'chart-3': '#3b82f6',
      'chart-4': '#8b5cf6', 'chart-5': '#f43f5e', 'chart-6': '#06b6d4',
      ok: '#10b981', warn: '#f59e0b', bad: '#f43f5e',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'tokyo-night',
    name: 'tokyo night',
    description: 'balanced downtown dark blue with soft periwinkle and mint accents',
    dark: true,
    tokens: {
      bg0: '#131520', bg1: '#1b1e2e', bg2: '#24283d',
      line: '#343b57', 'line-soft': '#292f46',
      text: '#f1f5f9', 'text-dim': '#a9b1d6', 'text-faint': '#6c77a0',
      sage: '#4ade80', amber: '#f59e0b', rose: '#f87171', blue: '#38bdf8',
      'chart-1': '#38bdf8', 'chart-2': '#4ade80', 'chart-3': '#f59e0b',
      'chart-4': '#a78bfa', 'chart-5': '#f87171', 'chart-6': '#71717a',
      ok: '#4ade80', warn: '#f59e0b', bad: '#f87171',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'lofi',
    name: 'lofi studio',
    description: 'warm charcoal and rich bronze with muted sage',
    dark: true,
    tokens: {
      bg0: '#141210', bg1: '#1c1916', bg2: '#26221f',
      line: '#38332c', 'line-soft': '#2c2722',
      text: '#f4efe6', 'text-dim': '#a39b8e', 'text-faint': '#6c655b',
      sage: '#10b981', amber: '#d97706', rose: '#e11d48', blue: '#2563eb',
      'chart-1': '#d97706', 'chart-2': '#10b981', 'chart-3': '#2563eb',
      'chart-4': '#e11d48', 'chart-5': '#7c3aed', 'chart-6': '#78716c',
      ok: '#10b981', warn: '#d97706', bad: '#e11d48',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'catppuccin',
    name: 'catppuccin mocha',
    description: 'soothing mocha slate with pastel green, peach and lavender',
    dark: true,
    tokens: {
      bg0: '#141420', bg1: '#1b1b2a', bg2: '#232338',
      line: '#33334e', 'line-soft': '#27273c',
      text: '#cdd6f4', 'text-dim': '#a6adc8', 'text-faint': '#6c7086',
      sage: '#a6e3a1', amber: '#fab387', rose: '#f38ba8', blue: '#89b4fa',
      'chart-1': '#fab387', 'chart-2': '#a6e3a1', 'chart-3': '#89b4fa',
      'chart-4': '#f38ba8', 'chart-5': '#cba6f7', 'chart-6': '#f9e2af',
      ok: '#a6e3a1', warn: '#fab387', bad: '#f38ba8',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'dracula',
    name: 'dracula pro',
    description: 'balanced dark violet slate with refined accent highlights',
    dark: true,
    tokens: {
      bg0: '#1b1c24', bg1: '#232530', bg2: '#2c2e3d',
      line: '#404358', 'line-soft': '#323445',
      text: '#f8f8f2', 'text-dim': '#cbd5e1', 'text-faint': '#788199',
      sage: '#50fa7b', amber: '#ffb86c', rose: '#ff5555', blue: '#8be9fd',
      'chart-1': '#ffb86c', 'chart-2': '#50fa7b', 'chart-3': '#8be9fd',
      'chart-4': '#ff5555', 'chart-5': '#bd93f9', 'chart-6': '#ff79c6',
      ok: '#50fa7b', warn: '#ffb86c', bad: '#ff5555',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'github-dark',
    name: 'github dark pro',
    description: 'github\'s modern dark editor scheme — balanced and clean',
    dark: true,
    tokens: {
      bg0: '#0d1117', bg1: '#161b22', bg2: '#21262d',
      line: '#30363d', 'line-soft': '#23272e',
      text: '#f0f6fc', 'text-dim': '#8b949e', 'text-faint': '#6e7681',
      sage: '#3fb950', amber: '#d29922', rose: '#f85149', blue: '#58a6ff',
      'chart-1': '#d29922', 'chart-2': '#3fb950', 'chart-3': '#58a6ff',
      'chart-4': '#f85149', 'chart-5': '#bc8cff', 'chart-6': '#f0883e',
      ok: '#3fb950', warn: '#d29922', bad: '#f85149',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'daylight',
    name: 'daylight pro',
    description: 'crisp ultra-clean light mode with high-contrast text and sapphire blue',
    dark: false,
    tokens: {
      bg0: '#f8fafc', bg1: '#ffffff', bg2: '#f1f5f9',
      line: '#cbd5e1', 'line-soft': '#e2e8f0',
      text: '#0f172a', 'text-dim': '#475569', 'text-faint': '#64748b',
      sage: '#059669', amber: '#d97706', rose: '#dc2626', blue: '#2563eb',
      'chart-1': '#2563eb', 'chart-2': '#059669', 'chart-3': '#d97706',
      'chart-4': '#dc2626', 'chart-5': '#7c3aed', 'chart-6': '#0284c7',
      ok: '#059669', warn: '#d97706', bad: '#dc2626',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'github-light',
    name: 'github light pro',
    description: 'github\'s modern light editor color scheme',
    dark: false,
    tokens: {
      bg0: '#ffffff', bg1: '#f6f8fa', bg2: '#eaeef2',
      line: '#d0d7de', 'line-soft': '#e1e4e8',
      text: '#1f2328', 'text-dim': '#57606a', 'text-faint': '#8c959f',
      sage: '#1a7f37', amber: '#bf8700', rose: '#cf222e', blue: '#0969da',
      'chart-1': '#0969da', 'chart-2': '#1a7f37', 'chart-3': '#bf8700',
      'chart-4': '#cf222e', 'chart-5': '#8250df', 'chart-6': '#bc4c00',
      ok: '#1a7f37', warn: '#bf8700', bad: '#cf222e',
      'grain-opacity': '0.01',
    },
  },
  {
    id: 'paper',
    name: 'paper executive',
    description: 'warm off-white parchment paper with ink text and crisp accents',
    dark: false,
    tokens: {
      bg0: '#f4efe6', bg1: '#faf6f0', bg2: '#ffffff',
      line: '#dcd3c3', 'line-soft': '#e8e1d3',
      text: '#1c1917', 'text-dim': '#57534e', 'text-faint': '#78716c',
      sage: '#16a34a', amber: '#d97706', rose: '#dc2626', blue: '#0284c7',
      'chart-1': '#d97706', 'chart-2': '#16a34a', 'chart-3': '#0284c7',
      'chart-4': '#dc2626', 'chart-5': '#9333ea', 'chart-6': '#ca8a04',
      ok: '#16a34a', warn: '#d97706', bad: '#dc2626',
      'grain-opacity': '0.01',
    },
  }
];

export const DEFAULT_THEME_ID = 'midnight';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
