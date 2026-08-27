<h1 align="center">ccmon</h1>

<p align="center"><b>A live dashboard for everything Claude Code and Codex CLI do on your machine.</b></p>

<p align="center">
  <a href="https://github.com/iskandarputra/ccmon/actions/workflows/ci.yml"><img src="https://github.com/iskandarputra/ccmon/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white" alt="Electron 42">
  <img src="https://img.shields.io/badge/platform-Linux%20·%20Windows%20·%20macOS-555555" alt="Linux, Windows and macOS">
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-2EA44F" alt="Local-first, no telemetry">
</p>

<p align="center">
  <!-- ?v= is a cache-buster: GitHub proxies README images and serves the old
       bytes from cache long after the file changes. Bump it whenever the gif
       is re-recorded, or the page keeps showing the previous build. -->
  <img src="docs/media/ccmon-hero.gif?v=1.12.0" alt="ccmon, a live Claude Code usage dashboard" width="900">
</p>

<p align="center"><i>A scripted tour across a synthetic multi-account dataset, recorded with <code>npm run promo</code>.</i></p>

Claude Code and Codex CLI already write every response they give you, with
exact token counts, to local log files. ccmon watches those files and turns
them into numbers you can actually read. What today cost. How hot your 5-hour
window is running. Which model is eating the budget. When your limits reset.

Both tools, in one dashboard, side by side — with each one's own accounts,
plans and rate limits.

No API key. No setup. No telemetry.

## Start

```bash
npm install
npm run dev
```

That's it. ccmon finds your data on its own:

| Tool | Where it looks |
|---|---|
| Claude Code | `~/.claude/projects/`, plus any sibling `~/.claude-<name>` root from a multi-account setup, and `$CLAUDE_CONFIG_DIR` |
| Codex CLI | `${CODEX_HOME:-~/.codex}/sessions/` and `archived_sessions/` |

It indexes your history, then follows along. New responses appear within a
second. First index is a few seconds for a normal history; allow a minute if
you have thousands of sessions.

## What it knows

**Your real limits.** For Claude Code, ccmon reads the same numbers the
`/usage` screen reads, live. Then it learns your pace and tells you when
you'll hit the cap — "caps around Friday 1am at this pace" is more useful than
a percentage. For Codex, the limits are written into the session log itself,
so ccmon reads them with no network call at all; they carry an "as of" stamp
because they are only ever as fresh as your last real turn.

**Every account, side by side — across both tools.** ccmon shows each
account's identity, plan and limits at once, whichever CLI it belongs to, and
how many sessions each one has running right now. When a Claude account is
about to cap while another sits idle, it tells you, and hands you the exact
`claude-cross-resume` command to pick up where you left off on the account
that still has room. Codex gets the same treatment via `codex-cross-resume`.
A setup wizard writes the per-shell `claude-*` and `codex-*` wrappers for you.

**The current 5-hour block.** Burn rate, countdown, and a projection of
where the block lands. Plus 30 days of block history, idle gaps included.

**Plan value.** What this month would have cost on the API, next to what
your subscription costs. The gap is usually bigger than you'd expect.

**Cache economics.** Including the cost of walking away: leave a session
longer than the cache TTL and your next message re-writes context you
already paid for. ccmon counts exactly what that habit costs.

**What-if.** Every request re-priced onto another model. An all-Sonnet
month and an all-Haiku month, next to what you actually spent.

**The small stuff.** Tool usage. Stop reasons. Compactions. Subagent spend.
Spike days. Streaks. Historical pricing, so old months keep their old rates.

**A 3D view.** Nine ways to slice your usage, seven ways to draw each one.
Terrain, ridges, surfaces, a cumulative spend trail that snakes through the
calendar. It's mostly there for fun, and that's fine.

**Both tools priced properly.** Codex's tokens are cumulative and its
`input_tokens` includes the cache, so a naive reading double-charges every
cached prompt. Its long-context tier starts at 272K, not Anthropic's 200K.
Its auto-review turns record a model id that no price list carries. ccmon
handles each of those, and `npm run parity` proves the Claude side still
matches ccusage exactly.

Also: twelve views — keys `1` to `9` jump to the first nine, and a `⌘`/`Ctrl`+`K`
command palette jumps anywhere, including a links page of official Claude
and Anthropic channels and status pages. Seventeen themes (dracula pro by
default), and your costs in any of 160+ currencies, including the top ten
crypto. Rates refresh hourly.

## Can I trust the numbers?

Yes, and you can check. An automated parity test (`npm run parity`)
cross-checks the token math against [ccusage](https://github.com/ccusage/ccusage)
(MIT), the established CLI for coding-agent usage reports; current drift is
**0.000 percent** — an exact integer match on all four token fields across
29,230 entries. 808 unit tests cover the parsing, pricing, block, forecast,
account and shell-integration logic, and CI runs them on Linux, macOS and
Windows on every push.

Costs are API list prices. On a Pro or Max subscription, read them as
API-equivalent value rather than an invoice. Where a number is a heuristic,
the panel says so: every analysis has a small "why?" button that explains
exactly how it is computed.

## Privacy

Everything stays on your machine, with three deliberate exceptions you can
see and control in settings:

- model prices refresh daily (LiteLLM and models.dev catalogs, cached,
  optional)
- Claude plan limits come from Anthropic's usage endpoint, read-only, using
  the login Claude Code already stored
- currency rates refresh hourly (open.er-api.com and CoinGecko)

Codex adds none of these. Its rate limits, plan and identity are all read from
files it already wrote on your disk — no OpenAI request is ever made.

Turn pricing offline and ccmon runs from bundled snapshots. Nothing is
written anywhere except your own disk.

## Running Claude Code on DeepSeek

Claude Code talks to any Anthropic-compatible endpoint, so it can run on
DeepSeek — roughly 35× cheaper per input token than Opus, 86× cheaper per
output token. Doing it by hand means knowing ten environment variables, several
undocumented. ccmon generates them:

1. **Get a key** at [platform.deepseek.com](https://platform.deepseek.com), and
   connect it in ccmon's **DeepSeek** panel. That enables balance and runway
   tracking, and the setup wizard reuses the same key — you never type it twice.
2. **Accounts → multi-account setup → `~/.claude-` `deepseek` → create.** Its
   own config dir is what keeps DeepSeek usage separately attributed; a
   transcript records no account identity, so sessions written into `~/.claude`
   are indistinguishable from your subscription work.
3. On the new row, click **+ env → DeepSeek**. That fills in the base URL, the
   model mapping for all three tiers, the capability flags Claude Code needs to
   keep effort/thinking enabled on an unrecognised model, and a
   `${ccmon:deepseek-key}` reference to your stored key.
4. **Preview**, check the diff (the key shows masked — the real value is only
   written to disk), then **apply**. Open a new terminal.

```bash
claude-deepseek                        # a session on DeepSeek
claude-deepseek-from-personal <id>     # move a running session onto DeepSeek
```

Both wrappers export the same environment, so a resumed session keeps DeepSeek
rather than silently falling back to Anthropic. ccmon prices DeepSeek models
from its own bundled catalog, so the spend shows up in every view alongside
your Claude usage.

Model ids move. If DeepSeek renames one, edit the env box — it is plain
`KEY=value` text, and the preset is only a starting point.

## Build installers

```bash
./build.sh             # current platform (Linux: .deb + .AppImage)
./build.sh deb         # Debian/Ubuntu package
./build.sh appimage    # portable AppImage
./build.sh win         # Windows NSIS installer + portable exe
./build.sh mac         # macOS .dmg + .zip (run on a Mac; unsigned)
./build.sh all         # Linux + Windows
```

Artifacts land in `release/`. Install the deb with
`sudo apt install ./release/ccmon-*.deb`. Tagged pushes cut a GitHub release
with Linux, Windows and macOS artifacts attached
(`.github/workflows/build.yml`):

```bash
git tag v1.13.0 && git push origin v1.13.0
```

### The `ccmon` command line

Every build ships the headless CLI alongside the app, at
`<install>/resources/cli/index.cjs`. It is not put on your `PATH`
automatically — that needs a root-run install hook, which is not worth the
risk for a convenience — so link it once yourself:

```bash
# Debian/Ubuntu install
sudo ln -sf /opt/ccmon/resources/cli/index.cjs /usr/local/bin/ccmon

# from a source checkout
npm run build:cli && sudo ln -sf "$PWD/dist-cli/index.cjs" /usr/local/bin/ccmon

ccmon --help
ccmon json --range 30d --section totals,models --pretty
ccmon json | jq '.totals.cost'
ccmon csv days --since 20260101 > days.csv
```

On **Windows** there is no shebang and no executable bit, so the build ships a
`ccmon.cmd` launcher next to `index.cjs`. Add its folder to `PATH` (or call it
by full path):

```powershell
# installed build
$env:Path += ";$env:LOCALAPPDATA\Programs\ccmon\resources\cli"
ccmon --help

# from a source checkout
npm run build:cli; .\dist-cli\ccmon.cmd json --range 30d
```

It reads the same data and settings as the app, never writes anything, and
never polls your login — plan limits come from the history the app already
persisted. Useful as a Claude Code statusline:

```json
{ "statusLine": { "type": "command", "command": "ccmon statusline" } }
```

On Windows, point it at the launcher (JSON needs the backslashes doubled):

```json
{ "statusLine": { "type": "command", "command": "C:\\Users\\me\\AppData\\Local\\Programs\\ccmon\\resources\\cli\\ccmon.cmd statusline" } }
```

### macOS: first launch

The Mac builds are unsigned and un-notarised — ccmon has no paid Apple
Developer ID — so Gatekeeper refuses a downloaded `.dmg` with *"ccmon is
damaged and can't be opened"*. That message is about the missing signature,
not the download. Clear the quarantine attribute once after copying the app to
`/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/ccmon.app
```

Both `arm64` and `x64` builds are published; take the one matching your Mac.
Building from source (`./build.sh mac`) produces an app that runs without this
step.

### macOS: plan limits and the Keychain

Claude Code stores its login in the **login Keychain** on macOS, not in
`~/.claude/.credentials.json`. ccmon reads that Keychain item (via
`security(1)`, read-only) so live plan limits, the tray cap row, the near-cap
alert and the AI advisor work there. One limitation: the item carries nothing
identifying a `CLAUDE_CONFIG_DIR`, so it is only used for the default
`~/.claude` account — a second account root on macOS needs its own
`.credentials.json`, and ccmon says so instead of guessing.

## Configuration

Optional, at `~/.config/ccmon/config.json`:

```json
{
  "claudeDirs": ["/extra/claude/root"],
  "codexDirs": ["/extra/codex/home"],
  "pricing": {
    "my-custom-model": { "in": 5, "out": 25, "w5m": 6.25, "w1h": 10, "read": 0.5 }
  }
}
```

`claudeDirs` adds data roots beyond `~/.claude` and `~/.config/claude`;
`codexDirs` does the same for Codex homes beyond `$CODEX_HOME` (which ccmon
also accepts as a comma-separated list). Each is routed to its own reader, so
a Claude root is never parsed as a Codex home. Multi-account setups get
per-account scoping in settings.

`pricing` takes per-MTok overrides; keys are case-insensitive regexes and
always win, and they reach every field the engine uses — tier rates, the
threshold those tiers start at (`tierAt`; 200k for Anthropic, 272k for
OpenAI), the context window and the `-fast` multiplier, not just the five base
rates.

`modelAliases` and `projectAliases` rename model ids and project paths for
display only:

```json
{ "modelAliases": { "claude-opus-5": "opus" },
  "projectAliases": { "/home/me/work/api-v2": "api" } }
```

They are applied at format time, never before pricing or grouping — aliasing
two ids to one label would merge distinct models.

## Under the hood

A pure Node service layer (discover, tail, parse, dedupe, price, aggregate)
lives in the Electron main process and pushes immutable snapshots over a
typed IPC bridge to a sandboxed React renderer with one zustand store. The
services never import Electron, which is why the whole pipeline also runs
headless (`npm run smoke`).

Supporting a second CLI takes two small registries, joined by id. A **source
adapter** owns what is format-specific — where the logs are, which files carry
usage, how a line becomes an entry. A **tool profile** owns what is
install-specific — which env var selects the home, what a shell wrapper is
called, where the credentials live. They stay separate because the adapters
are stateless singletons that the headless CLI imports under plain Node, while
account setup writes shell startup files and reads credential stores.

Details in [docs/architecture.md](docs/architecture.md). The data contracts
live in [docs/v2-spec.md](docs/v2-spec.md), and what's planned next in
[docs/analytics-roadmap.md](docs/analytics-roadmap.md).

## Development

```bash
npm run dev        # hot-reload dev build
npm test           # unit tests (vitest)
npm run smoke      # full pipeline against your real data
npm run parity     # token parity vs ccusage (npx + network)
npm run typecheck  # strict tsc, both processes
npm run cli -- json --range 30d   # the headless CLI, straight from source
npm run promo      # re-record the tour; publishes docs/media/ccmon-hero.gif
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## License

MIT © [Iskandar Putra](https://www.iskandarputra.com)
