# ccmon — project guide

Electron + React + **TypeScript (strict)** realtime monitor for Claude Code
usage. Reads `~/.claude/projects/**/*.jsonl` locally; local-first with
six network paths (see Gotchas) — four background, two user-initiated.

## Commands

| Command | What | When to run |
|---|---|---|
| `npm run dev` | esbuild + Vite + Electron, hot reload | developing |
| `npm test` | vitest, 443 cases over `electron/services/__tests__/` + `src/lib/__tests__/` + `scripts/__tests__/` | after touching any service math |
| `npm run smoke` | full pipeline against real `~/.claude` data, no Electron | after touching `electron/services/` |
| `npm run cli -- <args>` | the headless CLI via tsx (`json`, `csv`, `statusline`) | developing `cli/` |
| `npm run build:cli` | just the CLI bundle → `dist-cli/index.cjs` (+x, shebang) | testing the real binary |
| `npm run dist:dir` | unpacked package in `release/linux-unpacked/` | verifying packaging without installing |
| `npm run parity` | token-parity diff vs ccusage (npx + network); localizes per-day on failure | after touching parser or watcher dedupe |
| `npm run pricing:update -- --prune` | as below, but drops entries the upstreams retired | only to correct a bad committed entry |
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
  (the `CcmonApi` preload surface), `plans.ts` (dated plan-price table),
  `providers.ts` (model-prefix → provider registry), `range.ts`.
- `electron/services/adapters/` — the source-adapter seam. An adapter owns what
  is FORMAT-specific (`detectRoots`, `owns`, `parseLine`); the watcher owns what
  isn't (tailing, offsets, dedupe, markers). `ADAPTERS` is the registry —
  appending to it is all a new coding-CLI format needs. Only `claude` ships
  today, but the seam is tested against a second (Gemini-shaped) format so it
  isn't a single-implementation abstraction.
- `electron/services/` — pure Node, **never** import Electron here (this is
  what keeps smoke and the unit tests possible; type-only electron imports
  erase, so they're fine). Twenty-two services: paths, config, settings,
  watcher, parser, aggregate, blocks, pricing, pricing-archive, accounts,
  auth, keychain, advisor, export, cross-account, account-setup,
  limits-history, currency, deepseek, deepseek-history, deepseek-key,
  window-state. A service needing an Electron API takes it INJECTED rather
  than importing it — `deepseek-key.ts` receives a `KeyCrypto` that main backs
  with `safeStorage`. `keychain.ts` shells out to macOS `security(1)` for the
  same reason: a native keychain module would need node-gyp and break the
  pure-Node rule.
- `electron/main.ts` — the only main-process file that touches Electron
  APIs; owns `entries[]`, the debounced recompute, the two pollers
  (limits 60 s, currency 1 h), and the tray. Tray STRINGS come from the pure
  `services/status-text.ts` (shared with the CLI statusline, unit-tested);
  main only owns the Electron plumbing. `refreshTray()` is idempotent and
  called from both publish paths (snapshot + limits), so any code that changes
  those numbers updates the tray for free.
- The CLI ships in installers via `extraResources` (→
  `<install>/resources/cli/index.cjs`), NOT inside the asar — it has a shebang
  and must stay directly executable. It is deliberately not symlinked onto PATH
  by an install hook: that would need a root-run deb postinstall, has no clean
  AppImage equivalent, and needs a shim plus a PATH edit on Windows. README
  documents the one-line `ln -sf`. Verify packaging with `npm run dist:dir` and
  run `release/linux-unpacked/resources/cli/index.cjs` directly.
- `cli/` — the SECOND consumer of `electron/services/`, and the reason the
  no-Electron rule earns its keep: `ccmon json | csv | statusline` runs the
  whole pipeline under plain node. Read-only — settings come from the app's
  stored `settings.json` (flags override), limits are read from the persisted
  history rather than polled, and the only possible network call is a pricing
  refresh. `userdata.ts` reproduces `app.getPath('userData')` by hand, so it
  must follow any app rename.
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
- **Privacy mode** (`settings.privacyMode`) blanks every MONEY figure at format
  time — `format.ts` for the renderer, `status-text.ts#money` for the tray and
  CLI statusline. Masking lives in the formatters, not per-component, so a new
  panel can't leak a dollar figure by forgetting a flag. Tokens, models and
  timings stay visible on purpose. `ccmon json` / `csv` are NEVER masked: they
  are data for scripts, and blanking numbers there would corrupt output rather
  than protect it.
- **Display aliases**: `~/.config/ccmon/config.json` `modelAliases` /
  `projectAliases` rename model ids and project paths for DISPLAY ONLY,
  installed once at bootstrap via `format.ts#configureAliases` (same
  configure-once idiom as `configureCurrency`). They must never be resolved
  before pricing, grouping or dedupe — aliasing two ids to one label would
  merge distinct models and break parity.
- **Provider detection** (`shared/providers.ts`) is rule-based, not prefix-based,
  because the same model arrives as `claude-*` (first-party),
  `anthropic.claude-*` / `us.anthropic.*` / a Bedrock ARN, or `anthropic/claude-*`
  / `claude-*@YYYYMMDD` (Vertex). Each carries a `deployment` channel, and
  `isApiKeyOnly` treats Bedrock/Vertex as consumption-billed — otherwise ccmon
  offers a subscription-savings comparison to someone with no subscription.
- **Money**: every stored dollar is USD. Display conversion happens at
  format time in the renderer (`src/lib/format.ts#configureCurrency`);
  crypto codes bypass `Intl` currency style.

## Gotchas

- Transcripts nest several levels deep (subagents, workflows) — file
  discovery must stay recursive.
- The tray is an ambient extra, never a requirement: a desktop with no
  StatusNotifier host makes `new Tray()` throw, which is caught and logged
  (`tray unavailable`) rather than propagated. On Linux the context menu is the
  only readable surface (`setTitle` is macOS-only), which is why the numbers are
  disabled menu rows and not merely a tooltip.
- `settings.closeToTray` (default **false**) makes closing the window hide it
  instead of quitting. Three guards make that safe: it only engages when a tray
  actually exists (else the app would be unreachable), `state.quitting` lets
  every real quit path through (`before-quit` covers Cmd-Q / dock / SIGTERM, the
  tray Quit item sets it directly), and the first hide fires a one-time
  notification — a window vanishing with no feedback reads as a crash. Never
  flip the default: silently converting a close into "still running, no window"
  is a trap.
- Dedupe is ccusage-parity **best-wins**, not first-wins: streaming chunks
  repeat a `messageId:requestId` key with cumulative usage (keep largest);
  subagent usage is mirrored into parent transcripts (keep the
  non-sidechain copy). The merge also upgrades `tools`/`stop` from the
  later chunk — see `watcher.accept`/`merge`. Verified by `npm run parity`
  at **0.000% drift** (exact integer match on all four token fields) against
  ccusage v20.0.19.
- Parity counts EVERY model on both sides. `ccusage claude daily` reads
  exactly the corpus ccmon scans, so anything in it belongs to both totals —
  including non-Anthropic models run through Claude Code via a base-URL
  override (this repo's transcripts contain DeepSeek). A `claude-*` filter on
  one side only compared different corpora and manufactured ~47% phantom
  input drift. Don't reintroduce one.
- `parser.parseLine` gates on `mayCarryData` — a substring scan that skips
  `JSON.parse` for lines that cannot carry data (41% faster parse path). Its
  marker list MUST stay in sync with the parse branches: adding a branch that
  keys off a new field means adding that field's name to `LINE_MARKERS`, or
  the new line kind is silently dropped.
- **Claude Code no longer records a per-message `costUSD`.** Verified 2026-07-30
  across five account roots and ~107k entries: ZERO assistant usage lines carry a
  numeric top-level `costUSD` (the handful of files matching the string do so in
  message *content*). Consequences: `costMode: 'display'` yields $0 for
  everything, `'auto'` is indistinguishable from `'calculate'`, and
  `snapshot.reconcile` reports `coverage: 0`. The parser still reads the field
  and the reconciliation still works — both light up if the field returns or a
  user has older transcripts — but do NOT build UI that assumes it is there. The
  Insights reconciliation panel is gated on `compared > 0` for exactly this
  reason: an always-empty panel would imply a clean bill.
- Entries carry raw token splits, no dollars; cost resolves at aggregate
  time via `costForMode` → `engine.costAt` (rates-of-the-day when the
  pricing archive covers the date), so cost-mode/pricing changes never
  rescan.
- Aggregation is a debounced **full recompute**: ~200 ms at 45k entries,
  per-entry dollars resolve exactly once (costMemo). Known wall at ~200k
  entries; the planned fix (incremental day-bucket aggregation) is in the
  roadmap. Don't add per-entry passes casually.
- Pricing is layered: bundled LiteLLM → 24h-cached refetch → models.dev →
  user regex overrides (always win; they reach tier rates, `contextLimit`
  and the `-fast` multiplier, not just the five base rates). Plan prices are
  NOT fetchable — they live as a dated table in `shared/plans.ts`.
- `pricing:update` MERGES, never replaces: both upstreams prune retired
  models (models.dev dropped the whole Claude 3.5 family), and dropping a
  retired price only un-prices transcripts a user chose to keep. Retained
  keys are printed on every run.
- The six network paths, all keep-last-good with verbose errors:
  1. daily pricing refetch (optional, `pricingOffline` disables);
  2. live plan limits every 60 s via Anthropic's OAuth usage endpoint with
     the stored Claude Code login — read-only; the **poller never refreshes
     tokens** (rotation could log the user out of Claude Code); a shape guard
     fails loudly if the undocumented response changes;
  3. hourly display-currency rates (open.er-api.com fiat + CoinGecko
     top-10 crypto);
  4. user-initiated re-login (`auth.ts`, the "Log in" control) — a
     refresh-token grant, falling back to a browser PKCE code-paste flow.
     Runs ONLY on an explicit click, never in a poller, and ALWAYS persists
     the rotated tokens back to the store they came from — `.credentials.json`
     (atomic, mode 0600), or the macOS Keychain — so Claude Code stays in sync;
  5. user-initiated AI advisor (`advisor.ts`, the advisor view) — POSTs the
     Messages API reusing the stored login token (read-only), sending ONLY
     snapshot aggregates, never transcripts. Anthropic's ToS scopes that
     token to Claude Code, so the call sends the Claude Code identity system
     prompt and surfaces a verbose error if the API declines;
  6. DeepSeek balance every 5 min (`deepseek.ts`) when a key is connected —
     `GET /user/balance`, read-only. DeepSeek has NO OAuth, so this is a bare
     API key ccmon owns: stored 0600 and encrypted via `safeStorage`
     (injected — the service stays pure Node), and reported as unencrypted in
     the UI when no OS keyring exists. `/user/balance` is the ONLY account
     endpoint DeepSeek publishes — no usage, quota, or rate-limit API — so
     burn, runway and the computed-vs-observed drift check are all measured
     locally from the balance falling (`deepseek-history.ts`). The connect
     click probes the endpoint once before persisting the key.
- **macOS keeps the Claude Code login in the Keychain, not a file.** No
  `<root>/.credentials.json` exists there, so limits, the tray cap row, the
  near-cap alert and the advisor all depend on `services/keychain.ts` reading
  the `Claude Code-credentials` item via `security(1)`. File first, Keychain
  second (the file is per-root and authoritative). The item identifies no
  config dir, so it is used for the DEFAULT `~/.claude` root only — reusing it
  for a second root would report one login's limits under another account's
  name. `auth.ts` writes rotations back to whichever store it read from;
  writing the file on a Mac would desync Claude Code silently.
- ccmon NEVER deletes an account: that root holds the credentials and every
  transcript the app reads. "Remove" is `AccountWrapperPrefs.hidden`, a view
  preference. Main keeps `allSourceDirs` (detected) vs `sourceDirs` (visible);
  the watcher subscribes to ALL of them so unhiding is live, and with anything
  hidden `sourceScope()` must return the explicit visible set rather than
  `null`, or hidden entries leak back into the snapshot.
- Day bucketing goes through ONE function: `shared/daykey.ts#dayKeyFor(ts,
  zone)`, driven by `settings.timezone` ('' = system zone, the default). It
  covers entry `dateKey`s, "today", range resolution, the rhythm heatmap and
  `accountSpend`. Never call `getFullYear()`/`getHours()` on an event timestamp
  — use `dayKeyFor`/`zonedParts`. Calendar arithmetic ON a day key
  (noon-anchored day/week walking) stays zone-independent and keeps using
  `localDateKey`; that split is deliberate and documented at both functions.
  Changing the zone re-buckets history WITHOUT a rescan: main re-stamps every
  entry's `dateKey` in one pass, bumps `dataEpoch`, and `recomputeSig` includes
  the zone so the forced recompute can't be elided. Blocks are 5-hour real-time
  windows and are correctly unaffected. The pricing archive stays dated in the
  SYSTEM zone on purpose — a layer records when rates were fetched, and
  re-dating it would rewrite the past; the cost is a bounded one-day boundary
  effect on `costAt`.
- `UsageWatcher.sinceMs` windows discovery by file mtime. It exists ONLY for
  the CLI's statusline, which must answer inside a shell prompt (0.9 s vs 7 s
  on a 100k-entry corpus). It is off by default and must stay off for the app,
  `json` and `csv` — a windowed index silently understates lifetime totals.
  Today's spend and the active block are exact under it; a session older than
  the window reads low, which the CLI help states outright.
- Parity quirk: ccmon can scan extra roots (e.g. `~/.claude-work`) that
  ccusage never sees — `scripts/parity.ts` restricts to standard roots
  before comparing.
- Renderer deps (react, recharts, zustand, three, @react-three/*) are
  devDependencies by design — Vite bundles them; only `chokidar` ships in
  the packaged app.
- `build/icon.png` is generated and gitignored; electron-builder derives
  `.ico`/`.icns` from it at package time.
