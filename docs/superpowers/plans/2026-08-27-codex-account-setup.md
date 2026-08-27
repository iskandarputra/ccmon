# Codex Account Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Codex CLI installs full parity with Claude Code in ccmon's account layer — discovery config, account identity, setup-wizard wrappers, and cross-account resume.

**Architecture:** A `ToolProfile` registry parallel to the existing `ADAPTERS` registry, split by capability: `shared/tools.ts` holds the pure half (naming, root derivation, grouping) importable by renderer, main and CLI; `electron/services/tools/identity.ts` holds the filesystem half (reading credential stores). `account-setup.ts` and `accounts.ts` iterate profiles instead of hardcoding `claude`. The two registries join on `adapter.id === profile.id`.

**Tech Stack:** TypeScript (strict), Node (no Electron in `electron/services/`), React 19 + zustand renderer, vitest, esbuild + Vite, eslint + prettier.

**Spec:** `docs/superpowers/specs/2026-08-27-codex-account-setup-design.md`

## Global Constraints

- **Never import Electron under `electron/services/`.** Type-only imports erase and are fine. A service needing an Electron API takes it injected.
- **Every new source file starts with** `@file` / `@brief` / `@author Iskandar Putra <www.iskandarputra.com>`.
- **`npm run parity` must stay at 0.000%** (exact integer match on all four token fields). Nothing here touches the parser or watcher; a red parity run means discovery broke.
- **Before every commit:** `npm run lint && npm run typecheck && npm test`.
- **Renderer colors:** theme tokens only, `var(--token)`, alpha via `color-mix()`. No hex outside `src/theme/themes.ts`.
- **Renderer typography:** data surfaces (labels, tables) use `--mono`; display numerals `--sans` with `tnum`.
- **Privacy mode masks money at format time only** — nothing in this plan renders money, so no new masking is needed.
- **The `id_token` payload is decoded for display only** — no signature verification, no network call, never logged.
- **ccmon never deletes an account root.** Nothing in this plan may add a delete path.
- **Wrapper files are written 0600**; the POSIX cross-resume helper is 0755.
- **Test style:** vitest, real temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-<area>-'))` in `beforeEach`, `fs.rmSync(..., {recursive: true, force: true})` in `afterEach`. Follow `electron/services/__tests__/account-setup.test.ts`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `shared/tools.ts` | Pure tool registry: `ToolProfile`, `TOOLS`, `toolFor`, `accountGroups`. No `fs`. |
| `electron/services/tools/identity.ts` | Reads credential stores → `AccountInfo`. `fs` only, no Electron. |
| `electron/services/tools/codex-resume.ts` | The embedded `codex-cross-resume` bash + PowerShell scripts, as string constants. |
| `electron/services/__tests__/tools.test.ts` | Registry + grouping tests. |
| `electron/services/__tests__/identity.test.ts` | Identity-reader tests. |

**Modified:**

| File | Change |
|---|---|
| `shared/types.ts` | `AccountInfo` gains `tool`/`authMode`, `cleanupPeriodDays` nullable; `AccountSpec` gains `tool`; `SetupPlan.managed[]`; `UserConfig.codexDirs`. |
| `shared/ipc.ts` | `createAccount`/`renameAccount` take a tool. |
| `electron/services/adapters/index.ts` | `detectSourceRoots` takes per-adapter extras. |
| `electron/services/adapters/codex.ts` | Comma-split `CODEX_HOME`. |
| `electron/services/config.ts` | Document `codexDirs`. |
| `electron/services/accounts.ts` | Delegate identity to the registry; tool-aware `accountLabel`. |
| `electron/services/account-setup.ts` | Per-tool managed files, wrapper rendering, `crossPairs` partitioning, rc-block replacement, dir create/rename. |
| `electron/services/cross-account.ts` | Tool-dispatched `recentSessions`. |
| `electron/main.ts` | Pass per-adapter extras; thread tool through setup IPC. |
| `src/lib/crossAccount.ts` | Delegate naming/root derivation to `shared/tools.ts`. |
| `src/views/AccountsView.tsx` | Render `accountGroups()`; tool badge. |
| `src/views/AdvisorView.tsx` | Filter to `tool === 'claude'`. |
| `src/views/OverviewView.tsx` | Handle nullable `cleanupPeriodDays`. |
| `src/views/SettingsView.tsx` | Group the source list by account. |
| `src/components/accounts/SetupWizard.tsx` | Tool selector, hide presets on Codex rows. |

---

## Task 1: The pure tool registry

**Files:**
- Create: `shared/tools.ts`
- Test: `electron/services/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ToolId = 'claude' | 'codex'`; `ToolProfile`; `TOOLS: ToolProfile[]`; `toolById(id: ToolId): ToolProfile`; `toolFor(sourceDir: string): ToolProfile`; `accountRootFor(sourceDir: string): string`; `AccountGroup { root: string; tool: ToolProfile; dirs: string[] }`; `accountGroups(sourceDirs: string[]): AccountGroup[]`.

- [ ] **Step 1: Write the failing test**

Create `electron/services/__tests__/tools.test.ts`:

```ts
/**
 * @file tools.test.ts
 * @brief Unit tests for the pure tool registry — root derivation, naming, grouping.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  accountGroups,
  accountRootFor,
  toolById,
  toolFor,
} from '../../../shared/tools';
import { ADAPTERS } from '../adapters';

describe('toolFor — source dir → profile', () => {
  it('maps a Claude projects dir to the claude profile', () => {
    expect(toolFor('/home/u/.claude/projects').id).toBe('claude');
    expect(toolFor('/home/u/.claude-work/projects').id).toBe('claude');
  });

  it('maps both Codex data dirs to the codex profile', () => {
    expect(toolFor('/home/u/.codex/sessions').id).toBe('codex');
    expect(toolFor('/home/u/.codex/archived_sessions').id).toBe('codex');
  });

  it('falls back to claude for an unrecognised dir rather than throwing', () => {
    // detectSourceRoots can only produce known data dirs, but a hand-edited
    // settings.json can carry a stale path — a crash there would take the
    // whole accounts view down.
    expect(toolFor('/home/u/somewhere/else').id).toBe('claude');
  });

  it('uses Windows separators too', () => {
    expect(toolFor('C:\\Users\\u\\.codex\\sessions').id).toBe('codex');
  });
});

describe('accountRootFor — source dir → account root', () => {
  it('strips the Claude projects segment', () => {
    expect(accountRootFor('/home/u/.claude/projects')).toBe('/home/u/.claude');
  });

  it('collapses both Codex data dirs onto one home', () => {
    expect(accountRootFor('/home/u/.codex/sessions')).toBe('/home/u/.codex');
    expect(accountRootFor('/home/u/.codex/archived_sessions')).toBe('/home/u/.codex');
  });

  it('matches path.dirname for Codex, which is what the hide-prefs key on', () => {
    // visibleAccountDirs() keys prefs on path.dirname(dir); if this ever
    // disagreed, hiding an account and the wizard would target different roots.
    expect(accountRootFor('/home/u/.codex/sessions')).toBe('/home/u/.codex');
  });
});

describe('suggestWrapperName', () => {
  it('names the default roots "-personal"', () => {
    expect(toolById('claude').suggestWrapperName('/home/u/.claude')).toBe('claude-personal');
    expect(toolById('codex').suggestWrapperName('/home/u/.codex')).toBe('codex-personal');
  });

  it('carries a sibling suffix through', () => {
    expect(toolById('claude').suggestWrapperName('/home/u/.claude-work')).toBe('claude-work');
    expect(toolById('codex').suggestWrapperName('/home/u/.codex-work')).toBe('codex-work');
  });

  it('falls back to "-account" when the suffix strips to nothing', () => {
    expect(toolById('codex').suggestWrapperName('/home/u/.codex-')).toBe('codex-account');
  });
});

describe('isDefaultRoot', () => {
  it('is true only for the bare home each CLI falls back to', () => {
    expect(toolById('claude').isDefaultRoot('/home/u/.claude')).toBe(true);
    expect(toolById('claude').isDefaultRoot('/home/u/.claude-work')).toBe(false);
    expect(toolById('codex').isDefaultRoot('/home/u/.codex')).toBe(true);
    expect(toolById('codex').isDefaultRoot('/home/u/.codex-work')).toBe(false);
  });
});

describe('accountGroups', () => {
  it('collapses a Codex home\'s two dirs into one group, ordered as given', () => {
    const groups = accountGroups([
      '/home/u/.claude/projects',
      '/home/u/.codex/sessions',
      '/home/u/.codex/archived_sessions',
      '/home/u/.claude-work/projects',
    ]);
    expect(groups.map((g) => g.root)).toEqual([
      '/home/u/.claude',
      '/home/u/.codex',
      '/home/u/.claude-work',
    ]);
    expect(groups[1].dirs).toEqual([
      '/home/u/.codex/sessions',
      '/home/u/.codex/archived_sessions',
    ]);
    expect(groups[1].tool.id).toBe('codex');
  });

  it('keeps two Claude roots apart', () => {
    const groups = accountGroups(['/home/u/.claude/projects', '/home/u/.claude-work/projects']);
    expect(groups).toHaveLength(2);
  });

  it('returns nothing for no dirs', () => {
    expect(accountGroups([])).toEqual([]);
  });
});

describe('registry drift', () => {
  it('every source adapter has a matching tool profile', () => {
    // A new adapter without a profile leaves its accounts with no label and
    // no wrapper — silently. This is the guard against that.
    for (const adapter of ADAPTERS) {
      expect(TOOLS.map((t) => t.id)).toContain(adapter.id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/tools.test.ts`
Expected: FAIL — `Failed to resolve import "../../../shared/tools"`.

- [ ] **Step 3: Write the registry**

Create `shared/tools.ts`:

```ts
/**
 * @file tools.ts
 * @brief Coding-CLI tool registry — what an "account" means per tool, pure half.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * The tool registry is the account-layer twin of `ADAPTERS`
 * (`electron/services/adapters/index.ts`). They join on id: an adapter owns
 * what is FORMAT-specific (discovery, parsing, pricing inputs), a profile owns
 * what is INSTALL-specific (where the home is, what env var selects it, what a
 * wrapper is called, where the credentials live).
 *
 * They are deliberately separate interfaces. Adapters are stateless singletons
 * shared by the app watcher AND the CLI watcher, and the CLI must be able to
 * import them under plain node; account setup writes shell rc files and reads
 * credential stores, which the CLI never does. Folding one into the other
 * would make every CLI invocation import code it can never call.
 *
 * This file is the PURE half — no `fs`, no `os` — so the renderer, main and
 * the CLI can all import it. The filesystem half is
 * `electron/services/tools/identity.ts`.
 */

export type ToolId = 'claude' | 'codex';

export interface ToolProfile {
  /** joins to `SourceAdapter.id` */
  id: ToolId;
  /** human label for the UI */
  label: string;
  /** the executable a generated wrapper invokes */
  bin: string;
  /** the env var a wrapper exports to select this home */
  homeEnvVar: string;
  /**
   * Subdirectories of a home that carry usage. A tool may have more than one
   * (Codex keeps `archived_sessions` beside `sessions`), which is exactly why
   * an account is a HOME and not a source dir.
   */
  dataDirs: string[];
  /** the subdir seeded when ccmon creates a new home for this tool */
  seedDir: string;
  /** basename of the managed wrapper file, per shell family */
  managedFile: Record<'posix' | 'powershell', string>;
  /** basename of the cross-resume helper this tool installs */
  helperName: string;
  /** root → the default wrapper command name */
  suggestWrapperName(root: string): string;
  /**
   * True for the one root the bare CLI falls back to when `homeEnvVar` is
   * unset. That root must never be renamed or moved: anything not going
   * through a ccmon wrapper still expects to find it there.
   */
  isDefaultRoot(root: string): boolean;
}

/** Last path segment, tolerant of either separator (Windows paths reach here). */
const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Drop everything from the last separator on, keeping the rest verbatim. */
const dirname = (p: string): string => {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut > 0 ? p.slice(0, cut) : p;
};

/** Shared naming rule: `.<tool>` → `<tool>-personal`, `.<tool>-x` → `<tool>-x`. */
function nameFor(id: ToolId, root: string): string {
  const base = basename(root);
  if (base === `.${id}`) return `${id}-personal`;
  const suffix = base.replace(/^\.+/, '').replace(new RegExp(`^${id}[-_]?`), '');
  return suffix ? `${id}-${suffix}` : `${id}-account`;
}

export const claudeTool: ToolProfile = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  homeEnvVar: 'CLAUDE_CONFIG_DIR',
  dataDirs: ['projects'],
  seedDir: 'projects',
  managedFile: { posix: 'claude-accounts.sh', powershell: 'claude-accounts.ps1' },
  helperName: 'claude-cross-resume',
  suggestWrapperName: (root) => nameFor('claude', root),
  isDefaultRoot: (root) => basename(root) === '.claude',
};

export const codexTool: ToolProfile = {
  id: 'codex',
  label: 'Codex CLI',
  bin: 'codex',
  homeEnvVar: 'CODEX_HOME',
  dataDirs: ['sessions', 'archived_sessions'],
  seedDir: 'sessions',
  managedFile: { posix: 'codex-accounts.sh', powershell: 'codex-accounts.ps1' },
  helperName: 'codex-cross-resume',
  suggestWrapperName: (root) => nameFor('codex', root),
  isDefaultRoot: (root) => basename(root) === '.codex',
};

/** Every tool ccmon knows, in the same precedence order as `ADAPTERS`. */
export const TOOLS: ToolProfile[] = [claudeTool, codexTool];

/** Look up a profile by its stable id. Claude is the fallback. */
export const toolById = (id: string): ToolProfile =>
  TOOLS.find((t) => t.id === id) ?? claudeTool;

/**
 * The profile owning a source dir, matched on the dir's own basename.
 *
 * Falls back to `claude` rather than throwing: a stale path in a hand-edited
 * `settings.json` should degrade to a plain-looking account row, not take the
 * whole accounts view down.
 */
export const toolFor = (sourceDir: string): ToolProfile =>
  TOOLS.find((t) => t.dataDirs.includes(basename(sourceDir))) ?? claudeTool;

/**
 * A source dir's account root (the tool's home).
 *
 * This is the ONE definition. `visibleAccountDirs` keys hide-prefs on the same
 * value, and the two used to disagree for Codex — the renderer stripped a
 * trailing `/projects` (a no-op on `~/.codex/sessions`) while the service used
 * `path.dirname`. Route everything through here.
 */
export const accountRootFor = (sourceDir: string): string =>
  TOOLS.some((t) => t.dataDirs.includes(basename(sourceDir))) ? dirname(sourceDir) : sourceDir;

/** One account: its home, its tool, and every source dir that feeds it. */
export interface AccountGroup {
  root: string;
  tool: ToolProfile;
  dirs: string[];
}

/**
 * Group source dirs into accounts, first-seen order preserved.
 *
 * A Codex home contributes two source dirs but is one account, so anything
 * rendering one row per account must iterate this rather than `sourceDirs`.
 */
export function accountGroups(sourceDirs: string[]): AccountGroup[] {
  const byRoot = new Map<string, AccountGroup>();
  for (const dir of sourceDirs) {
    const root = accountRootFor(dir);
    const found = byRoot.get(root);
    if (found) found.dirs.push(dir);
    else byRoot.set(root, { root, tool: toolFor(dir), dirs: [dir] });
  }
  return [...byRoot.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/services/__tests__/tools.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/tools.ts electron/services/__tests__/tools.test.ts
git commit -m "feat: add the pure tool-profile registry beside the adapter registry"
```

---

## Task 2: Retire the duplicated naming in the renderer

**Files:**
- Modify: `src/lib/crossAccount.ts:145-195`
- Test: `src/lib/__tests__/crossAccount.test.ts`

**Interfaces:**
- Consumes: `accountRootFor`, `toolFor`, `toolById` from Task 1.
- Produces: `accountRoot`, `suggestWrapperName`, `isDefaultAccountRoot` keep their existing signatures and call sites; they become thin delegates.

`crossAccount.ts:174` carries a hand-maintained copy of `account-setup.ts#suggestLabel` with the comment "mirrors electron/services/account-setup.ts, which can't import from src/". `shared/` is importable by both, so the copy goes away instead of doubling.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/crossAccount.test.ts`:

```ts
describe('account root derivation is tool-aware', () => {
  it('resolves a Codex source dir to its home, not to itself', () => {
    // The old regex stripped a trailing `/projects`, which is a no-op here —
    // it returned `~/.codex/sessions` and disagreed with visibleAccountDirs.
    expect(accountRoot('/home/u/.codex/sessions')).toBe('/home/u/.codex');
    expect(accountRoot('/home/u/.codex/archived_sessions')).toBe('/home/u/.codex');
  });

  it('still resolves a Claude source dir', () => {
    expect(accountRoot('/home/u/.claude-work/projects')).toBe('/home/u/.claude-work');
  });

  it('suggests a codex-* wrapper name for a Codex home', () => {
    expect(suggestWrapperName('/home/u/.codex')).toBe('codex-personal');
    expect(suggestWrapperName('/home/u/.codex-work')).toBe('codex-work');
  });

  it('protects both default roots from rename', () => {
    expect(isDefaultAccountRoot('/home/u/.claude')).toBe(true);
    expect(isDefaultAccountRoot('/home/u/.codex')).toBe(true);
    expect(isDefaultAccountRoot('/home/u/.codex-work')).toBe(false);
  });
});
```

Add `isDefaultAccountRoot` to the file's existing import from `../crossAccount` if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/crossAccount.test.ts`
Expected: FAIL — `expected '/home/u/.codex/sessions' to be '/home/u/.codex'`.

- [ ] **Step 3: Delegate to the registry**

`suggestWrapperName` and `isDefaultAccountRoot` take an account ROOT, not a
source dir, so they need a root→profile lookup. Add it to `shared/tools.ts`
directly below `toolFor`:

```ts
/**
 * The profile owning an account ROOT (as opposed to a source dir), matched on
 * the home's own basename: `~/.codex-work` → codex. Claude is the fallback,
 * which is also correct for a custom root configured via `claudeDirs`.
 */
export const toolForRoot = (root: string): ToolProfile => {
  const base = basename(root);
  return TOOLS.find((t) => base === `.${t.id}` || base.startsWith(`.${t.id}-`)) ?? claudeTool;
};
```

Then in `src/lib/crossAccount.ts`, add the import:

```ts
import { accountRootFor, toolForRoot } from '../../shared/tools';
```

Replace the `accountRoot` definition (currently lines 145-147):

```ts
/**
 * A source dir → the account root (home) the tool reads. Tool-aware: a Claude
 * source dir is `<root>/projects`, a Codex one is `<home>/sessions` or
 * `<home>/archived_sessions`. See `shared/tools.ts#accountRootFor`.
 */
export const accountRoot = accountRootFor;
```

Replace `suggestWrapperName` (lines 177-182), `isDefaultAccountRoot` (lines
184-191), and the section comment above them with:

```ts
// ---- shell-wrapper naming ---------------------------------------------------
// Both of these used to be hand-copied from account-setup.ts because a service
// cannot import from `src/`. They now come from `shared/tools.ts`, which both
// sides can import — one definition, no drift.

/** A nice default wrapper name for a home (~/.claude → claude-personal). */
export const suggestWrapperName = (root: string): string =>
  toolForRoot(root).suggestWrapperName(root);

/**
 * True for a tool's default home — the path its bare CLI falls back to when
 * the home env var is unset, so the one root that must never be moved.
 */
export const isDefaultAccountRoot = (root: string): boolean =>
  toolForRoot(root).isDefaultRoot(root);
```

- [ ] **Step 4: Add the `toolForRoot` test**

Append to `electron/services/__tests__/tools.test.ts`:

```ts
describe('toolForRoot — account root → profile', () => {
  it('matches a bare home and a suffixed sibling', () => {
    expect(toolForRoot('/home/u/.codex').id).toBe('codex');
    expect(toolForRoot('/home/u/.codex-work').id).toBe('codex');
    expect(toolForRoot('/home/u/.claude-work').id).toBe('claude');
  });

  it('falls back to claude for a custom root from claudeDirs', () => {
    expect(toolForRoot('/mnt/archive/old-transcripts').id).toBe('claude');
  });
});
```

Add `toolForRoot` to that file's import list.

- [ ] **Step 5: Run both test files**

Run: `npx vitest run electron/services/__tests__/tools.test.ts src/lib/__tests__/crossAccount.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (this change touches a shared contract)**

Run: `npm run typecheck`
Expected: clean. If `CROSS_RESUME_BIN` or `crossResumeCommand` now report unused imports, remove them.

- [ ] **Step 7: Commit**

```bash
git add shared/tools.ts src/lib/crossAccount.ts src/lib/__tests__/crossAccount.test.ts electron/services/__tests__/tools.test.ts
git commit -m "fix: derive the account root from the tool registry, not a /projects regex"
```

---

## Task 3: Per-adapter discovery extras and multi-home CODEX_HOME

**Files:**
- Modify: `electron/services/adapters/index.ts:38-48`
- Modify: `electron/services/adapters/codex.ts:120-138`
- Modify: `electron/services/config.ts:14-45`
- Modify: `shared/types.ts:303-310`
- Modify: `electron/main.ts:243`, `cli/index.ts:87`, `scripts/smoke.ts:32`
- Test: `electron/services/__tests__/adapters.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `detectSourceRoots(extra?: Partial<Record<ToolId, string[]>>): SourceRoot[]` — the parameter changes from `string[]` to a per-adapter map. `UserConfig.codexDirs?: string[]`.

Today `detectSourceRoots(cfg.claudeDirs)` hands the same list to *every* adapter, so a user's Claude root is probed as a Codex home (`<entry>/sessions`). Harmless so far only because that path does not exist.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/adapters.test.ts`:

```ts
describe('detectSourceRoots — per-adapter extras', () => {
  it('does not probe a claudeDirs entry as a Codex home', () => {
    // A Claude root that happens to contain a `sessions/` dir must not be
    // claimed by the codex adapter: it would be parsed with the wrong format.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-adapters-'));
    fs.mkdirSync(path.join(home, 'root', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(home, 'root', 'sessions'), { recursive: true });

    const roots = detectSourceRoots({ claude: [path.join(home, 'root')] });
    expect(roots.map((r) => r.adapter.id)).toEqual(['claude']);
    expect(roots[0].dir).toBe(path.join(home, 'root', 'projects'));

    fs.rmSync(home, { recursive: true, force: true });
  });

  it('routes codexDirs to the codex adapter only', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-adapters-'));
    fs.mkdirSync(path.join(home, 'cx', 'sessions'), { recursive: true });

    const roots = detectSourceRoots({ codex: [path.join(home, 'cx')] });
    expect(roots.map((r) => r.adapter.id)).toEqual(['codex']);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it('accepts no extras at all', () => {
    expect(() => detectSourceRoots()).not.toThrow();
  });
});

describe('codex detectRoots — CODEX_HOME is a list', () => {
  it('splits a comma-separated CODEX_HOME', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-codexhome-'));
    const a = path.join(home, 'a');
    const b = path.join(home, 'b');
    fs.mkdirSync(path.join(a, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(b, 'sessions'), { recursive: true });

    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = `${a},${b}`;
    try {
      const dirs = codexAdapter.detectRoots();
      expect(dirs).toContain(path.join(a, 'sessions'));
      expect(dirs).toContain(path.join(b, 'sessions'));
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

Ensure the file imports `fs`, `os`, `path`, `detectSourceRoots` and `codexAdapter`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/adapters.test.ts`
Expected: FAIL — the first case returns a `codex` root too; the CODEX_HOME case finds neither dir (the literal `a,b` path does not exist).

- [ ] **Step 3: Change the discovery signature**

In `electron/services/adapters/index.ts`, replace `detectSourceRoots`:

```ts
/**
 * Every data root present on this machine, each tagged with its adapter.
 *
 * `extra` is keyed BY ADAPTER: a user's `claudeDirs` must not be probed as a
 * Codex home, or a Claude root that happens to hold a `sessions/` dir gets
 * claimed by the wrong parser. Adapters that find nothing contribute nothing —
 * a tool that isn't installed is the normal case, not a failure.
 */
export function detectSourceRoots(
  extra: Partial<Record<string, string[]>> = {},
): SourceRoot[] {
  const roots: SourceRoot[] = [];
  const seen = new Set<string>();
  for (const adapter of ADAPTERS) {
    for (const dir of adapter.detectRoots(extra[adapter.id] ?? [])) {
      if (seen.has(dir)) continue; // first adapter to claim a dir owns it
      seen.add(dir);
      roots.push({ dir, adapter });
    }
  }
  return roots;
}
```

- [ ] **Step 4: Split CODEX_HOME**

In `electron/services/adapters/codex.ts`, add to the imports:

```ts
import { splitPathList } from '../paths';
```

and replace the first line of `detectRoots`:

```ts
    // CODEX_HOME holds one path for Codex itself, but ccmon MONITORS rather
    // than launches — accepting a comma list costs nothing and matches how
    // CLAUDE_CONFIG_DIR is read (`paths.ts#splitPathList`, which also expands
    // a leading `~` that a quoted shell value would leave literal).
    const env = splitPathList(process.env.CODEX_HOME);
    const homes = [...(env.length ? env : [path.join(os.homedir(), '.codex')]), ...extra];
```

- [ ] **Step 5: Add `codexDirs` to the config contract**

In `shared/types.ts`, in `UserConfig`:

```ts
export interface UserConfig {
  claudeDirs?: string[];
  /** extra Codex homes (the dir holding `sessions/`), beyond `CODEX_HOME` */
  codexDirs?: string[];
  pricing?: Record<string, PricingOverride>;
```

In `electron/services/config.ts`, extend the shape comment in the header block:

```
 *   "claudeDirs": ["/extra/claude/root", "~/archive/claude"],
 *   "codexDirs":  ["~/.codex-work"],
```

and the prose below it:

```
 * `claudeDirs` and `codexDirs` entries may use a leading `~`. They are routed
 * to their own adapter only — a Claude root is never probed as a Codex home.
```

- [ ] **Step 6: Update the three callers**

`electron/main.ts:243`:

```ts
  state.allSourceDirs = detectSourceRoots({
    claude: cfg.claudeDirs ?? [],
    codex: cfg.codexDirs ?? [],
  }).map((r) => r.dir);
```

`cli/index.ts:87` — `args.sources` is a user-supplied `--source` flag with no
tool attached, so it goes to both:

```ts
  const roots = detectSourceRoots({
    claude: [...args.sources, ...(cfg.claudeDirs ?? [])],
    codex: [...args.sources, ...(cfg.codexDirs ?? [])],
  });
```

`scripts/smoke.ts:32`:

```ts
  const roots = detectSourceRoots({
    claude: cfg.claudeDirs ?? [],
    codex: cfg.codexDirs ?? [],
  });
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run electron/services/__tests__/adapters.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck.

- [ ] **Step 8: Verify discovery against the real corpus**

Run: `npm run smoke`
Expected: the same root list as before the change, plus `~/.codex/sessions` and
`~/.codex/archived_sessions` if Codex is installed. Entry counts unchanged.

- [ ] **Step 9: Commit**

```bash
git add electron/services/adapters/index.ts electron/services/adapters/codex.ts electron/services/config.ts shared/types.ts electron/main.ts cli/index.ts scripts/smoke.ts electron/services/__tests__/adapters.test.ts
git commit -m "fix: route discovery extras per adapter and accept a CODEX_HOME list"
```

---

## Task 4: Codex account identity

**Files:**
- Create: `electron/services/tools/identity.ts`
- Modify: `shared/types.ts` (`AccountInfo`)
- Modify: `electron/services/accounts.ts:89-183, 230-238`
- Test: `electron/services/__tests__/identity.test.ts`

**Interfaces:**
- Consumes: `ToolId`, `toolForRoot` from Task 1.
- Produces: `claudeIdentity(root: string): AccountInfo | null`; `codexIdentity(root: string): AccountInfo | null`; `identityFor(root: string): AccountInfo | null`. `AccountInfo` gains `tool: ToolId` and `authMode: 'chatgpt' | 'apikey' | null`; `cleanupPeriodDays` becomes `number | null`.

- [ ] **Step 1: Write the failing test**

Create `electron/services/__tests__/identity.test.ts`:

```ts
/**
 * @file identity.test.ts
 * @brief Unit tests for per-tool account identity readers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { codexIdentity, identityFor } from '../tools/identity';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-identity-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/** An unsigned JWT with `payload` as its claim set — shape only, never verified. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.signature-not-checked`;
}

function writeAuth(root: string, auth: Record<string, unknown>): string {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
  return root;
}

describe('codexIdentity — ChatGPT login', () => {
  it('reads plan, email and organization out of the id_token', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: {
        id_token: jwt({
          email: 'dev@example.com',
          name: 'A Dev',
          'https://api.openai.com/auth': {
            chatgpt_plan_type: 'pro',
            organizations: [{ id: 'org-1', title: 'Acme Inc', is_default: true, role: 'owner' }],
          },
        }),
        access_token: 'at',
        refresh_token: 'rt',
        account_id: 'acct',
      },
    });

    const info = codexIdentity(root);
    expect(info).toEqual({
      tool: 'codex',
      plan: 'pro',
      tier: null,
      email: 'dev@example.com',
      organization: 'Acme Inc',
      hasCredentials: true,
      authMode: 'chatgpt',
      cleanupPeriodDays: null,
    });
  });

  it('leaves organization null when the claim carries none', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: {
        id_token: jwt({
          email: 'solo@example.com',
          'https://api.openai.com/auth': { chatgpt_plan_type: 'free' },
        }),
        access_token: 'at',
      },
    });
    expect(codexIdentity(root)?.organization).toBeNull();
    expect(codexIdentity(root)?.plan).toBe('free');
  });
});

describe('codexIdentity — API key login', () => {
  it('reports the mode without inventing an identity', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-not-a-real-key',
    });
    const info = codexIdentity(root);
    expect(info?.authMode).toBe('apikey');
    expect(info?.hasCredentials).toBe(true);
    expect(info?.email).toBeNull();
    expect(info?.plan).toBeNull();
  });
});

describe('codexIdentity — degrades quietly', () => {
  it('returns null when there is no auth.json at all', () => {
    fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
    expect(codexIdentity(path.join(home, '.codex'))).toBeNull();
  });

  it('survives a malformed id_token rather than throwing', () => {
    const root = writeAuth(path.join(home, '.codex'), {
      auth_mode: 'chatgpt',
      tokens: { id_token: 'not.a.jwt', access_token: 'at' },
    });
    const info = codexIdentity(root);
    expect(info?.hasCredentials).toBe(true);
    expect(info?.email).toBeNull();
  });

  it('survives a truncated auth.json', () => {
    const root = path.join(home, '.codex');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'auth.json'), '{"auth_mode":');
    expect(codexIdentity(root)).toBeNull();
  });
});

describe('identityFor — dispatch by root', () => {
  it('sends a Codex home to the Codex reader', () => {
    const root = writeAuth(path.join(home, '.codex-work'), {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-x',
    });
    expect(identityFor(root)?.tool).toBe('codex');
  });

  it('returns null for a Claude root with no config or credentials', () => {
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    expect(identityFor(path.join(home, '.claude'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/identity.test.ts`
Expected: FAIL — `Failed to resolve import "../tools/identity"`.

- [ ] **Step 3: Widen `AccountInfo`**

In `shared/types.ts`, replace the interface:

```ts
export interface AccountInfo {
  /** which CLI this account belongs to — see `shared/tools.ts` */
  tool: ToolId;
  plan: string | null;
  /** plan multiplier parsed from rateLimitTier, e.g. '5x' | '20x'; Claude only */
  tier: string | null;
  email: string | null;
  organization: string | null;
  hasCredentials: boolean;
  /**
   * Codex only: whether the CLI authenticates with a ChatGPT login or a bare
   * API key. Null for Claude, which has exactly one mode.
   */
  authMode: 'chatgpt' | 'apikey' | null;
  /**
   * Claude Code's transcript-retention window (`cleanupPeriodDays` in
   * `<root>/settings.json`, default 30). Null for Codex, which has no
   * retention setting — a consumer must not read that null as "0 days".
   */
  cleanupPeriodDays: number | null;
}
```

Add `import type { ToolId } from './tools';` at the top of `shared/types.ts` if
it is not already importing from there.

- [ ] **Step 4: Write the identity module**

Create `electron/services/tools/identity.ts`:

```ts
/**
 * @file identity.ts
 * @brief Per-tool account identity — the filesystem half of the tool registry.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { toolForRoot } from '../../../shared/tools';
import type { AccountInfo } from '../../../shared/types';

/**
 * Reading an account's identity is per-tool because the credential stores are
 * unrelated: Claude Code keeps `<root>/.claude.json` plus
 * `<root>/.credentials.json` (or the macOS Keychain), Codex keeps a single
 * `<root>/auth.json` holding an OAuth token set or a bare API key.
 *
 * Everything here is READ-ONLY and OFFLINE. No token is refreshed, no request
 * is made, and no secret is returned to the caller — only the non-secret
 * metadata a row needs to identify itself.
 */

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null; // absent, unreadable, or truncated mid-write
  }
}

// ---- codex ------------------------------------------------------------------

/** The OpenAI-namespaced claim block inside a Codex `id_token`. */
const OAI_CLAIM = 'https://api.openai.com/auth';

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: unknown;
  tokens?: { id_token?: string; access_token?: string };
}

interface OaiClaims {
  chatgpt_plan_type?: string;
  organizations?: Array<{ title?: string; is_default?: boolean }>;
}

interface IdTokenPayload {
  email?: string;
  name?: string;
  [OAI_CLAIM]?: OaiClaims;
}

/**
 * The claim set of a JWT, or null.
 *
 * The signature is NOT verified and cannot be: ccmon has no key, makes no
 * network call, and never presents this token to anything. It is display
 * metadata for a row the user is already looking at, read from a 0600 file in
 * their own home directory — the same trust level as reading `.claude.json`.
 */
function decodeJwtPayload(token: string): IdTokenPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdTokenPayload;
  } catch {
    return null;
  }
}

/** Non-secret identity for a Codex home, or null when it holds no login. */
export function codexIdentity(root: string): AccountInfo | null {
  const auth = readJson<CodexAuthFile>(path.join(root, 'auth.json'));
  if (!auth) return null;

  const authMode =
    auth.auth_mode === 'chatgpt' || auth.auth_mode === 'apikey' ? auth.auth_mode : null;
  const hasKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
  const hasToken = typeof auth.tokens?.access_token === 'string';
  if (!authMode && !hasKey && !hasToken) return null;

  const payload = auth.tokens?.id_token ? decodeJwtPayload(auth.tokens.id_token) : null;
  const claims = payload?.[OAI_CLAIM];
  const orgs = claims?.organizations ?? [];
  const org = orgs.find((o) => o.is_default) ?? orgs[0];

  return {
    tool: 'codex',
    plan: claims?.chatgpt_plan_type ?? null,
    tier: null, // no multiplier concept
    email: payload?.email ?? null,
    organization: org?.title ?? null,
    hasCredentials: hasKey || hasToken,
    authMode,
    cleanupPeriodDays: null, // Codex has no retention setting
  };
}

// ---- dispatch ---------------------------------------------------------------

/**
 * Identity for an account root, dispatched by tool. The Claude reader stays in
 * `accounts.ts` (it also drives the limits poll and re-auth, which are
 * Claude-only); this function is injected with it to avoid a circular import.
 */
let claudeReader: ((root: string) => AccountInfo | null) | null = null;

/** Installed once at module load by `accounts.ts`. */
export function registerClaudeIdentity(fn: (root: string) => AccountInfo | null): void {
  claudeReader = fn;
}

export function identityFor(root: string): AccountInfo | null {
  if (toolForRoot(root).id === 'codex') return codexIdentity(root);
  return claudeReader ? claudeReader(root) : null;
}
```

- [ ] **Step 5: Route `accounts.ts` through it**

In `electron/services/accounts.ts`:

Add imports:

```ts
import { toolForRoot } from '../../shared/tools';
import { identityFor, registerClaudeIdentity } from './tools/identity';
```

Change `accountInfo` to take a ROOT (it currently takes a project dir and calls
`rootOf` internally) and to stamp the new fields. Keep the existing project-dir
entry point for its current callers by making it a thin wrapper:

```ts
/** Non-secret identity for a Claude account ROOT, or null when unknown. */
export function claudeIdentity(root: string): AccountInfo | null {
  const oauth = readJson<ClaudeConfig>(configPathFor(root))?.oauthAccount || null;
  const creds = credentialsForRoot(root);
  if (!oauth && !creds) return null;
  const plan =
    creds?.subscriptionType ||
    (oauth?.organizationType ? PLAN_LABELS[oauth.organizationType] : undefined) ||
    oauth?.seatTier ||
    null;
  return {
    tool: 'claude',
    plan,
    tier: tierOf(creds?.rateLimitTier),
    email: oauth?.emailAddress || null,
    organization: oauth?.organizationName || null,
    hasCredentials: !!creds?.accessToken,
    authMode: null,
    cleanupPeriodDays: cleanupPeriodDaysForRoot(root),
  };
}

registerClaudeIdentity(claudeIdentity);

/** Non-secret identity for a source dir, or null when unknown. */
export function accountInfo(projectDir: string): AccountInfo | null {
  return identityFor(rootOf(projectDir));
}
```

`accountConfig`, `credentials` and `cleanupPeriodDays` currently take a project
dir and call `rootOf` themselves. Split each into a `…ForRoot(root)` function
holding the body, with the existing name kept as a `rootOf`-applying wrapper if
any other call site still needs it. `rootOf` itself becomes:

```ts
const rootOf = (sourceDir: string) => accountRootFor(sourceDir);
```

importing `accountRootFor` from `shared/tools` — `path.dirname` is right for
both tools today, but going through the registry is what keeps it right.

Make `accountLabel` tool-aware:

```ts
/**
 * Short human name for an account, derived from its home directory:
 * `~/.claude` → "default", `~/.claude-work` → "work", `~/.codex` → "codex",
 * `~/.codex-work` → "codex:work".
 *
 * Codex keeps its tool in the label because a bare "work" appearing twice in
 * the tray — once per tool — is unreadable. Display only: two roots can decode
 * to the same label, so this is never an identity key.
 */
export function accountLabel(sourceDir: string): string {
  const root = rootOf(sourceDir);
  const tool = toolForRoot(root);
  const base = path.basename(root);
  if (tool.id === 'claude') return base === '.claude' ? 'default' : base.replace(/^\.claude-?/, '') || base;
  const suffix = base.replace(/^\.codex-?/, '');
  return suffix ? `codex:${suffix}` : 'codex';
}
```

`accountsFor` needs no change — it already maps source dirs through
`accountInfo`, and both Codex source dirs now resolve to the same root and
therefore the same value.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run electron/services/__tests__/identity.test.ts electron/services/__tests__/accounts.test.ts`
Expected: PASS. `accounts.test.ts` will need its expected `AccountInfo` objects
extended with `tool: 'claude'` and `authMode: null` — update them; do not weaken
the assertions to partial matches.

- [ ] **Step 7: Add the label cases**

Append to `electron/services/__tests__/accounts.test.ts`:

```ts
describe('accountLabel — tool-aware', () => {
  it('labels Codex homes with their tool so tray rows stay unambiguous', () => {
    expect(accountLabel('/home/u/.codex/sessions')).toBe('codex');
    expect(accountLabel('/home/u/.codex/archived_sessions')).toBe('codex');
    expect(accountLabel('/home/u/.codex-work/sessions')).toBe('codex:work');
  });

  it('leaves Claude labels exactly as they were', () => {
    expect(accountLabel('/home/u/.claude/projects')).toBe('default');
    expect(accountLabel('/home/u/.claude-work/projects')).toBe('work');
  });
});
```

Run: `npx vitest run electron/services/__tests__/accounts.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/services/tools/identity.ts electron/services/accounts.ts shared/types.ts electron/services/__tests__/identity.test.ts electron/services/__tests__/accounts.test.ts
git commit -m "feat: read Codex account identity offline from auth.json"
```

---

## Task 5: Renderer fallout from the widened AccountInfo

**Files:**
- Modify: `src/views/AdvisorView.tsx:111-123`
- Modify: `src/views/OverviewView.tsx:57-70`
- Modify: `src/views/InsightsView.tsx`, `src/components/cards/PlanLimits.tsx` (compile fallout only)
- Test: `src/lib/__tests__/crossAccount.test.ts`

**Interfaces:**
- Consumes: `AccountInfo.tool`, `AccountInfo.cleanupPeriodDays: number | null` from Task 4.
- Produces: no new exports.

The compiler catches the field accesses. It does **not** catch the one that
matters: `AdvisorView` picks a login to spend an Anthropic Messages API request
on by filtering `accounts[d]?.hasCredentials`. A Codex account has credentials —
an OpenAI token — and offering it produces a real failed network call.

- [ ] **Step 1: Write the failing test**

`crossAccountAdvice` in `src/lib/crossAccount.ts` is the pure function behind
the same "which account can I switch to" question. Append to
`src/lib/__tests__/crossAccount.test.ts`:

```ts
describe('crossAccountAdvice never proposes a Codex account', () => {
  it('ignores a logged-in Codex account when suggesting somewhere to switch', () => {
    const accounts: AccountsMap = {
      '/home/u/.claude/projects': {
        tool: 'claude', plan: 'max', tier: '20x', email: null, organization: null,
        hasCredentials: true, authMode: null, cleanupPeriodDays: 30,
      },
      '/home/u/.codex/sessions': {
        tool: 'codex', plan: 'pro', tier: null, email: null, organization: null,
        hasCredentials: true, authMode: 'chatgpt', cleanupPeriodDays: null,
      },
    };
    const limits: LimitsMap = {
      '/home/u/.claude/projects': { ok: true, session: { pct: 95, resetsAt: 0 }, week: null },
    };
    // Codex reports no limits and cannot receive a Claude session, so there is
    // nowhere to switch to — one Claude account is not a pair.
    expect(crossAccountAdvice(accounts, limits)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run src/lib/__tests__/crossAccount.test.ts`
Expected: this may already PASS, because `adviceForKind` pairs on accounts that
report limits and Codex reports none. If it passes, keep the test — it pins the
behaviour against a future change to the pairing rule — and note that in a
comment. If it FAILS, add a `tool === 'claude'` guard in `adviceForKind`.

- [ ] **Step 3: Guard the advisor account picker**

In `src/views/AdvisorView.tsx`, at the filter on line 120:

```ts
      // A Codex account has credentials, but they are an OpenAI token — the
      // advisor POSTs the Anthropic Messages API with the stored Claude Code
      // login, so offering one would be a guaranteed 401. Tool first, then
      // credentials.
      .filter((d) => accounts[d]?.tool === 'claude' && accounts[d]?.hasCredentials)
```

- [ ] **Step 4: Handle the nullable retention window**

In `src/views/OverviewView.tsx:68`, the map over `cleanupPeriodDays` must drop
nulls rather than coerce them:

```ts
        .map((d) => accounts[d]?.cleanupPeriodDays)
        .filter((d): d is number => typeof d === 'number')
```

- [ ] **Step 5: Typecheck and fix the remaining call sites**

Run: `npm run typecheck`
Expected: errors in `InsightsView.tsx` and `PlanLimits.tsx` where the new
nullability is not handled. Fix each by skipping Codex accounts or the null
value — never by a non-null assertion (`!`) or a `?? 0`, both of which would
present "no retention policy" as "0 days".

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/AdvisorView.tsx src/views/OverviewView.tsx src/views/InsightsView.tsx src/components/cards/PlanLimits.tsx src/lib/__tests__/crossAccount.test.ts
git commit -m "fix: keep Codex accounts out of Anthropic-only code paths"
```

---

## Task 6: Per-tool managed wrapper files

**Files:**
- Modify: `electron/services/account-setup.ts:42-50, 481-482, 596-710, 986-1040, 1041-1155`
- Modify: `shared/types.ts` (`AccountSpec`, `SetupPlan`)
- Test: `electron/services/__tests__/account-setup.test.ts`

**Interfaces:**
- Consumes: `ToolId`, `toolById`, `toolForRoot`, `TOOLS` from Task 1.
- Produces: `AccountSpec` gains `tool: ToolId`. `SetupPlan.managedPath`/`managedScript` are replaced by `managed: Array<{ tool: ToolId; path: string; script: string }>`. `renderManagedScript(accounts, home, family, tool)` takes a tool and renders only that tool's accounts. `managedNames(accounts)` returns the union across tools.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/account-setup.test.ts`:

```ts
const mixedOpts = (over: Partial<SetupOptions> = {}): SetupOptions => ({
  accounts: [
    { tool: 'claude', name: 'claude-personal', root: path.join(home, '.claude') },
    { tool: 'claude', name: 'claude-work', root: path.join(home, '.claude-work') },
    { tool: 'codex', name: 'codex-personal', root: path.join(home, '.codex') },
    { tool: 'codex', name: 'codex-work', root: path.join(home, '.codex-work') },
  ],
  rcPaths: [path.join(home, '.bashrc')],
  installHelper: true,
  ...over,
});

describe('renderManagedScript — codex', () => {
  it('exports CODEX_HOME and invokes codex, in a subshell', () => {
    const out = renderManagedScript(mixedOpts().accounts, home, 'posix', 'codex');
    expect(out).toContain(`codex-personal() { ( export CODEX_HOME="$HOME/.codex"; codex "$@" ); }`);
    expect(out).toContain(
      `codex-work() { ( export CODEX_HOME="$HOME/.codex-work"; codex "$@" ); }`,
    );
    // the Claude accounts belong in the other file
    expect(out).not.toContain('CLAUDE_CONFIG_DIR');
    expect(out).not.toContain('claude-personal');
  });

  it('scopes and restores $env:CODEX_HOME on PowerShell', () => {
    const out = renderManagedScript(mixedOpts().accounts, home, 'powershell', 'codex');
    expect(out).toContain('function codex-personal {');
    expect(out).toContain(`'CODEX_HOME' = "$HOME/.codex"`);
    expect(out).toContain('codex @args');
    expect(out).toContain('} finally {'); // the leak guard psScopedBody provides
  });
});

describe('crossPairs partitions by tool', () => {
  it('never pairs a Claude account with a Codex one', () => {
    const names = managedNames(mixedOpts().accounts);
    expect(names).toContain('claude-work-from-personal');
    expect(names).toContain('codex-work-from-personal');
    // the nonsense pair: copying a Claude transcript into a Codex home
    expect(names).not.toContain('codex-work-from-claude-personal');
    expect(names.filter((n) => n.includes('-from-'))).toHaveLength(4); // 2 per tool
  });

  it('emits no pairs for a lone account of a tool', () => {
    const names = managedNames([
      { tool: 'claude', name: 'claude-personal', root: path.join(home, '.claude') },
      { tool: 'codex', name: 'codex-personal', root: path.join(home, '.codex') },
    ]);
    expect(names.filter((n) => n.includes('-from-'))).toEqual([]);
  });
});

describe('planSetup — one managed file per tool in use', () => {
  it('plans both files for a mixed account set', () => {
    const plan = planSetup(mixedOpts(), env);
    expect(plan.managed.map((m) => m.tool)).toEqual(['claude', 'codex']);
    expect(plan.managed[1].path).toBe(path.join(home, '.config', 'ccmon', 'codex-accounts.sh'));
  });

  it('plans only the Claude file when there is no Codex account', () => {
    const plan = planSetup(opts(), env);
    expect(plan.managed.map((m) => m.tool)).toEqual(['claude']);
  });
});

describe('applySetup — per-tool files', () => {
  it('writes both files 0600', () => {
    const report = applySetup(mixedOpts(), env);
    expect(report.ok).toBe(true);
    for (const f of ['claude-accounts.sh', 'codex-accounts.sh']) {
      const p = path.join(home, '.config', 'ccmon', f);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    }
  });

  it('removes a tool\'s file when its last account goes away', () => {
    applySetup(mixedOpts(), env);
    const codexFile = path.join(home, '.config', 'ccmon', 'codex-accounts.sh');
    expect(fs.existsSync(codexFile)).toBe(true);

    applySetup(opts(), env); // claude only
    expect(fs.existsSync(codexFile)).toBe(false);
    expect(fs.existsSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'))).toBe(true);
  });
});

describe('validateAccounts — CODEX_HOME is reserved', () => {
  it('rejects CODEX_HOME in the extra-env box', () => {
    const plan = planSetup(
      mixedOpts({
        accounts: [
          {
            tool: 'codex',
            name: 'codex-personal',
            root: path.join(home, '.codex'),
            env: { CODEX_HOME: '/somewhere/else' },
          },
        ],
      }),
      env,
    );
    expect(plan.problems.join(' ')).toContain('CODEX_HOME comes from the config dir');
  });
});
```

Also update the existing `opts()` helper at the top of the file so its two
accounts carry `tool: 'claude'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts`
Expected: FAIL — `renderManagedScript` takes three arguments; `plan.managed` is undefined.

- [ ] **Step 3: Widen the contracts**

In `shared/types.ts`:

```ts
export interface AccountSpec {
  /** which CLI this wrapper launches — see `shared/tools.ts` */
  tool: ToolId;
  /** wrapper command, e.g. 'claude-work' or 'codex-work' */
  name: string;
  /** the tool's home dir, exported as its `homeEnvVar` */
  root: string;
  env?: Record<string, string>;
}
```

and in `SetupPlan`, replace the two `managed*` fields:

```ts
  /**
   * The ccmon-owned wrapper files, one per tool that has accounts. A tool with
   * none contributes no entry and its file is removed on apply.
   */
  managed: Array<{ tool: ToolId; path: string; script: string }>;
```

- [ ] **Step 4: Make the generator tool-driven**

In `electron/services/account-setup.ts`:

Replace the `MANAGED_FILE` constant and `managedRef`/`managedScriptPath` with
per-tool versions:

```ts
const managedFileName = (tool: ToolProfile, family: Family) => tool.managedFile[family];

/** `$HOME`-relative reference to a tool's managed file (forward slashes work in PS too). */
const managedRef = (tool: ToolProfile, family: Family) =>
  `$HOME/.config/ccmon/${managedFileName(tool, family)}`;

const managedScriptPath = (tool: ToolProfile, home: string, family: Family) =>
  path.join(home, '.config', 'ccmon', managedFileName(tool, family));
```

Replace `suggestLabel` with a delegate (keep the export — it is used by tests
and by main):

```ts
/** A nice default wrapper name for a home (~/.claude → claude-personal). */
export const suggestLabel = (root: string): string =>
  toolForRoot(root).suggestWrapperName(root);
```

Make `shortName` tool-aware — it currently strips a literal `claude-`:

```ts
/** Drop the tool prefix so cross-resume names read `<tool>-X-from-Y`. */
const shortName = (spec: AccountSpec) => spec.name.replace(new RegExp(`^${spec.tool}-`), '');
```

Partition `crossPairs`:

```ts
/**
 * The ordered cross-resume pairs, grouped BY TOOL. A `claude-*-from-codex-*`
 * wrapper would copy a Claude transcript into a Codex home, which is nonsense
 * — two accounts per tool yield 2 + 2 pairs, not 12.
 */
function crossPairs(
  accounts: AccountSpec[],
): Array<{ name: string; tool: ToolId; from: AccountSpec; to: AccountSpec }> {
  const pairs: Array<{ name: string; tool: ToolId; from: AccountSpec; to: AccountSpec }> = [];
  for (const tool of TOOLS) {
    const group = accounts.filter((a) => a.tool === tool.id);
    if (group.length < 2) continue;
    for (const to of group) {
      for (const from of group) {
        if (to.name === from.name) continue;
        pairs.push({ name: `${to.name}-from-${shortName(from)}`, tool: tool.id, from, to });
      }
    }
  }
  return pairs;
}
```

Give `renderManagedScript` a tool parameter and filter to it. The body is the
existing one with three substitutions: `CLAUDE_CONFIG_DIR` → `tool.homeEnvVar`,
`claude` (the invoked binary) → `tool.bin`, and the pair loop restricted to
`p.tool === tool.id`:

```ts
export function renderManagedScript(
  accounts: AccountSpec[],
  home: string,
  family: Family = 'posix',
  toolId: ToolId = 'claude',
): string {
  const tool = toolById(toolId);
  const mine = accounts.filter((a) => a.tool === toolId);
  const lines: string[] = [
    `# ccmon-managed — ${tool.label} account wrappers`,
    '# Generated by ccmon (Accounts → multi-account setup). This whole file is',
    '# owned by ccmon and rewritten on each apply; delete it (and the',
    '# `ccmon managed` block in your shell startup file) to uninstall.',
    '',
  ];
  const pairs = crossPairs(accounts).filter((p) => p.tool === toolId);
  const helperRef = `"$HOME/.config/ccmon/${tool.helperName}.ps1"`;

  if (family === 'powershell') {
    for (const a of mine) {
      const sets = [`${psLiteral(tool.homeEnvVar)} = ${psConfigDir(a.root, home)}`, ...psEnvSets(a.env)];
      lines.push(`function ${a.name} {`, psScopedBody(sets, `${tool.bin} @args`), '}', '');
    }
    if (pairs.length) {
      lines.push('# Continue a session on another account when one hits its limit:');
      for (const p of pairs) {
        const sets = [
          `${psLiteral(tool.homeEnvVar)} = ${psConfigDir(p.to.root, home)}`,
          ...psEnvSets(p.to.env),
        ];
        const call =
          `if ($args.Count -lt 1) { Write-Error "usage: ${p.name} <session-id>"; return }; ` +
          `& ${helperRef} ${psConfigDir(p.from.root, home)} ${psConfigDir(p.to.root, home)} $args[0]`;
        lines.push(`function ${p.name} {`, psScopedBody(sets, call), '}', '');
      }
    }
    return lines.join('\n') + '\n';
  }

  for (const a of mine) {
    const sets = [`${tool.homeEnvVar}=${shConfigDir(a.root, home)}`, ...shEnvSets(a.env)];
    // the subshell ( … ) is what keeps every export local to the one command
    lines.push(`${a.name}() { ( export ${sets.join(' ')}; ${tool.bin} "$@" ); }`);
  }
  if (pairs.length) {
    lines.push('', '# Continue a session on another account when one hits its limit:');
    for (const p of pairs) {
      const sets = shEnvSets(p.to.env);
      const exports = sets.length ? `export ${sets.join(' ')}; ` : '';
      lines.push(
        `${p.name}() { ( ${exports}"$HOME/.local/bin/${tool.helperName}" ${shConfigDir(p.from.root, home)} ${shConfigDir(p.to.root, home)} "$1" ); }`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
```

Reserve the second env var:

```ts
/**
 * A tool's home env var is derived from the account's root, never taken from
 * the env map: two sources for one variable is a silent-mismatch bug waiting
 * to happen, and the root is what every other part of ccmon keys on.
 */
const RESERVED_ENV = new Set(TOOLS.map((t) => t.homeEnvVar));
```

The existing validation message reads `${k} comes from the config dir — remove
it`, which already reads correctly for `CODEX_HOME`.

Add `tool` validation to `validateAccounts`:

```ts
    if (!TOOLS.some((t) => t.id === a.tool)) problems.push(`"${a.name}" has an unknown tool`);
```

- [ ] **Step 5: Emit and write one file per tool**

In `planSetup`, replace the two `managed*` return fields:

```ts
  const managed = TOOLS.filter((t) => opts.accounts.some((a) => a.tool === t.id)).map((t) => ({
    tool: t.id,
    path: managedScriptPath(t, home, family),
    script: renderManagedScript(opts.accounts, home, family, t.id),
  }));
```

and return `managed` in place of `managedPath`/`managedScript`.

In `applySetup`, replace the single-file write block with a loop over every
tool — writing the ones in use and removing the ones that are not:

```ts
  let wroteManaged = false;
  for (const tool of TOOLS) {
    const dest = managedScriptPath(tool, home, family);
    const mine = opts.accounts.some((a) => a.tool === tool.id);
    try {
      if (!mine) {
        // deleting your last account of a tool cleans up after itself, rather
        // than leaving a stale file the rc keeps sourcing
        fs.rmSync(dest, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // 0600: an account's env may carry a provider API token, and this file is
      // only ever read by the user's own shell.
      fs.writeFileSync(dest, renderManagedScript(opts.accounts, home, family, tool.id), {
        mode: 0o600,
      });
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o600); // umask cannot loosen it
      wroteManaged = true;
    } catch (e) {
      errors.push(`managed file (${tool.id}): ${msg(e)}`);
    }
  }
```

Apply the same loop to `writeWrapperAccounts`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts`
Expected: PASS. Existing cases asserting on `plan.managedPath` must be updated
to `plan.managed[0].path`.

- [ ] **Step 7: Commit**

```bash
git add electron/services/account-setup.ts shared/types.ts electron/services/__tests__/account-setup.test.ts
git commit -m "feat: generate a managed wrapper file per tool"
```

---

## Task 7: An rc block that sources both files, replaced in place

**Files:**
- Modify: `electron/services/account-setup.ts:53-71, 986-1040, 1094-1105`
- Test: `electron/services/__tests__/account-setup.test.ts`

**Interfaces:**
- Consumes: `TOOLS`, per-tool `managedRef` from Task 6.
- Produces: `SetupPlan.rcEdits[].blockToAdd` is now also populated when a *stale* block needs replacing; a new sibling field `blockReplaces: boolean` says which it is.

Today the rc block is append-only: `rcLinked()` tests for `MARK_BEGIN` and a
linked rc is skipped. Every existing user is linked with the old one-line block
and would never receive the second source line — their Codex wrappers would be
written and never loaded.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/account-setup.test.ts`:

```ts
describe('rc block — sources every tool file, unconditionally', () => {
  it('emits a guarded source line per tool regardless of which accounts exist', () => {
    applySetup(opts(), env); // claude only
    const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    expect(rc).toContain('claude-accounts.sh');
    // present but [ -f ]-guarded, so the block's content never depends on
    // which accounts exist and never has to change again
    expect(rc).toContain('codex-accounts.sh');
  });
});

describe('rc block — in-place replacement', () => {
  const OLD_BLOCK = [
    '# >>> ccmon managed >>>',
    '# Claude Code multi-account wrappers, managed by ccmon. Remove this block',
    '# (and $HOME/.config/ccmon/claude-accounts.sh) to uninstall.',
    '[ -f "$HOME/.config/ccmon/claude-accounts.sh" ] && . "$HOME/.config/ccmon/claude-accounts.sh"',
    '# <<< ccmon managed <<<',
  ].join('\n');

  it('replaces a stale block instead of leaving it or appending a second one', () => {
    const rc = path.join(home, '.bashrc');
    fs.writeFileSync(rc, `# user stuff\nalias ll='ls -l'\n\n${OLD_BLOCK}\n\n# after\n`);

    applySetup(mixedOpts(), env);

    const text = fs.readFileSync(rc, 'utf8');
    expect(text.match(/>>> ccmon managed >>>/g)).toHaveLength(1);
    expect(text).toContain('codex-accounts.sh');
    // everything outside the markers survives, in place
    expect(text).toContain("alias ll='ls -l'");
    expect(text).toContain('# after');
  });

  it('is idempotent — a second apply changes nothing', () => {
    const rc = path.join(home, '.bashrc');
    applySetup(mixedOpts(), env);
    const first = fs.readFileSync(rc, 'utf8');
    applySetup(mixedOpts(), env);
    expect(fs.readFileSync(rc, 'utf8')).toBe(first);
  });

  it('never touches a hand-written line outside the markers', () => {
    const rc = path.join(home, '.bashrc');
    fs.writeFileSync(rc, `${OLD_BLOCK}\nexport EDITOR=vim\n`);
    applySetup(mixedOpts(), env);
    expect(fs.readFileSync(rc, 'utf8')).toContain('export EDITOR=vim');
  });

  it('reports the replacement in the preview rather than calling it linked', () => {
    const rc = path.join(home, '.bashrc');
    fs.writeFileSync(rc, `${OLD_BLOCK}\n`);
    const plan = planSetup(mixedOpts(), env);
    const edit = plan.rcEdits[0];
    expect(edit.alreadyLinked).toBe(true);
    expect(edit.blockReplaces).toBe(true);
    expect(edit.blockToAdd).toContain('codex-accounts.sh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts -t "rc block"`
Expected: FAIL — the stale block survives untouched and `blockReplaces` does not exist.

- [ ] **Step 3: Emit both source lines**

Replace `rcSourceBlock` in `electron/services/account-setup.ts`:

```ts
/**
 * The guarded block appended to the rc — sources every tool's managed file.
 *
 * Every line is emitted unconditionally and `[ -f ]`-guarded, so the block's
 * content does NOT depend on which accounts exist. That is deliberate: a block
 * whose content varied would need rewriting whenever the account set changed,
 * and a user who never re-ran the wizard would silently stop loading a tool.
 */
function rcSourceBlock(family: Family): string {
  const refs = TOOLS.map((t) => managedRef(t, family));
  if (family === 'powershell') {
    return [
      MARK_BEGIN,
      '# Claude Code / Codex account wrappers, managed by ccmon. Remove this',
      '# block (and the files it sources) to uninstall.',
      ...refs.map((ref) => `if (Test-Path "${ref}") { . "${ref}" }`),
      MARK_END,
    ].join('\n');
  }
  return [
    MARK_BEGIN,
    '# Claude Code / Codex account wrappers, managed by ccmon. Remove this',
    '# block (and the files it sources) to uninstall.',
    ...refs.map((ref) => `[ -f "${ref}" ] && . "${ref}"`),
    MARK_END,
  ].join('\n');
}
```

- [ ] **Step 4: Replace a stale block**

Add next to `managedBlockRange`:

```ts
/**
 * Swap ccmon's managed block for `block`, or append it when absent. Returns
 * the text unchanged when the block is already exactly right, so callers can
 * use identity to decide whether anything needs writing.
 *
 * Replacement — rather than the old append-only behaviour — is what lets the
 * block's contents evolve. When Codex support added a second source line,
 * every already-linked user would otherwise have kept a block that loads only
 * the Claude wrappers, with no error to point at.
 */
function upsertManagedBlock(text: string, block: string): string {
  const lines = text.split('\n');
  const range = managedBlockRange(lines);
  if (!range) {
    const lead = text && !text.endsWith('\n') ? '\n' : '';
    return `${text}${lead}\n${block}\n`;
  }
  const [start, end] = range;
  if (lines.slice(start, end).join('\n') === block) return text;
  return [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)].join('\n');
}
```

In `applySetup`, replace the `if (!body.includes(MARK_BEGIN))` block:

```ts
      const withBlock = upsertManagedBlock(body, block);
      if (withBlock !== body) {
        body = withBlock;
        mutated = true;
        linkedRc.push(rcPath);
      }
```

- [ ] **Step 5: Report it in the preview**

In `shared/types.ts`, add to the `rcEdits` element type:

```ts
    /** true when a ccmon block is already there but its contents are stale */
    blockReplaces: boolean;
```

In `planSetup`, replace the `rcEdits` return object:

```ts
    const current = fileText(rcPath) ?? '';
    const next = upsertManagedBlock(current, block);
    const changes = next !== current;
    return {
      rcPath,
      alreadyLinked,
      // a stale block still needs writing, so the preview must show it rather
      // than reporting "already linked" and writing something anyway
      blockToAdd: changes ? block : '',
      blockReplaces: alreadyLinked && changes,
      existing,
    };
```

- [ ] **Step 6: Surface it in the wizard preview**

In `src/components/accounts/SetupWizard.tsx`, wherever `alreadyLinked` decides
the per-rc preview copy, prefer the replacement wording:

```tsx
{edit.blockReplaces
  ? 'updating the existing ccmon block (it predates Codex support)'
  : edit.alreadyLinked
    ? 'already linked'
    : 'will add the ccmon block'}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts && npm run typecheck`
Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add electron/services/account-setup.ts shared/types.ts src/components/accounts/SetupWizard.tsx electron/services/__tests__/account-setup.test.ts
git commit -m "feat: source every tool's wrapper file and replace a stale rc block in place"
```

---

## Task 8: The codex-cross-resume bash helper

**Files:**
- Create: `electron/services/tools/codex-resume.ts`
- Modify: `electron/services/account-setup.ts` (helper install paths)
- Test: `electron/services/__tests__/account-setup.test.ts`

**Interfaces:**
- Consumes: `ToolProfile.helperName` from Task 1.
- Produces: `CODEX_HELPER_SCRIPT: string` (bash), `CODEX_PS_HELPER_SCRIPT: string` (added in Task 9). `helperPath(tool, home, family)` and `helperScript(tool, family)` gain a tool parameter.

Same contract as `claude-cross-resume`: `--force`, `--keep`, `--dry-run`,
`--no-launch`; overwrite only when the source has more lines; every overwrite
backed up to a timestamped `*.bak` first.

Three things differ, and all three are load-bearing:
1. The session id is a UUID *inside* the filename (`rollout-<ts>-<uuid>.jsonl`), not the basename.
2. The destination must preserve the `YYYY/MM/DD/` segment relative to `sessions/`, or `codex resume` will not find it.
3. `cwd` comes from line 1 (`type: "session_meta"`), and a rollout under `archived_sessions/` is restored into the destination's `sessions/`.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/account-setup.test.ts`:

```ts
describe('codex-cross-resume helper', () => {
  it('is installed beside the Claude one, executable', () => {
    const report = applySetup(mixedOpts(), env);
    expect(report.helperInstalled).toBe(true);
    const dest = path.join(home, '.local', 'bin', 'codex-cross-resume');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o755);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'claude-cross-resume'))).toBe(true);
  });

  it('is not installed when no Codex account exists', () => {
    applySetup(opts(), env);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'codex-cross-resume'))).toBe(false);
  });

  it('resolves the session by the uuid inside the filename, not the basename', () => {
    applySetup(mixedOpts(), env);
    const script = fs.readFileSync(path.join(home, '.local', 'bin', 'codex-cross-resume'), 'utf8');
    expect(script).toContain('rollout-*-${id}.jsonl');
    // both live and archived rollouts are resumable
    expect(script).toContain('archived_sessions');
    // the date-nested path must survive the copy or `codex resume` cannot find it
    expect(script).toContain('rel=');
    expect(script).toContain('codex resume');
    expect(script).toContain('CODEX_HOME');
  });

  it('the generated wrapper calls the codex helper, not the claude one', () => {
    const out = renderManagedScript(mixedOpts().accounts, home, 'posix', 'codex');
    expect(out).toContain('"$HOME/.local/bin/codex-cross-resume"');
    expect(out).not.toContain('claude-cross-resume');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts -t "codex-cross-resume"`
Expected: FAIL — no such file is installed.

- [ ] **Step 3: Write the helper**

Create `electron/services/tools/codex-resume.ts`:

```ts
/**
 * @file codex-resume.ts
 * @brief The embedded codex-cross-resume helper scripts (bash + PowerShell).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * The Codex twin of `claude-cross-resume`, embedded so the packaged app is
 * self-contained. Same contract, same flags, same overwrite policy.
 *
 * Three things differ from the Claude twin, all forced by the format:
 *
 *   1. THE ID IS INSIDE THE FILENAME. A rollout is
 *      `rollout-<timestamp>-<uuid>.jsonl`, so the session id cannot be taken
 *      from the basename the way a Claude transcript's can.
 *   2. THE DESTINATION IS DATE-NESTED. Rollouts live under
 *      `sessions/YYYY/MM/DD/`, and `codex resume` will not find a session
 *      copied to a flat `sessions/`. The path relative to the sessions root
 *      must be preserved.
 *   3. ARCHIVED SESSIONS ARE RESUMABLE. A rollout found under
 *      `archived_sessions/` is restored into the destination's `sessions/` —
 *      resuming it is precisely un-archiving it.
 */
export const CODEX_HELPER_SCRIPT = `#!/usr/bin/env bash
#
# codex-cross-resume — continue a Codex session under a different CODEX_HOME.
# Installed by ccmon. See the Claude twin at ~/.local/bin/claude-cross-resume.
#
# Copies a rollout log from one Codex home into another, preserving its
# sessions/YYYY/MM/DD/ path, reads the original working directory out of the
# session_meta line, then re-launches \\\`codex resume <uuid>\\\` there with
# CODEX_HOME pointed at the destination.
#
# Overwrite policy (identical to the Claude twin)
#   A resumed session only ever APPENDS to its rollout, so line count is a
#   reliable "which side is newer" signal.
#     - destination missing   -> copy
#     - source has MORE lines -> overwrite (destination backed up first)
#     - source has <= lines   -> keep destination
#   --force overwrites regardless; --keep never touches an existing
#   destination. Any overwrite backs the destination up to a timestamped
#   *.bak first, so nothing is lost.
#
# Usage: codex-cross-resume [--force|--keep|--dry-run|--no-launch] \\\\
#            <src-codex-home> <dst-codex-home> <session-uuid>

set -euo pipefail

readonly PROG=$(basename "$0")

usage() {
    cat <<EOF
$PROG — continue a Codex session under a different CODEX_HOME.

Usage:
  $PROG [options] <src-codex-home> <dst-codex-home> <session-uuid>

Options:
  -f, --force        Overwrite an existing destination rollout even if it is
                     same-or-newer (the old copy is still backed up).
      --keep         Never overwrite an existing destination (strict).
  -n, --dry-run      Report what would happen; copy nothing and do not launch.
      --no-launch    Copy as normal but do not exec \\\\\\\`codex resume\\\\\\\`.
  -h, --help         Show this help and exit.

Default (no -f/--keep): overwrite only when the source has more lines than the
destination — a resumed session only appends, so more lines == newer.
EOF
}

log()  { printf '%s\\\\n' "$*" >&2; }
die()  { printf '%s: %s\\\\n' "$PROG" "$1" >&2; exit "\\\${2:-1}"; }

force=0
keep=0
dry_run=0
launch=1
positional=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f | --force)   force=1 ;;
        --keep)         keep=1 ;;
        -n | --dry-run) dry_run=1 ;;
        --no-launch)    launch=0 ;;
        -h | --help)    usage; exit 0 ;;
        --)             shift; while [[ $# -gt 0 ]]; do positional+=("$1"); shift; done; break ;;
        -*)             die "unknown option: $1" 64 ;;
        *)              positional+=("$1") ;;
    esac
    shift
done

src="\\\${positional[0]:-}"
dst="\\\${positional[1]:-}"
id="\\\${positional[2]:-}"

[[ -n $src && -n $dst && -n $id ]] || { usage >&2; exit 64; }
[[ $force -eq 1 && $keep -eq 1 ]] && die "--force and --keep are mutually exclusive" 64
[[ -d $src ]] || die "source Codex home not found: $src" 66
[[ -d $dst ]] || die "destination Codex home not found: $dst" 66

# The id is embedded in the filename, not the basename. Look in sessions/
# first, then archived_sessions/ — resuming an archived rollout un-archives it.
src_file=""
src_base=""
for base in sessions archived_sessions; do
    [[ -d "$src/$base" ]] || continue
    found=$(find "$src/$base" -name "rollout-*-\\\${id}.jsonl" -type f 2>/dev/null | head -1)
    if [[ -n $found ]]; then src_file="$found"; src_base="$base"; break; fi
done
[[ -n $src_file ]] || die "session $id not found under $src/sessions or $src/archived_sessions"

# Preserve the YYYY/MM/DD/ path relative to the base dir: codex resume looks
# the session up by its date-nested location, so a flat copy is not found.
rel="\\\${src_file#$src/$src_base/}"
dst_file="$dst/sessions/$rel"
dst_dir=$(dirname "$dst_file")

lines() { wc -l < "$1" 2>/dev/null | tr -d ' '; }

backup_path() {
    local base="\\\${dst_file}.$(date +%Y%m%d-%H%M%S).bak" candidate n=1
    candidate="$base"
    while [[ -e $candidate ]]; do candidate="\\\${base}-\\\${n}"; ((n++)); done
    printf '%s' "$candidate"
}

do_copy() {
    if [[ $dry_run -eq 1 ]]; then
        [[ -e $dst_file ]] && log "[dry-run] would back up existing destination"
        log "[dry-run] would copy rollout → $dst_file ($(lines "$src_file") lines)"
        return
    fi
    mkdir -p "$dst_dir"
    if [[ -e $dst_file ]]; then
        local bak; bak=$(backup_path)
        cp -p "$dst_file" "$bak"
        log "backed up existing destination → $bak"
    fi
    cp "$src_file" "$dst_file"
    echo "copied rollout → $dst_file ($(lines "$src_file") lines)"
}

if [[ ! -e $dst_file ]]; then
    do_copy
elif [[ $keep -eq 1 ]]; then
    log "note: destination exists — keeping it (--keep)"
elif [[ $force -eq 1 ]]; then
    log "overwriting destination (--force)"
    do_copy
else
    src_lines=$(lines "$src_file"); dst_lines=$(lines "$dst_file")
    if [[ \\\${src_lines:-0} -gt \\\${dst_lines:-0} ]]; then
        log "source is newer (\\\${src_lines} > \\\${dst_lines} lines) — overwriting"
        do_copy
    else
        log "note: destination is same-or-newer (\\\${dst_lines} >= \\\${src_lines} lines) — keeping it; use --force to override"
    fi
fi

# --- locate the original working directory ----------------------------------
# Line 1 of a rollout is \\\`session_meta\\\`, which carries cwd. node first:
# macOS ships no python3 until the command line tools are installed, and node
# is what ran ccmon in the first place.
cwd=""
read_cwd_node() {
    node -e '
const fs = require("fs");
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\\\\n")) {
  if (!line) continue;
  try {
    const d = JSON.parse(line);
    const p = (d && d.payload) || d;
    if (p && p.cwd) { process.stdout.write(p.cwd); break; }
  } catch {}
}' "$1" 2>/dev/null || true
}
read_cwd_python() {
    python3 - "$1" <<'PY' 2>/dev/null || true
import json, sys
for line in open(sys.argv[1]):
    try:
        d = json.loads(line)
    except Exception:
        continue
    p = d.get("payload", d) if isinstance(d, dict) else None
    if isinstance(p, dict) and p.get("cwd"):
        print(p["cwd"]); break
PY
}
if command -v node >/dev/null 2>&1; then
    cwd=$(read_cwd_node "$src_file")
elif command -v python3 >/dev/null 2>&1; then
    cwd=$(read_cwd_python "$src_file")
fi

if [[ $dry_run -eq 1 || $launch -eq 0 ]]; then
    reason=$([[ $dry_run -eq 1 ]] && echo "dry-run" || echo "--no-launch")
    log "[$reason] not launching. To resume manually:"
    log "  cd '\\\${cwd:-<project dir>}' && CODEX_HOME='$dst' codex resume $id"
    exit 0
fi

if [[ -n $cwd && -d $cwd ]]; then
    cd "$cwd"
    export CODEX_HOME="$dst"
    exec codex resume "$id"
fi

cat >&2 <<EOF
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  CODEX_HOME='$dst' codex resume $id
EOF
exit 1
`;
```

- [ ] **Step 4: Install it per tool**

In `electron/services/account-setup.ts`, make the helper paths tool-aware:

```ts
/**
 * Where a tool's cross-resume helper lands. POSIX keeps the Unix convention
 * (`~/.local/bin`, mode 0755, called by absolute path since macOS does not put
 * it on PATH). Windows has no such convention and no executable bit, so the
 * `.ps1` sits next to the managed wrapper file that calls it.
 */
const helperPath = (tool: ToolProfile, home: string, family: Family = 'posix'): string =>
  family === 'powershell'
    ? path.join(home, '.config', 'ccmon', `${tool.helperName}.ps1`)
    : path.join(home, '.local', 'bin', tool.helperName);

const helperScript = (tool: ToolProfile, family: Family): string => {
  if (tool.id === 'codex') {
    return family === 'powershell' ? CODEX_PS_HELPER_SCRIPT : CODEX_HELPER_SCRIPT;
  }
  return family === 'powershell' ? PS_HELPER_SCRIPT : HELPER_SCRIPT;
};
```

`CODEX_PS_HELPER_SCRIPT` is written in Task 9. Do Task 9's Step 3 before
running a typecheck here, and land Tasks 8 and 9 as one commit — splitting them
leaves `helperScript` referencing an undefined constant.

In `planSetup`, replace the single `helperDest`/`helperInstalled` pair — the
plan now reports one entry per tool in use:

```ts
  const helpers = TOOLS.filter((t) => opts.accounts.some((a) => a.tool === t.id)).map((t) => ({
    tool: t.id,
    dest: helperPath(t, home, family),
    installed: fileEquals(helperPath(t, home, family), helperScript(t, family)),
  }));
```

In `shared/types.ts`, `SetupPlan`:

```ts
  /** one cross-resume helper per tool that has accounts */
  helpers: Array<{ tool: ToolId; dest: string; installed: boolean }>;
```

replacing `helperDest`/`helperInstalled`.

In `applySetup`, loop the install:

```ts
  let helperInstalled = false;
  if (opts.installHelper) {
    for (const tool of TOOLS) {
      if (!opts.accounts.some((a) => a.tool === tool.id)) continue;
      const dest = helperPath(tool, home, family);
      const script = helperScript(tool, family);
      try {
        if (!fileEquals(dest, script)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (family === 'powershell') {
            fs.writeFileSync(dest, script);
          } else {
            fs.writeFileSync(dest, script, { mode: 0o755 });
            fs.chmodSync(dest, 0o755); // writeFileSync mode is masked by umask
          }
        }
        helperInstalled = true;
      } catch (e) {
        errors.push(`helper (${tool.id}): ${msg(e)}`);
      }
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Smoke the generated script by hand**

```bash
bash -n <(node -e "console.log(require('./electron/services/tools/codex-resume.ts'))") 2>/dev/null || true
npm run cli -- json --help >/dev/null   # proves the services still load under node
```

Then, more directly — the embedded script must be syntactically valid bash:

```bash
npx tsx -e "import('./electron/services/tools/codex-resume.ts').then(m => process.stdout.write(m.CODEX_HELPER_SCRIPT))" > /tmp/claude-1000/-home-pingspace-Documents-2-PERSONAL-ccmon/d4d9470e-e409-4446-96c9-d8e2859b6beb/scratchpad/codex-cross-resume.sh
bash -n /tmp/claude-1000/-home-pingspace-Documents-2-PERSONAL-ccmon/d4d9470e-e409-4446-96c9-d8e2859b6beb/scratchpad/codex-cross-resume.sh
```

Expected: `bash -n` exits 0 with no output. This catches template-literal
escaping bugs that no unit test will — the Claude twin's `\\\`` and `\\\${}`
sequences are easy to get wrong.

- [ ] **Step 7: Commit**

```bash
git add electron/services/tools/codex-resume.ts electron/services/account-setup.ts shared/types.ts electron/services/__tests__/account-setup.test.ts
git commit -m "feat: add the codex-cross-resume bash helper"
```

---

## Task 9: The codex-cross-resume PowerShell helper

**Files:**
- Modify: `electron/services/tools/codex-resume.ts`
- Test: `electron/services/__tests__/account-setup.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CODEX_PS_HELPER_SCRIPT: string`.

PowerShell 5.1-compatible — no ternary, no null-coalescing. Windows ships 5.1
and a script that only runs under pwsh 7 would be useless on a stock box. This
is why the CI matrix has a Windows runner.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/account-setup.test.ts`:

```ts
describe('codex-cross-resume — PowerShell', () => {
  const winEnv = (h: string): SetupEnv => ({
    home: h,
    loginShell: null,
    platform: 'win32',
    psProfile: path.join(h, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
  });

  it('installs the .ps1 beside the managed file', () => {
    const e = winEnv(home);
    const report = applySetup({ ...mixedOpts(), rcPaths: [e.psProfile!] }, e);
    expect(report.ok).toBe(true);
    expect(fs.existsSync(path.join(home, '.config', 'ccmon', 'codex-cross-resume.ps1'))).toBe(true);
  });

  it('stays PowerShell 5.1-compatible', () => {
    const e = winEnv(home);
    applySetup({ ...mixedOpts(), rcPaths: [e.psProfile!] }, e);
    const script = fs.readFileSync(
      path.join(home, '.config', 'ccmon', 'codex-cross-resume.ps1'),
      'utf8',
    );
    // 5.1 has neither of these; they parse only under pwsh 7
    expect(script).not.toMatch(/\?\?/);
    expect(script).not.toMatch(/\)\s*\?\s*.+\s*:\s*/);
    expect(script).toContain('$env:CODEX_HOME');
    expect(script).toContain('codex resume');
  });

  it('the generated PS wrapper points at the codex helper', () => {
    const out = renderManagedScript(mixedOpts().accounts, home, 'powershell', 'codex');
    expect(out).toContain('codex-cross-resume.ps1');
    expect(out).not.toContain('claude-cross-resume.ps1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts -t "PowerShell"`
Expected: FAIL — no `.ps1` is written.

- [ ] **Step 3: Write the script**

Append to `electron/services/tools/codex-resume.ts`:

```ts
/**
 * The Windows port of the helper above — same contract, same overwrite policy,
 * PowerShell 5.1-compatible (no ternary, no null-coalescing).
 *
 * Reading `cwd` needs no external interpreter here: ConvertFrom-Json is built
 * in, which is the one thing the bash version has to shell out to node for.
 */
export const CODEX_PS_HELPER_SCRIPT = `# codex-cross-resume.ps1 — continue a Codex session under a different CODEX_HOME.
# Installed by ccmon. See the POSIX twin at ~/.local/bin/codex-cross-resume.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string] $Src,
    [Parameter(Mandatory = $true, Position = 1)][string] $Dst,
    [Parameter(Mandatory = $true, Position = 2)][string] $Id,
    [switch] $Force,
    [switch] $Keep,
    [switch] $DryRun,
    [switch] $NoLaunch
)

$ErrorActionPreference = 'Stop'

# -ErrorAction Continue: the preference above is Stop, which would make
# Write-Error terminating here and leave the exit below unreachable.
function Fail($m) { Write-Error $m -ErrorAction Continue; exit 1 }
function Note($m) { Write-Host $m -ForegroundColor DarkGray }

if ($Force -and $Keep) { Fail '-Force and -Keep are mutually exclusive' }
if (-not (Test-Path -LiteralPath $Src -PathType Container)) { Fail "source Codex home not found: $Src" }
if (-not (Test-Path -LiteralPath $Dst -PathType Container)) { Fail "destination Codex home not found: $Dst" }

# The id is inside the filename, not the basename. sessions/ first, then
# archived_sessions/ — resuming an archived rollout un-archives it.
$srcFile = $null
$srcBase = $null
foreach ($base in @('sessions', 'archived_sessions')) {
    $dir = Join-Path $Src $base
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    $hit = Get-ChildItem -LiteralPath $dir -Filter "rollout-*-$Id.jsonl" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $srcFile = $hit; $srcBase = $base; break }
}
if (-not $srcFile) { Fail "session $Id not found under $Src\\sessions or $Src\\archived_sessions" }

# Preserve the YYYY\\MM\\DD path relative to the base dir: codex resume looks a
# session up by its date-nested location, so a flat copy is not found.
$baseDir = (Resolve-Path -LiteralPath (Join-Path $Src $srcBase)).Path
$rel     = $srcFile.FullName.Substring($baseDir.Length).TrimStart('\\', '/')
$dstFile = Join-Path (Join-Path $Dst 'sessions') $rel
$dstDir  = Split-Path -Parent $dstFile

function LineCount($p) {
    if (-not (Test-Path -LiteralPath $p)) { return 0 }
    return (Get-Content -LiteralPath $p -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
}

function BackupPath {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $base = "$dstFile.$stamp.bak"
    $candidate = $base
    $n = 1
    while (Test-Path -LiteralPath $candidate) { $candidate = "$base-$n"; $n++ }
    return $candidate
}

function DoCopy {
    if ($DryRun) {
        if (Test-Path -LiteralPath $dstFile) { Note '[dry-run] would back up existing destination' }
        Note "[dry-run] would copy rollout -> $dstFile ($(LineCount $srcFile.FullName) lines)"
        return
    }
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    if (Test-Path -LiteralPath $dstFile) {
        $bak = BackupPath
        Copy-Item -LiteralPath $dstFile -Destination $bak
        Note "backed up existing destination -> $bak"
    }
    Copy-Item -LiteralPath $srcFile.FullName -Destination $dstFile
    Write-Host "copied rollout -> $dstFile ($(LineCount $srcFile.FullName) lines)"
}

if (-not (Test-Path -LiteralPath $dstFile)) {
    DoCopy
} elseif ($Keep) {
    Note 'note: destination exists — keeping it (-Keep)'
} elseif ($Force) {
    Note 'overwriting destination (-Force)'
    DoCopy
} else {
    $srcLines = LineCount $srcFile.FullName
    $dstLines = LineCount $dstFile
    if ($srcLines -gt $dstLines) {
        Note "source is newer ($srcLines > $dstLines lines) — overwriting"
        DoCopy
    } else {
        Note "note: destination is same-or-newer ($dstLines >= $srcLines lines) — keeping it; use -Force to override"
    }
}

# --- locate the original working directory ----------------------------------
# Line 1 of a rollout is session_meta, which carries cwd.
$cwd = ''
foreach ($line in (Get-Content -LiteralPath $srcFile.FullName -ErrorAction SilentlyContinue)) {
    if (-not $line) { continue }
    try { $d = $line | ConvertFrom-Json } catch { continue }
    $p = $d
    if ($d.PSObject.Properties.Name -contains 'payload') { $p = $d.payload }
    if ($p -and $p.PSObject.Properties.Name -contains 'cwd' -and $p.cwd) { $cwd = $p.cwd; break }
}

if ($DryRun -or $NoLaunch) {
    $reason = '-NoLaunch'
    if ($DryRun) { $reason = 'dry-run' }
    Note "[$reason] not launching. To resume manually:"
    $where = '<project dir>'
    if ($cwd) { $where = $cwd }
    Note "  cd '$where'; \\$env:CODEX_HOME = '$Dst'; codex resume $Id"
    exit 0
}

if ($cwd -and (Test-Path -LiteralPath $cwd -PathType Container)) {
    Set-Location -LiteralPath $cwd
    $env:CODEX_HOME = $Dst
    & codex resume $Id
    exit $LASTEXITCODE
}

Write-Error @"
could not auto-locate the original working directory.
cd to the project dir manually, then run:
  \\$env:CODEX_HOME = '$Dst'; codex resume $Id
"@ -ErrorAction Continue
exit 1
`;
```

Import it in `account-setup.ts` alongside `CODEX_HELPER_SCRIPT` and complete the
`helperScript` function from Task 8.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify it parses as PowerShell (Windows CI does this for real)**

If a `pwsh` is available locally:

```bash
npx tsx -e "import('./electron/services/tools/codex-resume.ts').then(m => process.stdout.write(m.CODEX_PS_HELPER_SCRIPT))" > /tmp/claude-1000/-home-pingspace-Documents-2-PERSONAL-ccmon/d4d9470e-e409-4446-96c9-d8e2859b6beb/scratchpad/codex-cross-resume.ps1
pwsh -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('/tmp/claude-1000/-home-pingspace-Documents-2-PERSONAL-ccmon/d4d9470e-e409-4446-96c9-d8e2859b6beb/scratchpad/codex-cross-resume.ps1', [ref]\$null, [ref]\$errs); \$errs"
```

Expected: an empty error list. If `pwsh` is not installed, say so and rely on the
Windows CI job — do not claim it was verified.

- [ ] **Step 6: Commit**

```bash
git add electron/services/tools/codex-resume.ts electron/services/account-setup.ts electron/services/__tests__/account-setup.test.ts
git commit -m "feat: add the codex-cross-resume PowerShell helper"
```

---

## Task 10: Tool-aware account directory create and rename

**Files:**
- Modify: `electron/services/account-setup.ts:1198-1258`
- Modify: `shared/ipc.ts:158-168`
- Modify: `electron/main.ts:1209-1240`
- Test: `electron/services/__tests__/account-setup.test.ts`

**Interfaces:**
- Consumes: `ToolId`, `toolById`, `toolForRoot` from Task 1.
- Produces: `createAccountDir(suffix: string, tool: ToolId, env?: SetupEnv)`; `renameAccountDir(root: string, suffix: string, env?: SetupEnv)` — rename infers the tool from the root, since a root cannot change tools. IPC: `createAccount(suffix: string, tool: ToolId)`, `renameAccount(root: string, suffix: string)` unchanged in arity.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/account-setup.test.ts`:

```ts
describe('createAccountDir — per tool', () => {
  it('seeds a Codex home with sessions/, not projects/', () => {
    const res = createAccountDir('work', 'codex', env);
    expect(res.ok).toBe(true);
    expect(res.root).toBe(path.join(home, '.codex-work'));
    expect(fs.existsSync(path.join(home, '.codex-work', 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.codex-work', 'projects'))).toBe(false);
  });

  it('still seeds a Claude root with projects/', () => {
    const res = createAccountDir('work', 'claude', env);
    expect(fs.existsSync(path.join(home, '.claude-work', 'projects'))).toBe(true);
  });

  it('treats an existing home as success', () => {
    createAccountDir('work', 'codex', env);
    expect(createAccountDir('work', 'codex', env).ok).toBe(true);
  });

  it('rejects a suffix that is not a plain identifier', () => {
    expect(createAccountDir('../escape', 'codex', env).ok).toBe(false);
  });
});

describe('renameAccountDir — per tool', () => {
  it('renames a Codex sibling and infers the tool from the root', () => {
    createAccountDir('work', 'codex', env);
    const res = renameAccountDir(path.join(home, '.codex-work'), 'client', env);
    expect(res.ok).toBe(true);
    expect(res.root).toBe(path.join(home, '.codex-client'));
    expect(fs.existsSync(path.join(home, '.codex-client', 'sessions'))).toBe(true);
  });

  it('refuses the default Codex home, as it does the default Claude one', () => {
    fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
    const res = renameAccountDir(path.join(home, '.codex'), 'other', env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("can't rename the default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts -t "per tool"`
Expected: FAIL — `createAccountDir` takes `(suffix, env)`, so `'codex'` lands in the `env` slot.

- [ ] **Step 3: Thread the tool through**

In `electron/services/account-setup.ts`:

```ts
/**
 * Create a sibling home `~/.<tool>-<suffix>` (with the subdir that makes it
 * discoverable) so it shows up as a new account. The user still logs in there
 * once via the generated wrapper. Returns the new root or a validation reason.
 */
export function createAccountDir(
  suffix: string,
  tool: ToolId = 'claude',
  env: SetupEnv = defaultEnv(),
): { ok: boolean; root: string; error?: string } {
  const profile = toolById(tool);
  const clean = suffix.trim().replace(/^[.\s]+/, '');
  if (!SUFFIX_RE.test(clean)) {
    return { ok: false, root: '', error: 'use letters, digits, dash or underscore' };
  }
  const root = path.join(env.home, `.${profile.id}-${clean}`);
  if (dirExists(path.join(root, profile.seedDir))) {
    return { ok: true, root }; // already there — treat as success
  }
  try {
    fs.mkdirSync(path.join(root, profile.seedDir), { recursive: true });
    return { ok: true, root };
  } catch (e) {
    return { ok: false, root, error: msg(e) };
  }
}
```

Note the `fileExists` → `dirExists` change: `fileExists` reads the path and so
returns false for a directory, which meant the "already there" branch never
fired. Keep that fix.

```ts
/**
 * Rename a sibling account's home on disk: `~/.<tool>-<old>` →
 * `~/.<tool>-<suffix>`. The tool is inferred from the root — a home cannot
 * change tools. Each tool's DEFAULT home is refused: its bare CLI falls back
 * to that literal path when the home env var is unset, so moving it would
 * break anything outside ccmon's wrappers.
 */
export function renameAccountDir(
  root: string,
  suffix: string,
  env: SetupEnv = defaultEnv(),
): { ok: boolean; root: string; error?: string } {
  const { home } = env;
  const profile = toolForRoot(root);
  if (profile.isDefaultRoot(root)) {
    return { ok: false, root, error: `can't rename the default ~/.${profile.id} account` };
  }
  const clean = suffix.trim().replace(/^[.\s]+/, '');
  if (!SUFFIX_RE.test(clean)) {
    return { ok: false, root, error: 'use letters, digits, dash or underscore' };
  }
  const newRoot = path.join(home, `.${profile.id}-${clean}`);
  if (newRoot === root) return { ok: true, root };
  if (!fs.existsSync(root)) return { ok: false, root, error: 'account folder not found' };
  if (fs.existsSync(newRoot)) {
    return { ok: false, root, error: `~/.${profile.id}-${clean} already exists` };
  }
  try {
    fs.renameSync(root, newRoot);
    return { ok: true, root: newRoot };
  } catch (e) {
    return { ok: false, root, error: msg(e) };
  }
}
```

- [ ] **Step 4: Thread it through IPC**

`shared/ipc.ts`:

```ts
  /** Create a sibling home `~/.<tool>-<suffix>` for a new account. */
  createAccount(suffix: string, tool: ToolId): Promise<{ ok: boolean; root: string; error?: string }>;
```

`electron/main.ts:1209`:

```ts
ipcMain.handle('setup:createAccount', (_e, suffix: string, tool: ToolId) => {
  const res = createAccountDir(suffix, tool);
```

Update `electron/preload.ts` to forward the extra argument.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run electron/services/__tests__/account-setup.test.ts && npm run typecheck`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/account-setup.ts shared/ipc.ts electron/main.ts electron/preload.ts electron/services/__tests__/account-setup.test.ts
git commit -m "feat: create and rename Codex homes from the accounts view"
```

---

## Task 11: Tool-aware recentSessions

**Files:**
- Modify: `electron/services/cross-account.ts`
- Modify: `electron/main.ts:1180`
- Test: `electron/services/__tests__/cross-account.test.ts`

**Interfaces:**
- Consumes: `toolFor`, `accountRootFor` from Task 1.
- Produces: `recentSessions(sourceDir: string, limit?: number): RecentSession[]` — same signature, now dispatching on the source dir's tool.

For a Codex rollout the id is not the basename and `cwd` lives on the
`session_meta` line, so both of the Claude reader's assumptions are wrong.

- [ ] **Step 1: Write the failing test**

Append to `electron/services/__tests__/cross-account.test.ts`:

```ts
describe('recentSessions — codex rollouts', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-codexsess-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const rollout = (dir: string, id: string, cwd: string, lines = 1) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-08-15T20-44-21-${id}.jsonl`);
    const meta = JSON.stringify({
      type: 'session_meta',
      payload: { session_id: id, cwd, timestamp: '2026-08-15T12:44:21.791Z' },
    });
    fs.writeFileSync(file, [meta, ...Array(lines - 1).fill('{"type":"event_msg"}')].join('\n'));
    return file;
  };

  it('takes the id from session_meta, not the filename', () => {
    const id = '01a00573-ab88-7cc3-ba91-2fe69cc82d3f';
    rollout(path.join(home, '.codex', 'sessions', '2026', '08', '15'), id, '/work/api');

    const found = recentSessions(path.join(home, '.codex', 'sessions'));
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(id);
    expect(found[0].cwd).toBe('/work/api');
    expect(found[0].project).toBe('api');
  });

  it('dedupes an archived copy against the live one, keeping the newer', () => {
    const id = '01a00573-ab88-7cc3-ba91-2fe69cc82d3f';
    const archived = rollout(path.join(home, '.codex', 'archived_sessions', '2026', '08', '15'), id, '/work/api', 2);
    fs.utimesSync(archived, new Date(1000), new Date(1000));
    rollout(path.join(home, '.codex', 'sessions', '2026', '08', '15'), id, '/work/api', 5);

    // both dirs are separate source dirs, but each scan must not double-count
    const live = recentSessions(path.join(home, '.codex', 'sessions'));
    expect(live).toHaveLength(1);
  });

  it('returns nothing for a home with no rollouts', () => {
    fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
    expect(recentSessions(path.join(home, '.codex', 'sessions'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/__tests__/cross-account.test.ts`
Expected: FAIL — the id comes back as the full `rollout-…` basename.

- [ ] **Step 3: Dispatch by tool**

In `electron/services/cross-account.ts`, add the import and split the reader:

```ts
import { toolFor } from '../../shared/tools';
```

Rename the existing body to `claudeSessions(projectsDir, limit)` and add:

```ts
/** First `session_meta` payload in a rollout's head, or null. */
function codexMeta(file: string): { id: string; cwd: string | null } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const d = JSON.parse(t) as { type?: string; payload?: { session_id?: unknown; cwd?: unknown } };
        if (d.type !== 'session_meta') continue;
        const id = d.payload?.session_id;
        if (typeof id !== 'string' || !id) return null;
        return { id, cwd: typeof d.payload?.cwd === 'string' ? d.payload.cwd : null };
      } catch {
        /* truncated trailing line in the 64KB head — ignore */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Codex rollouts: the session id is a UUID INSIDE the filename
 * (`rollout-<ts>-<uuid>.jsonl`), and `cwd` is on the `session_meta` line, so
 * neither of the Claude reader's assumptions holds. Read the id from the file
 * rather than parsing the name — the name's format is not a contract.
 */
function codexSessions(sessionsDir: string, limit: number): RecentSession[] {
  const files: string[] = [];
  walkJsonl(sessionsDir, files);

  const byId = new Map<string, RecentSession>();
  for (const file of files) {
    if (!path.basename(file).startsWith('rollout-')) continue;
    let mtime: number;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const meta = codexMeta(file);
    if (!meta) continue;
    const prev = byId.get(meta.id);
    if (prev && prev.mtime >= mtime) continue;
    const project = meta.cwd
      ? meta.cwd.split(/[\\/]/).filter(Boolean).pop() || meta.cwd
      : path.basename(path.dirname(file));
    byId.set(meta.id, { id: meta.id, cwd: meta.cwd, project, mtime });
  }

  return [...byId.values()].sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(0, limit));
}

/** The most recent resumable sessions under a source dir, newest first. */
export function recentSessions(sourceDir: string, limit = 8): RecentSession[] {
  return toolFor(sourceDir).id === 'codex'
    ? codexSessions(sourceDir, limit)
    : claudeSessions(sourceDir, limit);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/services/__tests__/cross-account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/cross-account.ts electron/services/__tests__/cross-account.test.ts
git commit -m "feat: list resumable Codex sessions from their rollout metadata"
```

---

## Task 12: Accounts view and wizard

**Files:**
- Modify: `src/views/AccountsView.tsx:805-890`
- Modify: `src/views/SettingsView.tsx:685-700`
- Modify: `src/components/accounts/SetupWizard.tsx:104-160, 240-320`
- Modify: `src/views/accounts.css`
- Test: manual, plus `src/lib/__tests__/crossAccount.test.ts` for `effectiveWrapperAccounts`

**Interfaces:**
- Consumes: `accountGroups`, `toolForRoot`, `AccountGroup` from Task 1; `AccountSpec.tool` from Task 6; `createAccount(suffix, tool)` from Task 10.
- Produces: no new exports. `effectiveWrapperAccounts` now stamps `tool` on every spec it returns.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/crossAccount.test.ts`:

```ts
describe('effectiveWrapperAccounts — stamps the tool', () => {
  it('emits one spec per account, not per source dir', () => {
    const specs = effectiveWrapperAccounts(
      [
        '/home/u/.claude/projects',
        '/home/u/.codex/sessions',
        '/home/u/.codex/archived_sessions',
      ],
      {},
    );
    // two accounts, three source dirs — a duplicate codex spec would be a
    // duplicate function name and would fail validation on apply
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.tool)).toEqual(['claude', 'codex']);
    expect(specs.map((s) => s.name)).toEqual(['claude-personal', 'codex-personal']);
  });

  it('honours a saved rename and carries env through', () => {
    const specs = effectiveWrapperAccounts(['/home/u/.codex/sessions'], {
      '/home/u/.codex': { name: 'cx', env: { FOO: 'bar' } },
    });
    expect(specs[0]).toEqual({ tool: 'codex', name: 'cx', root: '/home/u/.codex', env: { FOO: 'bar' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/crossAccount.test.ts -t "stamps the tool"`
Expected: FAIL — three specs come back, two of them a duplicate `codex-personal`.

- [ ] **Step 3: Group in `effectiveWrapperAccounts`**

In `src/lib/crossAccount.ts`, rewrite it over groups:

```ts
export function effectiveWrapperAccounts(
  sourceDirs: string[],
  prefs: Record<string, AccountWrapperPrefs>,
): AccountSpec[] {
  return accountGroups(sourceDirs)
    .filter(({ root }) => !prefs[root]?.disabled)
    .map(({ root, tool }) => {
      const env = prefs[root]?.env;
      return {
        tool: tool.id,
        name: prefs[root]?.name || tool.suggestWrapperName(root),
        root,
        ...(env && Object.keys(env).length ? { env } : {}),
      };
    });
}
```

Import `accountGroups` from `../../shared/tools`.

- [ ] **Step 4: Render one card per account**

In `src/views/AccountsView.tsx`, replace `sourceDirs.map((dir, i) => …)` with a
group map. A group's card is driven by its first source dir (which is what
`accounts`, `limits` and `spend` are keyed by) and carries the tool:

```tsx
{accountGroups(sourceDirs).map((group, i) => (
  <div className={sourceDirs.length === 1 ? 'g12' : 'g6'} key={group.root}>
    <AccountCard
      dir={group.dirs[0]}
      tool={group.tool}
      acct={accounts[group.dirs[0]]}
      limit={limits[group.dirs[0]]}
      spend={spend?.[group.dirs[0]]}
      inScope={group.dirs.some((d) => scopedSet.has(d))}
      …
    />
  </div>
))}
```

Change the section heading, which currently reads "connected claude code
logins", to cover both. Keep it accurate rather than generic — say what is
actually there:

```tsx
<span className="acc-sec-title">
  connected {accountGroups(sourceDirs).some((g) => g.tool.id === 'codex')
    ? 'coding-cli logins'
    : 'claude code logins'}
</span>
```

Give `AccountCard` a tool badge next to the label. Use existing tokens only:

```tsx
<span className="acc-tool-badge">{tool.label}</span>
```

```css
/* accounts.css — a quiet identifier, not a call to action: it says which CLI
   a row belongs to and should never outweigh the account name beside it. */
.acc-tool-badge {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-dim) 12%, transparent);
}
```

Show "no usage limits published" in the Codex card where the limits gauge would
be — an empty gauge reads as "at zero", which is the opposite of "unknown".

- [ ] **Step 5: Group the Settings source list**

In `src/views/SettingsView.tsx:685-700`, the per-source rows must also iterate
`accountGroups(...)` so a Codex home appears once. The scope checkbox for a
group toggles all of its `dirs` together.

- [ ] **Step 6: Wizard — tool selector and Claude-only presets**

In `src/components/accounts/SetupWizard.tsx`:

- `roots` becomes groups: `accountGroups(sourceDirs).filter((g) => !prefs[g.root]?.disabled)`, and the `names`/`envText` maps stay keyed by `group.root`.
- `opts.accounts` stamps `tool: group.tool.id` and seeds the name from `group.tool.suggestWrapperName(group.root)`.
- The `+ env` preset row (around line 288) renders only when `group.tool.id === 'claude'` — `PROVIDER_PRESETS` is a set of `ANTHROPIC_*` variables and means nothing to Codex. The free-form env box stays on both.
- The "new account" control gains a tool select, defaulting to `claude`, passed to `window.ccmon.createAccount(suffix, tool)`.

```tsx
<label className="wiz-tool-select">
  <span>tool</span>
  <select value={newTool} onChange={(e) => setNewTool(e.target.value as ToolId)}>
    {TOOLS.map((t) => (
      <option key={t.id} value={t.id}>{t.label}</option>
    ))}
  </select>
</label>
```

- [ ] **Step 7: Run the suite and typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 8: See it in the real app**

Run: `npm run dev`
Check, with a real `~/.codex` present:
1. The Accounts view shows exactly one Codex card, not two.
2. Its badge reads "Codex CLI" and its identity row shows the plan from `auth.json`.
3. Hiding it removes both source dirs from the totals; unhiding restores them.
4. The wizard previews a `codex-accounts.sh` containing a `codex-personal` wrapper.
5. The advisor view does not offer the Codex account as a login.

- [ ] **Step 9: Commit**

```bash
git add src/ electron/services/__tests__/ 2>/dev/null; git add -u
git commit -m "feat: show Codex accounts as first-class rows in the accounts view and wizard"
```

---

## Task 13: Documentation and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/v2-spec.md`
- Modify: `docs/architecture.md`
- Modify: `docs/analytics-roadmap.md`
- Modify: `README.md` (the `ln -sf` section, if it names `claude-accounts.sh`)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Update `CLAUDE.md`**

In the Map, after the `electron/services/adapters/` entry, add:

```markdown
- `shared/tools.ts` + `electron/services/tools/` — the ACCOUNT-layer twin of
  the adapter seam, joined on id. An adapter owns what is format-specific; a
  `ToolProfile` owns what is install-specific: where the home is
  (`CLAUDE_CONFIG_DIR` vs `CODEX_HOME`), what a wrapper is called, where the
  credentials live. They are separate interfaces on purpose — adapters are
  stateless singletons the CLI imports under plain node, while account setup
  writes shell rc files and reads credential stores, which the CLI never does.
  `shared/tools.ts` is the pure half (importable by the renderer too, which is
  what retired the hand-copied naming helpers in `src/lib/crossAccount.ts`);
  `tools/identity.ts` is the fs half.
```

Add to Gotchas:

```markdown
- **An account is a HOME, not a source dir.** A Codex home contributes two
  source dirs (`sessions`, `archived_sessions`) and is one account, so anything
  rendering one row per account iterates `accountGroups()` rather than
  `sourceDirs`. Root derivation goes through `shared/tools.ts#accountRootFor` —
  the renderer used to strip a trailing `/projects` (a no-op on a Codex dir)
  while `visibleAccountDirs` used `path.dirname`, so the hide-prefs and the
  wizard targeted different roots.
- **Codex identity is read offline from `<home>/auth.json`.** `auth_mode` gives
  the mode; the `tokens.id_token` JWT payload gives email, plan
  (`chatgpt_plan_type`) and org. The signature is NOT verified and must not be:
  ccmon never presents this token to anything, it is display metadata from a
  0600 file in the user's own home. There is NO Codex limits endpoint, so a
  Codex card shows "no usage limits published" — never an empty gauge, which
  reads as zero.
- **Codex accounts must stay out of Anthropic-only paths.** They have
  credentials, but OpenAI ones. `AdvisorView` filters on `tool === 'claude'`
  before `hasCredentials`; without that the advisor spends a request on a token
  the Messages API will reject. The compiler cannot catch this one — it is a
  filter, not a type error.
- **The rc block is REPLACED, not appended.** It sources one file per tool,
  every line `[ -f ]`-guarded, so its content never depends on which accounts
  exist. When Codex support added the second source line, every already-linked
  user would otherwise have kept a block loading only the Claude wrappers, with
  no error to point at. `upsertManagedBlock` swaps the marker-delimited block in
  place and is a no-op when it already matches.
```

Correct the services count in the Map — it currently reads "Twenty-three
services"; recount after adding `tools/identity.ts`.

- [ ] **Step 2: Update `docs/v2-spec.md`**

Add the `ToolProfile` contract, the widened `AccountInfo` (with `tool`,
`authMode`, nullable `cleanupPeriodDays`), `AccountSpec.tool`, and
`SetupPlan.managed[]` / `SetupPlan.helpers[]` to the data-contracts section, and
extend the §7 validation matrix with the account-layer rows.

- [ ] **Step 3: Update `docs/architecture.md`**

Document the two registries and their join, and the decision not to fold tool
concerns into `SourceAdapter`.

- [ ] **Step 4: Update `docs/analytics-roadmap.md`**

Record, so it is not re-proposed:

```markdown
- **Codex usage limits — not possible.** OpenAI publishes no account-usage or
  quota endpoint reachable with a Codex `auth.json` credential, and ccmon's
  pollers are read-only by policy. A Codex card shows plan and identity but no
  gauge. Revisit only if such an endpoint appears.
- **Codex long-context pricing tier — parked.** Codex prices requests above a
  context threshold higher; ccmon's engine is flat per model, so a very long
  Codex turn is priced slightly low. Tokens are unaffected.
```

- [ ] **Step 5: Full verification**

Run each and record the actual output:

```bash
npm run lint
npm run typecheck
npm test
npm run parity -- --fixture
npm run smoke
```

Expected: lint and typecheck clean; the full suite green; parity **0.000%**;
smoke reporting the same entry totals as before the branch, plus any Codex
roots.

- [ ] **Step 6: Verify the packaged CLI still loads**

```bash
npm run build:cli
./dist-cli/index.cjs json --help
```

Expected: help text, no import error. This is what proves `shared/tools.ts` and
`tools/identity.ts` stayed free of Electron.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/ README.md
git commit -m "docs: record the tool registry, Codex identity, and the rc-block replacement"
```

---

## Self-Review Notes

**Spec coverage.** Every numbered section of the design maps to a task: §3.1
registry → Task 1; §3.2 grouping → Tasks 1 and 12; §4 discovery → Task 3; §5
identity → Tasks 4 and 5; §6.1–6.2 managed files and rc block → Tasks 6 and 7;
§6.3 wrappers → Task 6; §6.4 pair partitioning → Task 6; §7 helper → Tasks 8
and 9; §8 create/rename → Task 10; §9 `recentSessions` → Task 11; §10 testing →
distributed across every task; §11 docs → Task 13.

**Sequencing note.** Tasks 8 and 9 both edit `helperScript` in
`account-setup.ts`; Task 8 leaves it referencing a constant Task 9 defines. If
executing sequentially with a review gate between them, land them as one
commit rather than leaving the tree un-typecheckable between the two.

**Risk carried from the spec.** Task 7 rewrites a region of the user's shell rc.
It is marker-delimited, atomic (`writeAtomic`), idempotent, and previewed — but
it is the one step in this plan that edits a file ccmon did not create. Test it
before shipping it.
