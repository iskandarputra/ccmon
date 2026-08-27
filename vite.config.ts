import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Strict CSP is injected at build time only — the Vite dev server needs
// inline scripts for React Fast Refresh, the packaged app does not.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml(html: string) {
        return html.replace(
          '</title>',
          `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        );
      },
    },
  ],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5183,
    strictPort: true,
  },
  test: {
    // An isolated worktree under `.worktrees/` holds a full second copy of the
    // repo, tests included. vitest does not read .gitignore, so without this
    // every suite runs TWICE locally — which silently doubles the reported
    // count and makes "did my change break anything" unanswerable. CI checks
    // out clean and never sees it.
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-cli/**', '**/.worktrees/**'],
  },
});
