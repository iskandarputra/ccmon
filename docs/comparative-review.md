# Comparative review — ccmon vs ccusage vs CLIProxyAPI

Honest assessment, 2026-08-06. Every number below was measured on this machine
against the same corpus (5 Claude Code roots, 4206 transcripts, 110,096 deduped
entries, 368 MB under `~/.claude/projects` alone) unless stated otherwise.

The two references are not the same kind of thing, so they are used for
different purposes:

- **ccusage v20.0.19** — the direct competitor. Same input, same domain.
  Compared on correctness, coverage, speed and distribution.
- **CLIProxyAPI v7** — a different domain (Go LLM proxy server, 348k LOC).
  Used only as an _engineering-practice_ benchmark: how a project of that size
  handles plugin seams, config reload, storage abstraction and test discipline.

---

## 0. Verified baseline

| Check                         | Result                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| `npm test`                    | 455 / 28 files → **648 / 38** after §4.1                       |
| `npm run lint`                | 0 errors, 21 documented warnings (added in §4.1)               |
| `npm run format:check`        | clean (added in §4.1)                                          |
| `npm run typecheck`           | clean (node + web projects)                                    |
| `npm run parity`              | **0.000 % drift** on all four token fields vs ccusage v20.0.19 |
| `npm run parity -- --fixture` | 0.000 % on the committed corpus (added in §4.1)                |
| `npm audit`                   | 9 vulnerabilities (1 critical) → **0**, full tree              |
| `npm run smoke`               | 110k entries in **12.0 s** (was 17.4 s), aggregate 611 ms      |

The parity claim in `CLAUDE.md` is real and reproducible. That is the single
most valuable asset this codebase has and it should be defended above
everything else in this document.

> **On the numbers in this document.** One benchmark in the first version was
> wrong — see the correction in §1.2. It was wrong in ccmon's favour, by a
> factor of three, because the two tools were pointed at different corpora. Any
> figure here that is not reproducible by the command printed beside it should
> be treated the same way.

---

## 1. ccmon vs ccusage

### 1.1 Where ccmon is genuinely ahead

These are not close calls. ccusage does not attempt any of them.

- **Analytical depth.** ccusage produces daily / weekly / monthly / session /
  blocks tables. ccmon produces cache-hit savings and would-have-cost, idle
  TTL re-write waste, what-if model substitution, sidechain cost attribution,
  per-tool cost attribution, compaction markers, per-session context gauges,
  block burn-rate and projection, streaks and records, and cross-account
  rollups. On this corpus that is the difference between "you spent $24,304"
  and "$531.92 of that was idle cache TTL re-writes and $4,729.87 went to Bash".
- **Live plan limits.** The 60-second OAuth usage poll, the near-cap
  notification and the tray cap row have no ccusage equivalent.
- **Multi-account management.** `account-setup.ts` generating shell wrappers,
  detecting shells, and doing session hand-off between roots is an entire
  product surface ccusage does not have.
- **Documentation discipline.** `CLAUDE.md` explains _why_ for every gotcha,
  including the ones that cost real debugging time (the `CLAUDE_CONFIG_DIR`
  pin, the `costUSD` field being gone, the `closeToTray` triple guard). This is
  better than ccusage's `AGENTS.md` and on par with CLIProxyAPI's.
- **Privacy mode implemented at the formatter layer** rather than per
  component, so a new panel cannot leak a dollar figure by forgetting a flag.
  Architecturally correct; most projects would have done it per component.
- **Statusline latency under multi-root config.** `--since` windowing answers
  in 0.94 s across 5 roots. ccusage took 6.0 s on the same 5 roots (and
  returned $0.00, so treat that number as indicative, not a clean loss for it).

### 1.2 Where ccusage is clearly ahead

- **Source coverage: 17 adapters vs 2.** ccusage reads Claude Code, Codex,
  OpenCode, Amp, Droid, Codebuff, Hermes, pi-agent, Goose, OpenClaw, Kilo,
  Kimi, Qwen, Copilot CLI, Gemini CLI and Antigravity. ccmon shipped `claude`
  alone when this was written and now also ships `codex` (§4.1). Still the
  largest product gap, and still widening — every new coding CLI is a source
  ccusage picks up for free.

- **Speed: 0.35 s vs ~3.0 s on an identical single root** (335 transcripts;
  `ccusage claude daily --json --offline` vs `./dist-cli/index.cjs json
--offline`, both offline, warm cache, best of three). **~9× slower.**

  > **Correction.** The first version of this document reported 2.7 s vs 7.4 s
  > (~2.8×). That measurement was invalid: `CLAUDE_CONFIG_DIR` pointed ccusage
  > at five roots while ccmon's hidden-account preferences restricted it to
  > three, so the two sides read different corpora — the exact failure
  > `scripts/parity.ts` carries a long comment warning about, and I walked
  > straight into it. Re-measured under an isolated `HOME` with
  > `CLAUDE_CONFIG_DIR` unset so both tools provably read the same 335 files.
  > The honest gap is roughly three times worse than first reported.

  Caveat that does still stand: ccmon builds the full analytic snapshot in that
  time while `ccusage daily` builds day rows. But that does not explain 9×, and
  profiling says it explains almost none of it — see the breakdown below.

  The mechanical reasons are structural: ccusage reads whole files as bytes,
  splits with `memchr`, prefilters with SIMD `memmem` finders built once and
  reused (`rust/crates/ccusage-core/src/fast.rs`), then deserializes surviving
  lines straight into typed structs with `serde_json::from_slice` — no
  intermediate `Value`, no per-line `String`. ccmon does the same _shape_ of
  thing (`parser.mayCarryData` is explicitly modelled on it) but on
  `String.includes` over decoded UTF-8 with `JSON.parse` into a fresh object
  graph, single-threaded with 8-way file concurrency.

- **Where ccmon's time actually goes**, measured on the same corpus rather than
  assumed:

  | Stage                     | 489 files / 35.7k entries | 4204 files / 110k entries |
  | ------------------------- | ------------------------- | ------------------------- |
  | `listFiles` discovery     | 28 ms                     | 72 ms                     |
  | scan (read + parse)       | **6,830 ms**              | **16,656 ms**             |
  | `buildSnapshot` aggregate | 238 ms                    | 723 ms                    |

  Read-and-parse is ~97 % of it. This corrects the remediation priority stated
  earlier in this document: incremental day-bucket aggregation is worth doing,
  but it is optimising the 3 %. **The parse path is the whole gap.** Discovery
  was parallelised while writing this (it was fully serial) and moved warm-cache
  wall time by nothing measurable — 72 ms was never the problem. That change was
  kept because it is cleaner and helps a cold cache, but it is not a win and is
  not reported as one.

- **Distribution.** `npx ccusage@latest` versus downloading an unsigned,
  un-notarized `.dmg` and running an `xattr` command Gatekeeper forces on you.
  ccusage also ships per-platform npm optional dependencies, a Nix flake
  (`nix run github:ccusage/ccusage`), and PR preview builds via pkg.pr.new.
  ccmon ships GitHub release artifacts and a README `ln -sf` one-liner. Even
  granting that an Electron app cannot be `npx`-installed, **the ccmon CLI
  could be** and is not.

- **Tooling rigor.** ccusage has eslint, `typos.toml`, `publint`, a `just`
  recipe set, a pinned Nix dev shell, snapshot tests, and 556 Rust test
  functions. ccmon had **no linter and no formatter of any kind** — consistency
  maintained by one person's habits, which does not survive a second
  contributor. Closed in §4.1 (ESLint + Prettier, both gated in CI); ccusage
  still leads on the rest.

- **Config with a published JSON Schema.** `apps/ccusage/config-schema.json`
  gives IDE autocomplete and validation on every option. ccmon's
  `~/.config/ccmon/config.json` is documented in prose only.

- **Reproducible pricing.** ccusage embeds the LiteLLM pricing file from a
  locked flake input at build time, so a sandboxed build fetches nothing, and a
  scheduled workflow opens a PR when the snapshot changes. ccmon commits
  snapshots and refetches at runtime — which is fine, but the update path is a
  manual `npm run pricing:update` rather than an automated PR.

- **The CLI comparison is not close.** `ccusage`: `daily | weekly | monthly |
session | blocks | statusline`, per-source focus, `--since/--until/--last`,
  `--breakdown`, `--instances`, `--project`, `--by-agent`, `--sections`,
  `--compact`, `--no-cost`, responsive tables. `ccmon`: `json | csv |
statusline`. ccmon's CLI is a data pipe, not a reporting tool.

### 1.3 The strategic question this raises

`CLAUDE.md` describes the CLI as "the SECOND consumer of `electron/services/`,
and the reason the no-Electron rule earns its keep". That is an architectural
justification, not a product one — and it shows. The CLI exists to keep the
services pure, and it does that job well, but it does not compete with ccusage
and is not trying to.

That is a legitimate choice. But it should be made explicitly rather than by
default, because two things follow from it:

1. If the CLI is a convenience, the README should not present it as a headline
   feature — it invites exactly the comparison it loses.
2. If the CLI _should_ compete, the gap is smaller than it looks: the snapshot
   already contains everything `daily/weekly/monthly/session/blocks` need. What
   is missing is a table renderer and an argument surface, not analysis.

Same question applied to the adapter seam, and this one is now **settled**.
`ADAPTERS = [claudeAdapter]` made it a _speculative_ abstraction defended by a
test fixture. Landing Codex (§4.1) settled it in the affirmative — and, more
usefully, proved the seam was the wrong shape:

> `SourceAdapter.parseLine` assumed every line is self-describing. That is true
> of Claude Code and false of Codex, whose usage events take their model from
> an earlier `turn_context` line and their speed tier from an earlier
> `thread_settings_applied`. A Codex line read in isolation cannot be priced.
> Fitting it required adding `createState` to the interface, with the watcher
> owning the per-file lifetime.

No amount of designing against one format would have surfaced that. It is the
concrete demonstration of the point §2 makes abstractly: an abstraction with
one implementation is a hypothesis. The correct move was not to defend the
original interface but to let the second implementation correct it.

---

## 2. ccmon vs CLIProxyAPI (engineering practice only)

Different domain, so nothing here is a feature comparison. These are the
practices worth stealing.

- **Its seams are load-bearing.** CLIProxyAPI has `sdk/pluginabi`,
  `sdk/pluginstore`, `internal/pluginhost`, a model registry, per-provider
  translators and per-provider executors — five or more real implementations
  behind each interface. An abstraction with five implementations is proven;
  `SourceAdapter` had one plus a fixture. It now has two (§4.1), and the second
  immediately forced an interface change — which is the evidence for this
  point, not against it. Two is proven; two is still not five.

- **Canonical representation → per-provider translation.** `internal/thinking/`
  parses provider-specific input, normalizes to one canonical `ThinkingConfig`,
  validates centrally, then applies per-provider output via a `ProviderApplier`
  — and `AGENTS.md` explicitly forbids breaking that shape. ccmon's
  `shared/providers.ts` (111 lines) is the right idea at 1/20th the ambition,
  and provider handling elsewhere (Bedrock/Vertex `isApiKeyOnly`, DeepSeek
  handled as an entirely separate service with its own history, key store, card
  and view) is _not_ funnelled through a canonical shape. Adding a second
  API-key provider today would mean copying `deepseek*.ts` three times. That is
  the strongest concrete lesson from this codebase.

- **Storage abstraction.** File / Postgres / git / object store behind one
  interface with secret resolution. ccmon writes JSON files directly from
  eight-plus call sites. Not wrong for a local-first app, but there is no seam
  at all if one is ever needed.

- **Config hot-reload as a first-class subsystem** — `internal/watcher/` with
  `config_reload.go`, a `diff` package, a `dispatcher` and a `synthesizer`.

- **Test discipline: 448 Go test files, including `test/` cross-module
  integration tests and a `claude_code_compatibility_sentinel_test.go`.** The
  sentinel idea is directly applicable: ccmon's equivalent of that sentinel is
  `npm run parity`, and it is **not in CI**.

- **Conventions are enforced, not merely described.** `AGENTS.md` mandates
  `gofmt`, bans `log.Fatal`, bans post-connection timeouts with an explicit
  allow-list of exceptions, and puts an ownership gate on `internal/translator/`
  requiring a permission check before standalone edits. ccmon's `CLAUDE.md` is
  descriptively excellent and prescriptively unenforced — nothing mechanically
  stops a contributor from importing Electron into `electron/services/`.

---

## 3. Concrete defects and risks found in ccmon

Ordered by how much they would cost to be wrong about.

1. **The adapter seam leaks in `watcher.watch()`.** `watcher.ts:407` hardcodes
   `!p.endsWith('.jsonl')` in the chokidar `ignored` predicate instead of
   calling `adapter.owns(p)`. Initial indexing routes through `owns` correctly;
   _live tailing does not_. A second adapter whose files are not `.jsonl` would
   index on startup and then never see another append — silently, with no
   error. The predicate is also built once from a single `Date.now()` cutoff
   and shared across every root.

2. **`watcher.ts` has no dedicated test file.** `accept()` and `merge()` — the
   best-wins dedupe that the entire 0.000 % parity result rests on — are
   covered only indirectly by `adapters.test.ts` (10 cases, mostly adapter
   routing). There is no direct unit test asserting that non-sidechain beats
   sidechain, that a larger cumulative chunk wins, that `tools`/`stop` upgrade
   but never downgrade, or that the `byMsg` cross-boundary path sets the
   `byKey` shortcut. Parity is an end-to-end check that needs the network and a
   real corpus; it cannot localize a regression in `merge()`. This is the
   highest-value test gap in the repo.

3. **`listFiles()` mutates a shared closure variable.** `owns` is declared once
   at `watcher.ts:238` and reassigned per root at `:265`, captured by reference
   inside `walk`. Correct today only because roots are walked sequentially with
   `await`. Anyone who parallelizes that loop for speed — an obvious
   optimization given §1.2 — silently cross-assigns adapters.

4. **Aggregate cost is understated in the docs.** `CLAUDE.md` says "~200 ms at
   45k entries" with a "known wall at ~200k". Measured: **723 ms at 110k**.
   That is superlinear against the documented figure, puts ~200k at well over a
   second, and means a debounced full recompute already burns 0.7 s of
   main-process CPU per burst on a real corpus today — not at some future wall.
   The incremental day-bucket fix in the roadmap is more urgent than its
   placement there suggests.

5. ~~**No Content-Security-Policy.**~~ **Withdrawn — this was wrong.** A strict
   CSP _is_ injected at build time by a Vite plugin (`vite.config.ts:19-28`,
   `apply: 'build'`) and does land in the packaged renderer; I had grepped
   `index.html`, `electron/` and `src/` and missed the config. Deliberately
   build-only, because the dev server needs inline scripts for Fast Refresh.

   What was actually missing was a **`will-navigate` guard**:
   `setWindowOpenHandler` only covers _new_ windows, so a top-level navigation
   in the existing one would swap the app for a remote page with the preload
   bridge still attached. Fixed. The rest of the posture was already good —
   `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
   window-open denied, `openExternal` gated on `https://`, and the advisor's
   Markdown renderer is hand-rolled React with no `dangerouslySetInnerHTML`
   anywhere in `src/`.

6. **`main.ts` is 1336 lines and holds real, untestable logic.**
   `recomputeSig`, `sourceScope`, `visibleEntries`, `deepseekCostBetween`,
   `maybeNotifyCap` and `withDeepseekDerived` are pure decisions living behind
   an Electron import. The project's own no-Electron discipline is applied at
   the services boundary but not _toward_ it: the rule keeps Electron out of
   services rather than pushing logic out of main. `status-text.ts` is the
   proof this works when done — it should be the pattern, not the exception.

7. **CI is Linux-only and shallow.** `ci.yml` runs typecheck plus unit tests on
   ubuntu-latest, node 22. It never builds, never runs `smoke`, never runs
   `parity`, and never runs on macOS or Windows. `keychain.ts` shells out to
   macOS `security(1)` and `account-setup.ts` emits PowerShell — both are only
   ever exercised against mocks, on Linux. `build.yml` does have the three-OS
   matrix, but it only fires on tags, so the first time a macOS-specific break
   is observed is during a release.

8. **No linter or formatter.** See §1.2.

9. **Renderer is effectively untested.** 12,733 lines across `src/`, four test
   files, all in `src/lib/`. Zero component tests, zero store tests, no
   Electron e2e. `InsightsView.tsx` (1217 lines) and `SpatialView.tsx` (1258
   lines) are single files carrying the most complex presentation logic in the
   app.

10. **`CLAUDE.md` drift.** Says 443 test cases; actual is 455. Trivial on its
    own, but the file is the project's contract and stale numbers erode trust
    in the ones that matter (like the parity claim, which _is_ accurate).

11. **An undocumented ccusage divergence on cache-write tiers**, found while
    building the CI fixture. Where `cache_creation` sums to less than
    `cache_creation_input_tokens`, ccmon bills the remainder at 5m and ccusage
    does not: on `{total: 900, 5m: 400, 1h: 100}` ccmon says 900, ccusage says 500. It never fires on the real corpus, which is why parity has stayed at
    0.000 %, but nothing recorded that the two tools _would_ disagree. Now
    documented in `CLAUDE.md` and `scripts/fixtures/parity/README.md`.

---

## 4. Remediation

### 4.1 Done

**Correctness — the parity claim**

- **Fixed the seam leak** (defect 1). `watch()` iterates `this.roots` and closes
  over each root's own `adapter.owns`. Confirmed a real bug: the new live-tail
  test sees 0 entries after an append on the old code, 1 on the fixed code.
- **Fixed the shared-closure hazard** (defect 3) — which then made the
  concurrent directory walk safe to write.
- **`watcher.test.ts`**, 32 cases pinning each dedupe rule separately, plus
  incremental tailing, partial-line reassembly, truncation, corrupt-line
  isolation and `sinceMs`.
- **Committed parity corpus** + `parity.ts --fixture`. 17 assistant-usage lines
  collapse to 13 entries and both tools agree at 0.000% — the entry count
  itself asserts both dedupe rules fired. This is what made parity a CI gate.
- **Documented an unrecorded ccusage divergence** (defect 11) found by it.

**Performance — the headline gap**

Read-and-parse was 97% of scan time (§1.2). Two exact changes, no semantic
drift:

- **Byte-level line splitting.** The tailer no longer runs a `StringDecoder`
  over whole chunks; it splits on the `0x0A` byte and keeps a `Buffer`
  remainder. Safe because no byte of a UTF-8 multibyte sequence can be `0x0A`.
- **A byte prefilter before decode** (`SourceAdapter.mayCarryData`), so a line
  that cannot carry data is never decoded, never allocated as a string and
  never parsed — the same trick as ccusage's SIMD `memmem`, via
  `Buffer.indexOf`. Paired with `parseLineChecked` so the surviving lines are
  not re-scanned as strings.

**Full corpus 17.4 s → 12.0 s; single root 2.9 s → 1.8 s (−37%), both at
0.000% parity.** The remaining anatomy is now measured and recorded in
`CLAUDE.md` rather than guessed: `tool_result` lines are 56% of surviving bytes
and are parsed only to sum a character count, which is the next lever and a
product decision rather than a refactor.

**Product**

- **A real Codex adapter** — `~/.codex/sessions` + `archived_sessions`,
  cumulative-total delta recovery, service-tier → fast flag, `gpt-5` fallback,
  and the `input − cached` mapping ccusage treats as canonical (billing raw
  input would double-charge every cached prompt token). Dedupe is
  content-addressed, so an archived duplicate and a MultiAgent subagent replay
  both collapse through the existing best-wins merge. 29 tests.
- **The seam changed shape because of it.** `parseLine` assumed
  self-describing lines; Codex's model comes from an earlier `turn_context` and
  its tier from an earlier `thread_settings_applied`. That forced `createState`,
  with the watcher owning the per-file lifetime.
- **Pointed the CLI at every adapter** — it was on `detectProjectDirs` while
  the app used `detectSourceRoots`, so `ccmon json` would have under-reported
  next to the UI. `smoke.ts` too; `parity.ts` deliberately stays Claude-only.

**Engineering hygiene**

- **ESLint + Prettier**, gated in CI, zero errors. The one project-specific rule
  is a `no-restricted-imports` ban on Electron inside `electron/services/` —
  the invariant that keeps smoke, the CLI and every unit test possible,
  previously enforced by nothing but discipline. 21 warnings remain, all
  React-Compiler-era rules, deliberately `warn` and explained in
  `eslint.config.mjs`.
- **Electron 42.4.0 → 42.8.1** (GHSA-r4w5-6pfg-jxp5) and `npm audit fix`:
  **9 vulnerabilities → 0** across the full tree.
- **Extracted the last pure logic out of `main.ts`** — `scope.ts` (source
  scoping, 19 tests), `recompute.ts` (the snapshot-invalidation signature, 19
  tests), `accountLabel` and `capAlerts` into `accounts.ts` (13 tests).
- **Tests for every previously-untested service**: settings, config,
  window-state, pricing-archive, currency, advisor. Plus the first renderer
  tests — the zustand store's ring buffer and the settings bridge.
- **Untracked `dist-cli/*`**, which `.gitignore` already listed but which had
  been committed before the rule existed, so every build dirtied the tree.
- **Fixed an inert shebang** in `scripts/inspect-data.cjs`.

Test suite **455 → 648**. Every service now has a test file. Verified after
every change: lint clean, format clean, typecheck clean, 648 tests, smoke OK,
fixture parity 0.000%, **and real-corpus parity still 0.000%**.

### 4.2 Remaining

1. **`tool_result` parsing** — 56% of surviving scan bytes, spent on one
   analytics number. Needs a decision about that number, not a refactor.
2. **Worker threads** for the scan. Embarrassingly parallel per file; the
   blocker is packaging a worker across dev/tsx, the CLI bundle and the asar.
3. **What is the CLI for** (§1.3). Still the only place the docs claim more
   than the code delivers. Publishing it to npm would close the distribution
   gap far more cheaply than building a table renderer.
4. **Promote the 21 React lint warnings to errors**, once the components they
   touch have tests. The store now has some; the views do not.
5. **Incremental day-bucket aggregation** — 610 ms per burst, and now only 3%
   of the scan, so genuinely last.
6. **More adapters.** Mechanical now that the seam is proven; Gemini CLI next.

## 5. Bottom line

ccmon is a better-engineered codebase than its position in the ecosystem
suggests, and the evidence for that is not the prose — it is that the parity
result survived a new adapter, a rewritten discovery walk, a rewritten read
path and an interface change, without moving a single token.

Against ccusage, on the three axes that decide which tool people run:

- **Speed.** Was ~9× on an identical corpus. The read path is now 37% faster at
  exact parity, and the remaining gap is measured rather than assumed — 56% of
  it sits in one clearly identified place. Still slower; no longer mysterious.
- **Coverage.** 1 source → 2, of 17. The architectural question is closed;
  what is left is volume.
- **Install friction.** Untouched, and now the largest unaddressed gap.
  Publishing the CLI to npm is the cheap version of closing it.

Against CLIProxyAPI as an engineering benchmark: the seam is load-bearing now.
Codex did not merely populate the registry — it corrected the interface, which
is the difference between an abstraction that is proven and one that is
asserted. Two implementations is proven. Two is still not five.

What has not changed is §1.3. ccmon is an application whose CLI is a
by-product of an architectural rule. That is defensible, and it is still the
one thing nobody has written down — the last place the documentation claims
more ambition than the code carries.

One process note worth keeping. The single worst error in the first draft of
this document was a benchmark that compared two different corpora and reported
a 3× rosier number than the truth. `parity.ts` carries a long comment warning
about exactly that trap, written by someone who had already fallen into it. The
lesson generalises past benchmarks: pin the inputs, or the result describes
nothing.
