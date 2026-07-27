import { defineConfig } from 'vite';
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
});
