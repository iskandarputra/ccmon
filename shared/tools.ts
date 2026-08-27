/**
 * @file tools.ts
 * @brief Coding-CLI tool registry — what an "account" means per tool, pure half.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * The tool registry is the ACCOUNT-layer twin of `ADAPTERS`
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
 * This file is the PURE half — no `fs`, no `os`, no `path` — so the renderer,
 * the main process and the CLI can all import it. The filesystem half is
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
export const toolById = (id: string): ToolProfile => TOOLS.find((t) => t.id === id) ?? claudeTool;

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
 * The profile owning an account ROOT (as opposed to a source dir), matched on
 * the home's own basename: `~/.codex-work` → codex. Claude is the fallback,
 * which is also correct for a custom root configured via `claudeDirs`.
 */
export const toolForRoot = (root: string): ToolProfile => {
  const base = basename(root);
  return TOOLS.find((t) => base === `.${t.id}` || base.startsWith(`.${t.id}-`)) ?? claudeTool;
};

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
