# Contributing

Thanks for looking. ccmon is small on purpose, so the bar is mostly about
keeping it that way.

## Setup

```bash
npm install
npm run dev
```

Node 22+. The dev script runs esbuild (main process), Vite (renderer), and
Electron with hot reload.

## Before you open a PR

```bash
npm run typecheck   # strict tsc over both processes
npm test            # 58 unit tests over the service math
```

Both run in CI on every push. Two more checks matter for specific areas:

- touched anything in `electron/services/`? Run `npm run smoke`. It pushes
  your real `~/.claude` data through the whole pipeline.
- touched the parser or the watcher's dedupe? Run `npm run parity`. It
  verifies token totals against ccusage on the same files.

## Where things live

- `docs/v2-spec.md` is the single source of truth for every data contract:
  entry shape, pricing rules, block math, the snapshot, settings. Read it
  before changing anything that crosses a module boundary, and keep
  `shared/types.ts` in sync with it.
- `electron/services/` is pure Node. Never import Electron there; that rule
  is what keeps the pipeline testable without a GUI.
- `src/` is the renderer. One zustand store, selector subscriptions, one
  view per file with a co-located CSS file.

## Style

- Colors come from theme tokens only: `var(--token)`, alpha via
  `color-mix()`. No CSS-in-JS, no hardcoded hex outside `src/theme/themes.ts`.
  The one exception is three.js materials; resolve tokens through
  `src/lib/themeColors.ts`.
- Motion uses the shared vocabulary in `global.css` and must collapse under
  `prefers-reduced-motion`.
- Analysis panels that compute something non-obvious get a `<Hint>` with a
  short, honest explanation of the method, including its limits.
- New source files start with a short `@file` / `@brief` / `@author` header.

## Scope

Claude Code only, local-first always. Features that need a server, an
account, or telemetry don't fit here. When in doubt, open an issue first.
