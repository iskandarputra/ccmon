# parity fixture corpus

A miniature `CLAUDE_CONFIG_DIR` root that both ccmon and ccusage can read, so
`npm run parity -- --fixture` can gate CI on a clean checkout. The real
`~/.claude` corpus is still the stronger signal — run bare `npm run parity`
before trusting any change to the parser or the dedupe.

Layout mirrors a real root, including the nesting that trips flat walkers:

```
projects/-tmp-ccmon-parity/sess-a.jsonl
projects/-tmp-ccmon-parity/sess-b.jsonl
projects/-tmp-ccmon-parity/sess-a/subagents/workflows/wf_1/agent-1.jsonl
```

Expected result: **13 deduped entries, 0.000 % drift on all four token fields.**
The entry count is part of the assertion — 17 assistant-usage lines collapse to
13 only if both dedupe rules fire.

## What each case is for

| Case | Where | Asserts |
|---|---|---|
| Plain turn | `msg-001` | baseline |
| Three cumulative streaming chunks, one key | `msg-002` ×3 | best-wins keeps the LARGEST once (350 out, never 450) |
| Complete ephemeral breakdown | `msg-003` | 5m/1h split billed per tier |
| Flat `cache_creation_input_tokens`, no breakdown | `msg-004` | whole total falls to 5m |
| Both ephemeral tiers, summing to the total | `msg-005` | tiered path agrees with ccusage |
| `<synthetic>` model | `msg-006` | parsed without crashing; zero usage either way |
| Usage-limit API error | `msg-007` | reset marker, not a billable entry |
| `speed: "fast"` turn | `msg-008` | the `-fast` suffix does not disturb token totals |
| Non-Anthropic model via base-URL override | `msg-009` | DeepSeek counts on BOTH sides (see the parity gotcha in CLAUDE.md) |
| Compaction summary | — | marker, not an entry |
| `tool_result` user line | — | sized, never billed |
| Malformed JSON | `sess-b` line 3 | a corrupt line loses only itself |
| Subagent entry mirrored into a parent transcript | `msg-020` in both `agent-1.jsonl` and `sess-b.jsonl` | counted ONCE; the non-sidechain copy wins |
| Nested subagent/workflow depth | `wf_1/agent-1.jsonl` | recursive discovery |

## Known divergence — deliberately NOT in this fixture

When `cache_creation` is present but its tiers sum to **less** than
`cache_creation_input_tokens`, the two tools disagree:

- **ccmon** treats `cache_creation_input_tokens` as authoritative and bills the
  unaccounted remainder at the 5m rate (`parser.ts`, the `w5m + w1h < cw`
  branch). Given `{total: 900, 5m: 400, 1h: 100}` it bills 900.
- **ccusage** bills only the breakdown it was given: 500.

Measured, not assumed — an earlier version of this fixture carried that shape
and produced a reproducible 400-token gap on cache writes.

It is excluded here because a permanently-red gate gates nothing. The branch is
covered where it belongs, as a unit test of ccmon's intended behaviour, in
`electron/services/__tests__/parser.test.ts` ("uses the ephemeral breakdown and
bills the remainder as 5m").

This has never fired on the real corpus — bare `npm run parity` is 0.000 % over
~110k entries — so Claude Code appears to always emit a complete breakdown or
none at all. If that ever changes, ccmon's cache-write total will legitimately
exceed ccusage's, and this note is the reason why. Do not "fix" it by deleting
the remainder branch without deciding which number is actually right.
