# ccmon — project guide

Electron + React + **TypeScript (strict)** realtime monitor for coding-CLI
usage. Reads `~/.claude/projects/**/*.jsonl` and
`${CODEX_HOME:-~/.codex}/{sessions,archived_sessions}/**/*.jsonl` locally;
local-first with six network paths (see Gotchas) — four background, two
user-initiated. Codex adds none — not for lack of limits data, but because
it writes its own rate limits into the transcript rather than an API.

## Commands

| Command | What | When to run |
|---|---|---|
| `npm run dev` | esbuild + Vite + Electron, hot reload | developing |
| `npm test` | vitest, 824 cases over `electron/services/__tests__/` + `src/lib/__tests__/` + `scripts/__tests__/` | after touching any service math |
| `npm run lint` | eslint (correctness rules only; Prettier owns formatting) | before every commit |
| `npm run format` | prettier over everything but Markdown and fixtures | before every commit |
| `npm run smoke` | full pipeline against real `~/.claude` data, no Electron | after touching `electron/services/` |
| `npm run cli -- <args>` | the headless CLI via tsx (`json`, `csv`, `statusline`) | developing `cli/` |
| `npm run build:cli` | just the CLI bundle → `dist-cli/index.cjs` (+x, shebang) | testing the real binary |
| `npm run dist:dir` | unpacked package in `release/linux-unpacked/` | verifying packaging without installing |
| `npm run parity` | token-parity diff vs ccusage over the real `~/.claude` (npx + network); localizes per-day on failure | after touching parser or watcher dedupe |
| `npm run parity -- --fixture` | same check against the committed corpus in `scripts/fixtures/parity/` — no local history needed, so CI runs it | every push (CI); locally when you have no `~/.claude` |
| `npm run pricing:update -- --prune` | as below, but drops entries the upstreams retired | only to correct a bad committed entry |
| `npm run typecheck` | strict `tsc --noEmit`, node + web projects | before every commit |
| `npx tsx scripts/dump-helpers.ts <dir>` | writes the embedded cross-resume scripts out for `bash -n` / the PowerShell parser | after touching `tools/codex-resume.ts` |
| `npm run build` | Vite renderer + esbuild main/preload bundles | packaging |
| `npm run icon` | regenerates `build/icon.png` (1024px, gitignored) | dist scripts run it automatically |
| `npm run pricing:update` | refresh committed pricing snapshots | when LiteLLM/models.dev move |
| `./build.sh [deb\|appimage\|win\|all\|dir]` | installers into `release/` | releasing |

CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests on Linux, macOS
AND Windows every push, plus a build job and the fixture parity gate. The
three-OS matrix is not ceremony: `keychain.ts` shells out to macOS
`security(1)` and `account-setup.ts` emits PowerShell, and both used to be
exercised only against mocks on Linux. `build.yml` cuts releases on tags.

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
  is FORMAT-specific (`detectRoots`, `owns`, `parseLine`, and optionally
  `createState`); the watcher owns what isn't (tailing, offsets, per-file state
  lifetime, dedupe, markers). `ADAPTERS` is the registry — appending to it is
  all a new coding-CLI format needs. Two ship: `claude` and `codex`.
  **Codex is what proved the seam.** Fitting it required adding `createState`,
  because a Codex usage line is not self-describing — its model comes from an
  earlier `turn_context` and its speed tier from an earlier
  `thread_settings_applied`, so a line read in isolation cannot be priced. No
  amount of designing against one format would have surfaced that. Adapters are
  shared singletons, so state MUST live in the watcher, never in the adapter:
  the app and the CLI each run their own watcher over the same `ADAPTERS`.
- `shared/tools.ts` + `electron/services/tools/` — the ACCOUNT-layer twin of the
  adapter seam, joined on id (`adapter.id === profile.id`). An adapter owns what
  is FORMAT-specific; a `ToolProfile` owns what is INSTALL-specific: where the
  home is (`CLAUDE_CONFIG_DIR` vs `CODEX_HOME`), which binary a wrapper runs,
  what that wrapper is called, which subdir seeds a new home, where the
  credentials live. They stay SEPARATE interfaces on purpose — adapters are
  stateless singletons the CLI imports under plain node, while account setup
  writes shell rc files and reads credential stores, which the CLI never does;
  folding one into the other would make every CLI invocation import code it can
  never call. `shared/tools.ts` is the pure half (the renderer imports it too,
  which is what retired the hand-copied naming helpers in
  `src/lib/crossAccount.ts`); `tools/identity.ts` is the fs half, and
  `tools/codex-resume.ts` holds the embedded helper scripts, and
  `tools/sessions.ts` reads which sessions are running right now.
- `electron/services/` — pure Node, **never** import Electron here (this is
  what keeps smoke and the unit tests possible; type-only electron imports
  erase, so they're fine). Twenty-five services: paths, config, settings,
  watcher, parser, aggregate, recompute, scope, blocks, pricing,
  pricing-archive, accounts, auth, keychain, advisor, export, cross-account,
  account-setup, limits-history, currency, status-text, deepseek,
  deepseek-history, deepseek-key, window-state, plus `tools/`. A service
  needing an Electron API takes it INJECTED rather
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
  ccusage v20.0.19. Parity is an end-to-end check and can only say "the totals
  match" — it cannot localize a break to one rule, and it needs the network and
  a real corpus. `watcher.test.ts` pins each rule individually and is the thing
  that will actually name a regression; keep both.
- `parity.ts` PINS `CLAUDE_CONFIG_DIR` for the ccusage subprocess to the same
  roots it restricted ccmon to. ccusage does its own discovery and inherits
  that variable, so running parity from a `claude-<name>` wrapper shell — the
  wrappers ccmon itself generates — made the two sides read DIFFERENT accounts
  and reported it as ~9990% token drift. Never drop the pin: the harness has
  to be independent of the shell it runs in, or a green/red result says
  nothing about the token math.
- Parity counts EVERY model on both sides. `ccusage claude daily` reads
  exactly the corpus ccmon scans, so anything in it belongs to both totals —
  including non-Anthropic models run through Claude Code via a base-URL
  override (this repo's transcripts contain DeepSeek). A `claude-*` filter on
  one side only compared different corpora and manufactured ~47% phantom
  input drift. Don't reintroduce one.
- **Known ccusage divergence, cache-write tiers.** When `cache_creation` is
  present but its tiers sum to LESS than `cache_creation_input_tokens`, ccmon
  treats the total as authoritative and bills the remainder at 5m
  (`parser.ts`); ccusage bills only the breakdown. Measured on
  `{total: 900, 5m: 400, 1h: 100}`: ccmon 900, ccusage 500. It has never fired
  on the real corpus (parity is 0.000% over ~110k entries), so Claude Code
  appears to emit a complete breakdown or none at all — but if that changes,
  ccmon's cache-write total will legitimately exceed ccusage's and parity will
  go red for a reason that is not a bug. The shape is deliberately kept OUT of
  the CI fixture (a permanently-red gate gates nothing) and covered in
  `parser.test.ts` instead. See `scripts/fixtures/parity/README.md`.
- The adapter seam must be honoured on BOTH paths. `listFiles` (startup index)
  and `watch` (live tailing) each decide which files carry usage, and both must
  ask `adapter.owns`. A hardcoded `.jsonl` in the chokidar `ignored` predicate
  used to let a foreign format index once at startup and then never see another
  append — silently, with no error to point at. Startup-only tests cannot catch
  that; `watcher.test.ts` tails a real `.ndjson` fixture for exactly this reason.
- **Codex tokens are cumulative and its `input_tokens` INCLUDES the cache.**
  `info.total_token_usage` is a session running total, `info.last_token_usage`
  the turn delta; prefer the delta, else subtract the previous total. Then
  `in = input_tokens − cached_input_tokens` — billing the raw input
  double-charges every cached prompt token, which on a long session is most of
  the input. Codex bills no cache writes, and its dedupe key is
  content-addressed (timestamp + running total) rather than file position, so
  an `archived_sessions` copy of a live rollout — which is byte-identical —
  collapses for free.
- **A forked Codex rollout replays its parent's turns, REWRITTEN to the fork
  instant.** That rewrite is what defeats the content key: same token counts,
  different timestamp, no collision, parent's whole history billed twice. (An
  earlier note here claimed these replays "re-emit the same events verbatim" —
  wrong on the timestamp, and the reason the bug existed.)
  `adapters/codex-replay.ts` catches it by matching TOKEN VALUES rather than
  timestamps, which is why a rewrite cannot defeat it. Two anchors: the
  parent's own stream, found by the uuid embedded in its filename — a targeted
  read of ONE file, not a corpus pre-scan — and failing that the burst Codex
  writes at the fork instant (a run of usage events ≤1 s apart, against the
  5.8–15.3 s pause before the child's first real turn), read from the child's
  head alone. Both are gated on `session_meta` DECLARING a parent
  (`forked_from_id`, or `source.subagent.thread_spawn.parent_thread_id`): an
  ordinary session must never meet the burst heuristic, where two quick turns
  in a row are simply two turns. `createState` takes the file path for this —
  the seam's second widening for this format, for the same reason as the first.
- **Codex long-context tiers ARE modelled.** models.dev publishes a 272K
  context band for the gpt-5.x models; `RateRow.tierAt` carries the per-model
  threshold so the engine stops assuming Anthropic's 200K, and a long turn
  bills ENTIRELY at the tier rate rather than only its excess.
- **Scan anatomy — read+parse is ~97% of indexing; everything else is noise.**
  Measured 2026-08-06 on 335 files / 342 MB / 121,841 lines:

  | | |
  |---|---|
  | `listFiles` discovery | 28–72 ms |
  | UTF-8 decode of surviving lines | ~1,115 ms |
  | `JSON.parse` of surviving lines | ~1,217 ms |
  | `buildSnapshot` aggregate | 238 ms (~610 ms at 110k entries) |

  The byte prefilter (`mayCarryDataBytes` + `SourceAdapter.mayCarryData`) admits
  65% of LINES but **85% of BYTES**, so it buys less than the line count
  suggests. Of the surviving bytes, `tool_result` lines are **56%** (163 MB,
  26,772 lines) and are fully decoded and parsed only to sum a character count
  for one analytics panel. That is the largest single remaining lever — worth
  roughly 1.2 s of a 1.8 s scan — but taking it means either changing what that
  number means or hand-writing a JSON scanner, so it is a product decision, not
  a refactor. The second lever is worker threads: the work is embarrassingly
  parallel per file, and Node is single-threaded here. Don't optimise the
  aggregate first; it is 3%.

  Landing the byte prefilter plus byte-level line splitting (no `StringDecoder`,
  no per-line string for a rejected line) took the full 5-root corpus from
  17.4 s to 12.0 s, and a single root from 2.9 s to 1.8 s — both at 0.000%
  parity, which is the only acceptable way to make this faster.
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
- Aggregation is a debounced **full recompute**: ~200 ms at 45k entries and
  **~610 ms at 110k** (measured by `npm run smoke`, 2026-08-07), per-entry
  dollars resolving exactly once (costMemo). That scales worse than linearly,
  so treat ~200k as well over a second, not as a distant wall — on a large
  corpus this already costs most of a second of main-process CPU per burst of
  appends. The planned fix (incremental day-bucket aggregation) is in the
  roadmap and is nearer to load-bearing than its placement there suggests.
  Don't add per-entry passes casually, and re-measure with `smoke` if you do.
- Pricing is layered: bundled LiteLLM → 24h-cached refetch → models.dev →
  user regex overrides (always win; they reach tier rates, `tierAt`,
  `contextLimit` and the `-fast` multiplier, not just the five base rates).
  Plan prices are NOT fetchable — they live as a dated table in
  `shared/plans.ts`.
- **OpenAI models come from models.dev ONLY, and that is load-bearing.** Every
  LiteLLM layer is consulted BEFORE models.dev, and LiteLLM does not publish
  the gpt-5.x long-context bands — so adding a LiteLLM OpenAI split would
  resolve `gpt-5.6-terra` to its base rates and silently drop the 272K tier.
  Do not add one. Until the `openai` provider was added to `MODELSDEV_SPLITS`
  ccmon carried no OpenAI prices at all: Codex tokens were counted perfectly
  and billed at **$0**.
- **The tier threshold is per-model, not a constant.** `TIER_THRESHOLD`
  (200_000) is Anthropic's and remains the default; `RateRow.tierAt` overrides
  it where a catalog states one. A global constant billed a 250K gpt-5.6 turn
  at double rate. `compactModelsDev` must keep carrying the first CONTEXT band
  through, or the threshold has nothing to apply.
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
- **An account is a HOME, not a source dir.** A Codex home contributes TWO
  source dirs (`sessions`, `archived_sessions`) and is one account, so anything
  rendering or scoping one row per account iterates
  `shared/tools.ts#accountGroups` rather than `sourceDirs` — a duplicate card,
  or a scope that takes `sessions` without `archived_sessions`, is what you get
  otherwise. Root derivation goes through `accountRootFor`: the renderer used to
  strip a trailing `/projects` (a no-op on a Codex dir) while
  `visibleAccountDirs` used `path.dirname`, so the hide-prefs and the wizard
  targeted different roots for the same account.
- **Codex identity is read offline from `<home>/auth.json`.** `auth_mode` gives
  the mode (`chatgpt` | `apikey`); the `tokens.id_token` JWT payload gives
  email, plan (`chatgpt_plan_type`) and org. The signature is NOT verified and
  must not be — ccmon has no key, makes no request, and never presents this
  token to anything; it is display metadata from a 0600 file in the user's own
  home, at the same trust level as reading `.claude.json`. The `plan_type` in
  `rate_limits` (below) is fresher still — the tool writes it every turn.
- **Codex records its own rate limits — read them, never poll.** Every
  `token_count` event carries a `rate_limits` block, so ccmon gets Codex limits
  with NO network call and no credentials, which ccusage does not do at all.
  Verified against Codex's own `/status`: `window_minutes 43200` is what it
  labels "Monthly limit", `used_percent 99` is what it prints as "0% left"
  (Codex shows REMAINING, the field is USED), and `resets_at` is in SECONDS.
  Free plans carry one monthly window; paid plans add a 300-minute primary
  (5 h) and a 10080-minute secondary (weekly), plus purchasable credits.
  THE catch is freshness, not availability: the block rides on a real TURN, and
  `/status` and `/usage` write nothing — so the newest reading can be days
  behind the account's true position. Every surface showing these MUST show
  `observedAt` alongside; the card uses a hollow, still dot and "as of", never
  the pulsing live one. They stay OUT of `LimitsResult`, which means "a poll of
  an authenticated endpoint succeeded" and carries Claude's
  session/week/weekOpus windows — Codex's are duration-labelled and were never
  fetched, so they travel beside it as `toolLimits`. `parseLimits` is its own
  seam hook rather than a `ParsedLine` kind, because one `token_count` line
  yields BOTH a usage entry and a limits reading.
- **Live sessions come from each tool's own registry, never from mtimes.**
  Claude Code keeps `<root>/sessions/<pid>.json` with a `status` it updates
  (busy | idle); Codex keeps one `<home>/thread-writer-locks/<id>.lock` per
  running session and removes it on exit. Liveness is `process.kill(pid, 0)`
  everywhere PLUS a `/proc/<pid>` start-time comparison against the recorded
  `procStart` on Linux — that second check is what rules out a REUSED pid,
  which would otherwise report a long-dead session as running. macOS and
  Windows get the portable probe alone and cannot make that distinction;
  `sessions.test.ts` asserts both behaviours rather than skipping. Codex's
  count is an upper bound (a crashed session leaves its lock); Claude's is
  exact. Polled locally every 10 s and diffed, so an unchanged set is free.
- **Two label functions, and they are not interchangeable.**
  `accounts.ts#accountLabel` is the SHORT tray name ('work-ind');
  `format.ts#sourceLabel` is the renderer's fuller one ('claude-work-ind').
  Both must route through `accountRootFor` — `sourceLabel` used to strip the
  literal `projects` and nothing else, which labelled a Codex account
  "sessions" in the card title, the scope picker AND the plan-limits row.
- **A plan and a tier are different facts.** The plan is the billing
  relationship (Team, Enterprise, personal); the tier is that SEAT's
  rate-limit entitlement, which on a Team org is set per member. Read
  `oauthAccount.userRateLimitTier` BEFORE the credentials' `rateLimitTier`:
  a Team member upgraded to Max 5x has `organizationType: 'claude_team'`,
  `rateLimitTier: 'default_raven'` (an org codename parsing to no multiplier)
  and `userRateLimitTier: 'default_claude_max_5x'`. `plans.ts#planLabel`
  composes the two into "Team - Pro Max x5"; showing either half alone
  describes neither.
- **A personal account's "organization" is a billing artifact.** OpenAI
  auto-creates a one-person org titled "Personal" and makes you its owner;
  Anthropic uses the account holder's own name. Both are truthful and useless
  — `isPersonalPlan` suppresses them so the row names someone OTHER than the
  reader, or nothing.
- **Codex accounts must stay out of Anthropic-only paths.** They have
  credentials, but OpenAI ones. `AdvisorView` filters on `tool === 'claude'`
  BEFORE `hasCredentials`; without that the advisor spends a request on a token
  the Messages API will reject. The compiler cannot catch this one — it is a
  filter, not a type error. Same trap in reverse for the internals: `accounts.ts`
  helpers take a ROOT while the public entry points take a SOURCE DIR, and both
  are `string`, so passing the wrong one reads a path that never exists and
  reports "no stored login" for a perfectly good account. `accounts.test.ts`
  pins it with an expired-token fixture.
- **The rc block is REPLACED, not appended.** It sources one file per tool,
  every line existence-guarded, so its content never depends on which accounts
  exist. `upsertManagedBlock` swaps the marker-delimited region and is a no-op
  when it already matches; it also repairs a truncated block, which the old "any
  `MARK_BEGIN` means linked" rule left broken forever. Without replacement,
  every already-linked user would have kept a block loading only the Claude
  wrappers — their Codex wrappers written and never sourced, with no error to
  point at. This is the one place ccmon rewrites a file it did not create, so it
  stays marker-narrow and goes through `writeAtomic`.
- **The embedded helper scripts are template literals holding shell source**, so
  an escaping slip yields a silently broken script that no unit test reads as
  code. `npx tsx scripts/dump-helpers.ts <dir>` writes them out for `bash -n`
  and the PowerShell parser. The scripts use `$( )` and avoid backticks
  entirely, so `\${` is the only escape in play.
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
- **`npm audit --omit=dev` is NOT the security gate for this project.** Electron
  is a devDependency (electron-builder bundles the runtime at package time), so
  the single most security-relevant thing ccmon ships is invisible to a
  production-only audit — which happily reported "0 vulnerabilities" while
  `electron@42.4.0` carried GHSA-r4w5-6pfg-jxp5. Always audit the FULL tree and
  triage by "does this reach the packaged app?" rather than by dependency
  section. Same trap applies to react/three: bundled, but dev-listed.
- `build/icon.png` is generated and gitignored; electron-builder derives
  `.ico`/`.icns` from it at package time.
