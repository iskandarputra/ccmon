# Codex account setup — design

**Date:** 2026-08-27
**Status:** approved, ready for implementation planning
**Scope:** full parity between Claude Code and Codex CLI in ccmon's account
layer — discovery config, account identity, the setup wizard, and cross-account
resume.

---

## 1. Problem

ccmon already *reads* Codex. `electron/services/adapters/codex.ts` is a real
source adapter: it discovers `${CODEX_HOME:-~/.codex}/sessions` and
`archived_sessions`, parses rollout logs, and prices them. Codex tokens flow
into every aggregate the app computes.

What ccmon does not do is treat a Codex install as an *account*. Everything
above the adapter seam assumes an account is a `CLAUDE_CONFIG_DIR`:

| Site | Assumption |
|---|---|
| `accounts.ts#accountInfo` | `<root>/.claude.json` + `<root>/.credentials.json` |
| `accounts.ts#accountLabel` | strips `^\.claude-?`; `~/.codex` → the literal `.codex` |
| `account-setup.ts#suggestLabel` | always emits `claude-*` |
| `account-setup.ts#crossPairs` | pairs every account with every other |
| `account-setup.ts#MANAGED_FILE` | one file, `claude-accounts.sh` |
| `account-setup.ts#createAccountDir` | `~/.claude-<suffix>/projects` |
| `crossAccount.ts#accountRoot` | strips a trailing `/projects` |
| `AdvisorView.tsx` | offers any `hasCredentials` account an Anthropic token |

The consequence today: a Codex home is scanned and counted, but it has no
account row, no label, no wrapper, and — worst — `accountRoot()` and
`visibleAccountDirs()` derive *different* roots for it, so hide-prefs and the
wizard disagree about what the account even is.

## 2. Goals

1. Multiple Codex homes are discoverable and configurable, the same way
   multiple Claude roots are.
2. A Codex home is a first-class account row: label, identity, hide/show.
3. The setup wizard generates `codex-<name>` launcher wrappers.
4. Cross-account resume works for Codex: `codex-<to>-from-<from>`.

**Non-goals.** No Codex limits polling (OpenAI publishes no endpoint ccmon can
read with these credentials, and the poller must stay read-only). No Codex
long-context pricing tier — that is a pricing-engine gap tracked separately. No
token refresh, ever: same rule as Claude, rotating a refresh token could log the
user out of the CLI ccmon is monitoring.

## 3. Architecture: a tool registry beside the adapter registry

The chosen shape is a `ToolProfile` registry that parallels `ADAPTERS`, split
across two files by what each half is allowed to touch.

```
shared/tools.ts                    pure   — renderer + main + CLI
  ToolProfile { id, label, bin, homeEnvVar, dataDirs,
                rootFor, suggestWrapperName, isDefaultRoot,
                managedFile, helperName }
  TOOLS: ToolProfile[]
  toolFor(sourceDir): ToolProfile
  accountGroups(sourceDirs): AccountGroup[]

electron/services/tools/identity.ts  fs     — main + CLI, never Electron
  claudeIdentity(root): AccountInfo | null
  codexIdentity(root):  AccountInfo | null
```

**Why not extend `SourceAdapter`.** Adapters are shared singletons consumed by
the CLI and `smoke` under plain node, and `adapters/types.ts:62` already
requires them to hold no state because the app and CLI each run a watcher over
the same instances. Account setup writes shell rc files and reads credential
stores — app-only concerns. Loading those onto `SourceAdapter` makes the CLI
import code it can never call. The two registries join on `adapter.id ===
profile.id`, documented at both.

**Why not inline branching.** `account-setup.ts` is 1258 lines. Nine sites
hardcode `claude`; branching each one in place is the change that pushes the
file past what one file should hold, and makes a third tool a rewrite.

**Why the pure/fs split.** `src/lib/crossAccount.ts:174` currently carries a
hand-maintained copy of `suggestLabel` with the comment "mirrors
`electron/services/account-setup.ts`, which can't import from `src/`". `shared/`
is importable by both processes, so putting the pure naming and root-derivation
logic there retires that duplication instead of doubling it.

### 3.1 `ToolProfile`

```ts
export interface ToolProfile {
  /** joins to SourceAdapter.id */
  id: 'claude' | 'codex';
  /** UI label, e.g. 'Claude Code' */
  label: string;
  /** the executable a wrapper invokes */
  bin: string;
  /** env var a wrapper exports to select the home, e.g. 'CLAUDE_CONFIG_DIR' */
  homeEnvVar: string;
  /** subdirs of a home that carry usage, in scan order */
  dataDirs: string[];
  /** source dir → the account root (home) it belongs to */
  rootFor(sourceDir: string): string;
  /** root → default wrapper command name */
  suggestWrapperName(root: string): string;
  /** true for the root the bare CLI falls back to when the env var is unset */
  isDefaultRoot(root: string): boolean;
  /** basename of the managed wrapper file, per shell family */
  managedFile: Record<'posix' | 'powershell', string>;
  /** basename of the cross-resume helper */
  helperName: string;
}
```

Concrete values:

| Field | claude | codex |
|---|---|---|
| `bin` | `claude` | `codex` |
| `homeEnvVar` | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| `dataDirs` | `['projects']` | `['sessions', 'archived_sessions']` |
| `rootFor` | strip trailing `/projects` | strip trailing `/sessions` or `/archived_sessions` |
| `suggestWrapperName` | `~/.claude` → `claude-personal`; `~/.claude-X` → `claude-X` | `~/.codex` → `codex-personal`; `~/.codex-X` → `codex-X` |
| `isDefaultRoot` | basename `.claude` | basename `.codex` |
| `managedFile` | `claude-accounts.sh` / `.ps1` | `codex-accounts.sh` / `.ps1` |
| `helperName` | `claude-cross-resume` | `codex-cross-resume` |

`toolFor(sourceDir)` matches on the source dir's basename against each profile's
`dataDirs`, defaulting to `claude`. This is the single place the mapping lives;
`accountRoot()` and `visibleAccountDirs()` both route through it, which is what
fixes the disagreement described in §1.

### 3.2 Account grouping

A Codex home contributes **two** source dirs (`sessions`, `archived_sessions`)
but is **one** account. `visibleAccountDirs` already keys hide-prefs on
`path.dirname(dir)`, which collapses both to `~/.codex` — grouping is therefore
consistent with the pref store as it stands today.

`AccountsMap` stays keyed by source dir. That is deliberate: `accounts[dir]` is
read at six call sites across five components, and re-keying it is a wide, risky
change for no gain. Both Codex source dirs map to the *same* `AccountInfo`
value. Views that render one row per account iterate `accountGroups()` instead:

```ts
export interface AccountGroup {
  root: string;          // ~/.codex
  tool: ToolProfile;
  dirs: string[];        // [~/.codex/sessions, ~/.codex/archived_sessions]
}
```

Affected: `AccountsView` grid, `SettingsView` source list, the scope picker.

## 4. Discovery and config

Two fixes, both latent bugs today:

1. **`detectSourceRoots(extra)` passes the same `extra` to every adapter.** A
   user's `claudeDirs` entries are currently probed as Codex homes
   (`<entry>/sessions`). Change the parameter to
   `Record<adapterId, string[]>`, so each adapter gets its own extras.
2. **`CODEX_HOME` is read as a single path** (`codex.ts:121`), while
   `CLAUDE_CONFIG_DIR` is comma-split through `paths.ts#splitPathList`. Codex
   itself accepts one path, but ccmon *monitors* rather than launches, so
   accepting a list costs nothing and matches the Claude side.

`UserConfig` gains `codexDirs?: string[]`, expanded with the existing
`expandHome`. Documented in the `config.ts` header block alongside `claudeDirs`.

## 5. Identity

`codexIdentity(root)` reads `<root>/auth.json` and returns the same
`AccountInfo` shape:

```
auth.json
  auth_mode                                  → 'chatgpt' | 'apikey'
  OPENAI_API_KEY                             → presence only, never read out
  tokens.id_token   (JWT, base64url payload)
    email                                    → AccountInfo.email
    name                                     → fallback label
    …/auth.chatgpt_plan_type                 → AccountInfo.plan
    …/auth.organizations[0].title            → AccountInfo.organization
```

The `id_token` payload is base64url-decoded and `JSON.parse`d. **No signature
verification and no network call** — this is display metadata, not an
authorization decision, and ccmon never presents it to a server. An expired
token still yields identity; `hasCredentials` reports presence, not validity,
exactly as the Claude side does.

`AccountInfo` gains:

```ts
  /** which CLI this account belongs to */
  tool: 'claude' | 'codex';
  /** codex only: how the CLI authenticates */
  authMode: 'chatgpt' | 'apikey' | null;
```

and `cleanupPeriodDays` becomes `number | null` (Codex has no retention
setting). `OverviewView.tsx:68` maps over it and needs the null filter.

`tier` stays `string | null` and is always `null` for Codex.

**Advisor guard.** `AdvisorView.tsx:120` filters on `accounts[d]?.hasCredentials`
to choose which login to spend an advisor request on. A Codex account has
credentials but they are an OpenAI token — offering it would send an Anthropic
Messages API request with a token that cannot work. The filter must add
`tool === 'claude'`. This is the one place where getting the union wrong
produces a real failed network call rather than a cosmetic bug.

## 6. Wrapper generation

### 6.1 Separate managed file per tool

`~/.config/ccmon/codex-accounts.sh` (`.ps1` on Windows) holds Codex wrappers.
`claude-accounts.sh` is untouched — an existing user's file must not churn on an
unrelated apply.

`SetupPlan` changes:

```ts
-  managedPath: string;
-  managedScript: string;
+  managed: Array<{ tool: 'claude' | 'codex'; path: string; script: string }>;
```

A tool with no accounts contributes no entry, and its file is removed on apply
if it exists (so deleting your last Codex account cleans up after itself).

### 6.2 The rc block gains a second source line

```sh
# >>> ccmon managed >>>
# Claude Code / Codex account wrappers, managed by ccmon. Remove this block
# (and the files it sources) to uninstall.
[ -f "$HOME/.config/ccmon/claude-accounts.sh" ] && . "$HOME/.config/ccmon/claude-accounts.sh"
[ -f "$HOME/.config/ccmon/codex-accounts.sh" ]  && . "$HOME/.config/ccmon/codex-accounts.sh"
# <<< ccmon managed <<<
```

Both lines are emitted unconditionally and each is `[ -f ]`-guarded, so the
block's content does not depend on which accounts exist — it is written once and
stays stable.

**This forces a behaviour change in `applySetup`.** Today the block is
append-only: `rcLinked()` tests for `MARK_BEGIN` and a linked rc is skipped. An
existing user is linked with the *old* one-line block and would never receive
the second line. `applySetup` must **replace the marker-delimited block in place
when its content differs**, using the existing `managedBlockRange()` to find it.
This is idempotent, strictly better than append-only, and the only migration
step in this design.

### 6.3 Emitted wrappers

POSIX:

```sh
codex-personal() { ( export CODEX_HOME="$HOME/.codex";      codex "$@" ); }
codex-work()     { ( export CODEX_HOME="$HOME/.codex-work"; codex "$@" ); }
```

PowerShell reuses `psScopedBody` unchanged — the save/restore in `finally` is
what keeps `$env:CODEX_HOME` from leaking into the session, exactly as it does
for `CLAUDE_CONFIG_DIR`.

`RESERVED_ENV` gains `CODEX_HOME`: the wrapper owns that variable, so a user
setting it in the extra-env box must be rejected the same way `CLAUDE_CONFIG_DIR`
is.

**Provider presets stay Claude-only.** `PROVIDER_PRESETS` is a set of
`ANTHROPIC_*` variables for pointing Claude Code at another endpoint; it is
meaningless for Codex. The wizard hides the preset row on Codex rows. The free-form env editor
stays available on both.

### 6.4 Cross-resume pairs partition by tool

`crossPairs()` groups accounts by `tool` and pairs only within a group. A
`claude-work-from-codex-personal` wrapper would copy a Claude transcript into a
Codex home, which is nonsense. Two Claude accounts and two Codex accounts yield
2 + 2 pairs, not 12.

`managedNames()` returns the union across tools, so rc scanning and the tidy
pass keep working unchanged.

## 7. `codex-cross-resume`

A bash + PowerShell twin of `claude-cross-resume`, embedded in
`account-setup.ts` the same way, installed to `~/.local/bin/codex-cross-resume`
and `~/.config/ccmon/codex-cross-resume.ps1`.

Same contract, same flags (`--force`, `--keep`, `--dry-run`, `--no-launch`),
same overwrite policy (a resumed session only appends, so more lines == newer;
any overwrite is backed up to a timestamped `*.bak` first).

What differs from the Claude twin, and why:

| | claude-cross-resume | codex-cross-resume |
|---|---|---|
| locate | `<src>/projects/**/<id>.jsonl` | `<src>/{sessions,archived_sessions}/**/rollout-*-<uuid>.jsonl` |
| id source | the filename | a UUID *inside* the filename |
| destination | `<dst>/projects/<same-project-dir>/` | `<dst>/sessions/<same YYYY/MM/DD>/<same basename>` |
| read `cwd` | first line carrying `cwd` | line 1, `type: "session_meta"` → `.cwd` |
| relaunch | `CLAUDE_CONFIG_DIR=<dst> claude --resume <id>` | `CODEX_HOME=<dst> codex resume <uuid>` |

The date-nested destination path is the substantive difference: the helper must
preserve the `YYYY/MM/DD/` segment relative to the `sessions/` root rather than
flattening, or `codex resume` will not find the session. A rollout found under
`archived_sessions/` is copied into the destination's `sessions/` (restoring it
as active), which matches what a resume means.

`codex resume <SESSION_ID>` accepts the UUID directly — verified against the
installed CLI (`codex 0.147.0`).

## 8. Directory create / rename

`createAccountDir(suffix, tool)` and `renameAccountDir(root, suffix, tool)` take
the tool. For Codex the new root is `~/.codex-<suffix>` and the seeded subdir is
`sessions/` (not `projects/`), so `detectRoots` picks it up immediately.

`renameAccountDir` refuses the default root per tool via
`profile.isDefaultRoot` — `~/.codex` is as load-bearing for a bare `codex` as
`~/.claude` is for a bare `claude`.

The wizard's "new account" control gains a tool selector; the IPC signatures
(`setup:createAccount`, `setup:renameAccount`) gain a tool argument.

## 9. `recentSessions`

`cross-account.ts#recentSessions` currently takes `id` from the basename and
scans the head for any line with `cwd`. For Codex both are wrong. Split into a
tool-dispatched reader:

- **claude** — unchanged.
- **codex** — walk `sessions/` and `archived_sessions/`, match
  `rollout-*.jsonl`, read the 64 KB head, parse line 1 as `session_meta`, take
  `session_id` and `cwd`. Project name derives from `cwd` as it does today.

Dedupe by session id keeping the newest mtime, as today — which also handles the
`archived_sessions` duplicate of an active session for free.

## 10. Testing

Everything below is a unit test under `electron/services/__tests__/` unless
noted. The three-OS CI matrix already exercises the PowerShell emission path on
a real Windows runner, which is the reason it exists.

| Area | Cases |
|---|---|
| `shared/tools.ts` | `toolFor` on every data dir and on an unknown dir; `rootFor` round-trips; `accountGroups` collapses two Codex dirs into one group and keeps two Claude roots apart |
| `codexIdentity` | fixture `auth.json` with a synthetic unsigned JWT → plan/email/org; `auth_mode: 'apikey'` with no `tokens` → `authMode: 'apikey'`, no email; malformed base64 → `null`, no throw; missing file → `null` |
| wrapper rendering | POSIX and PowerShell snapshots for a Codex-only, Claude-only, and mixed account set; `CODEX_HOME` rejected by `RESERVED_ENV` |
| `crossPairs` | mixed set yields within-tool pairs only; single account per tool yields none |
| rc block | old one-line block is replaced in place, not appended; replacing twice is a no-op; a hand-edited block outside the markers is untouched |
| managed files | a tool with zero accounts writes no file and removes a stale one |
| `recentSessions` | Codex fixture rollout → id from `session_meta`, not the basename; `archived_sessions` duplicate deduped to the newer mtime |
| `createAccountDir` | Codex root seeds `sessions/`; `renameAccountDir` refuses `~/.codex` |
| discovery | per-adapter extras — a `claudeDirs` entry is not probed as a Codex home; `CODEX_HOME` comma list |

Plus: `npm run parity` must stay at 0.000%. Nothing here touches the parser or
the watcher, so a red parity run means something went wrong in discovery — most
likely per-adapter extras admitting or dropping a root.

## 11. Documentation

- `CLAUDE.md` — the Map entry for `electron/services/` gains the tools registry;
  the account gotchas gain the Codex identity rule and the rc-block replacement.
- `docs/v2-spec.md` — `AccountInfo` union, `SetupPlan.managed[]`, the tool
  registry contract.
- `docs/architecture.md` — the two registries and how they join.
- `docs/analytics-roadmap.md` — record that Codex limits remain unavailable and
  why (no published endpoint), so it is not re-proposed.

## 12. Risks

1. **rc-block replacement touches a user's shell startup file.** It is
   marker-delimited and already written by ccmon, and `writeAtomic` is used
   throughout — but this is the one irreversible-ish edit in the design. The
   preview (`planSetup`) must show the replacement as a diff, not just as
   "already linked".
2. **`AccountInfo` becoming a union ripples into four views.** The compiler
   catches the field accesses; the one it cannot catch is the *semantic* error
   in `AdvisorView` (§5), which is a filter, not a type error. Test it.
3. **The two registries can drift.** A new adapter without a profile leaves an
   account with no label or wrapper. Mitigation: a unit test asserting every
   `ADAPTERS` id has a `TOOLS` entry.
