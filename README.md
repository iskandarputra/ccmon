<h1 align="center">ccmon</h1>

<p align="center"><b>A live dashboard for everything Claude Code does on your machine.</b></p>

<p align="center">
  <a href="https://github.com/iskandarputra/ccmon/actions/workflows/ci.yml"><img src="https://github.com/iskandarputra/ccmon/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white" alt="Electron 42">
  <img src="https://img.shields.io/badge/platform-Linux%20·%20Windows-555555" alt="Linux and Windows">
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-2EA44F" alt="Local-first, no telemetry">
</p>

<p align="center">
  <img src="docs/media/ccmon-hero.gif" alt="ccmon — live Claude Code usage dashboard" width="900">
</p>

<p align="center"><i>Real footage from <code>~/.claude</code>, recorded with <code>npm run promo</code>.</i></p>

Claude Code already writes every response it gives you, with exact token
counts, to local transcript files. ccmon watches those files and turns them
into numbers you can actually read. What today cost. How hot your 5-hour
window is running. Which model is eating the budget. When your limits reset.

No API key. No setup. No telemetry.

## Start

```bash
npm install
npm run dev
```

That's it. ccmon finds `~/.claude` on its own, indexes your history in a few
seconds, then follows along. New responses appear within a second.

## What it knows

**Your real limits, live.** ccmon reads the same numbers the `/usage` screen
in Claude Code reads. Then it learns your pace and tells you when you'll hit
the cap. "Caps around Friday 1am at this pace" is more useful than a
percentage.

**The current 5-hour block.** Burn rate, countdown, and a projection of
where the block lands. Plus 30 days of block history, idle gaps included.

**Plan value.** What this month would have cost on the API, next to what
your subscription costs. The multiple tends to be persuasive.

**Cache economics.** Including the cost of walking away: leave a session
longer than the cache TTL and your next message re-writes context you
already paid for. ccmon counts exactly what that habit costs.

**What-if.** Every request re-priced onto another model. An all-Sonnet
month and an all-Haiku month, next to what you actually spent.

**The small stuff.** Tool usage. Stop reasons. Compactions. Subagent spend.
Spike days. Streaks. Historical pricing, so old months keep their old rates.

**A 3D view.** Nine ways to slice your usage, seven ways to draw each one.
Terrain, ridges, surfaces, a cumulative spend trail that snakes through the
calendar. It is mostly for joy, and that's fine.

Also: nine views on keys `1` to `9`, seventeen themes, and your costs in any
of 160+ currencies, including the top ten crypto. Rates refresh hourly.

## Can I trust the numbers?

Yes, and you can check. An automated parity test (`npm run parity`)
cross-checks the token math against [ccusage](https://github.com/ccusage/ccusage)
(MIT), the established CLI for Claude Code usage reports; current drift is
under 0.005 percent. 58 unit tests cover the parsing, pricing, block, and
forecast math, and CI runs them on every push.

Costs are API list prices. On a Pro or Max subscription, read them as
API-equivalent value rather than an invoice. Where a number is a heuristic,
the panel says so: every analysis has a small "why?" button that explains
exactly how it is computed.

## Privacy

Everything stays on your machine, with three deliberate exceptions you can
see and control in settings:

- model prices refresh daily (LiteLLM catalog, cached, optional)
- plan limits come from Anthropic's usage endpoint, read-only, using the
  login Claude Code already stored
- currency rates refresh hourly (open.er-api.com and CoinGecko)

Turn pricing offline and ccmon runs from bundled snapshots. Nothing is
written anywhere except your own disk.

## Build installers

```bash
./build.sh             # current platform (Linux: .deb + .AppImage)
./build.sh deb         # Debian/Ubuntu package
./build.sh appimage    # portable AppImage
./build.sh win         # Windows NSIS installer + portable exe
./build.sh all         # everything
```

Artifacts land in `release/`. Install the deb with
`sudo apt install ./release/ccmon-*.deb`.

Tagged pushes cut a GitHub release with Linux and Windows artifacts
attached (`.github/workflows/build.yml`):

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Configuration

Optional, at `~/.config/ccmon/config.json`:

```json
{
  "claudeDirs": ["/extra/claude/root"],
  "pricing": {
    "my-custom-model": { "in": 5, "out": 25, "w5m": 6.25, "w1h": 10, "read": 0.5 }
  }
}
```

`claudeDirs` adds data roots beyond `~/.claude` and `~/.config/claude`
(multi-account setups get per-account scoping in settings). `pricing` takes
per-MTok overrides; keys are case-insensitive regexes and always win.

## Under the hood

A pure Node service layer (discover, tail, parse, dedupe, price, aggregate)
lives in the Electron main process and pushes immutable snapshots over a
typed IPC bridge to a sandboxed React renderer with one zustand store. The
services never import Electron, which is why the whole pipeline also runs
headless (`npm run smoke`).

Details in [docs/architecture.md](docs/architecture.md). The data contracts
live in [docs/v2-spec.md](docs/v2-spec.md), and what's planned next in
[docs/analytics-roadmap.md](docs/analytics-roadmap.md).

## Development

```bash
npm run dev        # hot-reload dev build
npm test           # unit tests (vitest)
npm run smoke      # full pipeline against your real data
npm run parity     # token parity vs ccusage
npm run typecheck  # strict tsc, both processes
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## License

MIT © [Iskandar Putra](https://www.iskandarputra.com)
