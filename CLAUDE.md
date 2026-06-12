# ccmon — project guide

Electron + React + **TypeScript (strict)** realtime monitor for Claude Code
usage. Reads `~/.claude/projects/**/*.jsonl` locally; local-first with
exactly three network paths (see Gotchas).

## Commands

| Command | What | When to run |
|---|---|---|
| `npm run dev` | esbuild + Vite + Electron, hot reload | developing |
| `npm test` | vitest, 103 cases over `electron/services/__tests__/` + `src/lib/__tests__/` | after touching any service math |
| `npm run smoke` | full pipeline against real `~/.claude` data, no Electron | after touching `electron/services/` |
| `npm run parity` | token-parity diff vs ccusage (npx + network) | after touching parser or watcher dedupe |
| `npm run typecheck` | strict `tsc --noEmit`, node + web projects | before every commit |
| `npm run build` | Vite renderer + esbuild main/preload bundles | packaging |
| `npm run icon` | regenerates `build/icon.png` (1024px, gitignored) | dist scripts run it automatically |
| `npm run pricing:update` | refresh committed pricing snapshots | when LiteLLM/models.dev move |
| `./build.sh [deb\|appimage\|win\|all\|dir]` | installers into `release/` | releasing |

CI (`.github/workflows/ci.yml`) runs typecheck + tests on every push;
`build.yml` cuts releases on tags.

## Map

- `docs/v2-spec.md` — THE data contracts: entry shape, pricing engine,
  blocks math, snapshot v2, settings, limits, currency, module boundaries
  (§7 includes the validation matrix per area). Cross-boundary changes
  start here, then `shared/types.ts`, then code — in that order.
- `docs/architecture.md` — process model, data flow, key decisions.
- `docs/analytics-roadmap.md` — every analysis shipped or parked, with
  reasons; also tracks the engineering debts from the 2026-06 review.
- `shared/` — contracts imported by BOTH processes: `types.ts`, `ipc.ts`
  (the `CcmonApi` preload surface), `plans.ts` (dated plan-price table).
- `electron/services/` — pure Node, **never** import Electron here (this is
  what keeps smoke and the unit tests possible; type-only electron imports
  erase, so they're fine). Fifteen services: paths, config, settings,
  watcher, parser, aggregate, blocks, pricing, pricing-archive, accounts,
  cross-account, account-setup, limits-history, currency, window-state.
- `electron/main.ts` — the only main-process file that touches Electron
  APIs; owns `entries[]`, the debounced recompute, and the two pollers
  (limits 60 s, currency 1 h).
- `src/` — renderer. One zustand store (`src/store/useUsageStore.ts`),
  components subscribe via selectors. One view per file in `src/views/`
  with a co-located, view-prefixed css file (`.act-`, `.ins-`, `.spa-`, …).

## Conventions

- **Colors**: theme tokens only — `var(--token)`, alpha via `color-mix()`.
  No CSS-in-JS, no hex outside `src/theme/themes.ts` (the `Theme` type
  enforces every token). Exception: three.js materials can't read CSS vars —
  resolve via `src/lib/themeColors.ts#tokenColor` in a `useMemo` keyed on
  `settings.theme` (see SpatialView).
- **Motion**: shared vocabulary from global.css (`--ease-out`,
  `--dur-1/2/3`); view entrances come free via `.view-anim`. EVERYTHING
  collapses under `prefers-reduced-motion` — CSS via the global override,
  JS-driven motion (3D orbit, ripple, shimmer) gated on the media query.
  recharts stays `isAnimationActive={false}`.
- **Typography**: display numerals use `--sans` with `tnum`; data surfaces
  (labels, tables, feed, ticks) stay `--mono`. Never bundle Styrene/Tiempos
  (commercial).
- **Methodology notes**: non-obvious computed numbers get a `<Hint>`
  ("why?") explaining the method and its limits — never inline prose.
- **File headers**: every new source file starts with
  `@file` / `@brief` / `@author Iskandar Putra <www.iskandarputra.com>`.
- **Money**: every stored dollar is USD. Display conversion happens at
  format time in the renderer (`src/lib/format.ts#configureCurrency`);
  crypto codes bypass `Intl` currency style.

## Gotchas

- Transcripts nest several levels deep (subagents, workflows) — file
  discovery must stay recursive.
- Dedupe is ccusage-parity **best-wins**, not first-wins: streaming chunks
  repeat a `messageId:requestId` key with cumulative usage (keep largest);
  subagent usage is mirrored into parent transcripts (keep the
  non-sidechain copy). The merge also upgrades `tools`/`stop` from the
  later chunk — see `watcher.accept`/`merge`. Verified by `npm run parity`
  (drift < 0.005%).
- Entries carry raw token splits, no dollars; cost resolves at aggregate
  time via `costForMode` → `engine.costAt` (rates-of-the-day when the
  pricing archive covers the date), so cost-mode/pricing changes never
  rescan.
- Aggregation is a debounced **full recompute**: ~200 ms at 45k entries,
  per-entry dollars resolve exactly once (costMemo). Known wall at ~200k
  entries; the planned fix (incremental day-bucket aggregation) is in the
  roadmap. Don't add per-entry passes casually.
- Pricing is layered: bundled LiteLLM → 24h-cached refetch → models.dev →
  user regex overrides (always win). Plan prices are NOT fetchable — they
  live as a dated table in `shared/plans.ts`.
- The three network paths, all keep-last-good with verbose errors:
  1. daily pricing refetch (optional, `pricingOffline` disables);
  2. live plan limits every 60 s via Anthropic's OAuth usage endpoint with
     the stored Claude Code login — read-only, and NEVER refresh those
     tokens (rotation would log the user out of Claude Code); a shape guard
     fails loudly if the undocumented response changes;
  3. hourly display-currency rates (open.er-api.com fiat + CoinGecko
     top-10 crypto).
- Day bucketing is LOCAL timezone everywhere (entries, day keys, archive
  dates). There is no timezone setting yet.
- Parity quirk: ccmon can scan extra roots (e.g. `~/.claude-work`) that
  ccusage never sees — `scripts/parity.ts` restricts to standard roots
  before comparing.
- Renderer deps (react, recharts, zustand, three, @react-three/*) are
  devDependencies by design — Vite bundles them; only `chokidar` ships in
  the packaged app.
- `build/icon.png` is generated and gitignored; electron-builder derives
  `.ico`/`.icns` from it at package time.
