/**
 * @file scope.ts
 * @brief Which source roots and entries the app is currently looking at — pure.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * These four decisions used to live inside `electron/main.ts`, where nothing
 * could reach them: main imports Electron, so a unit test cannot load it, and
 * the rules encoded here are exactly the kind that go quietly wrong.
 * `status-text.ts` is the same idea for the tray strings.
 *
 * The rule that most needs pinning is the one in {@link resolveSourceScope}:
 * "all accounts" must NOT collapse to `null` (meaning "don't filter") while an
 * account is hidden, or hidden entries walk back into the snapshot through the
 * side door. That is a two-line condition and a silent data leak if inverted.
 */

import type { UsageEntry } from '../../shared/types';

/**
 * The default account: the standard `~/.claude/projects` root when present,
 * else the first detected one. Multi-account users get their primary rather
 * than an arbitrary union until they choose otherwise.
 */
export function primaryDir(sourceDirs: readonly string[]): string | null {
  return sourceDirs.find((d) => /[\\/]\.claude[\\/]projects$/.test(d)) || sourceDirs[0] || null;
}

export interface ScopeInput {
  /** roots the user can see (detected minus hidden) */
  visible: readonly string[];
  /** every detected root, hidden ones included */
  all: readonly string[];
  /** `settings.sources`, or null when the user has never chosen */
  selected: readonly string[] | null;
}

/**
 * Active data scope as a set of root paths, or null for "no filtering at all".
 *
 * Three rules, in order:
 *
 *   1. An explicit selection wins, narrowed to roots that still exist — a
 *      renamed or removed account must not filter the app down to nothing.
 *   2. With no selection and more than one root, default to the PRIMARY
 *      account. Extra roots like `~/.claude-work` are opt-in; silently
 *      summing every account would misreport spend for anyone who keeps work
 *      and personal separate.
 *   3. Otherwise "everything" — which is `null` only when nothing is hidden.
 *      With anything hidden, "everything" has to be the explicit visible set,
 *      because `null` means "skip the filter" downstream.
 */
export function resolveSourceScope({ visible, all, selected }: ScopeInput): Set<string> | null {
  const everything = visible.length < all.length ? new Set(visible) : null;

  // Not `Array.isArray`: it narrows a `readonly string[]` to `any[]`, which
  // silently drops the element type this function then indexes with.
  if (selected && selected.length) {
    const live = selected.filter((d) => visible.includes(d));
    if (live.length === visible.length) return everything; // explicit "all"
    if (live.length) return new Set(live);
    // every selected root is gone — fall through to the default
  }

  if (visible.length > 1) {
    const p = primaryDir(visible);
    if (p) return new Set([p]);
  }
  return everything;
}

/**
 * Entries belonging to visible accounts. Hidden accounts are out of the app
 * entirely, not merely unselected, so this is applied before the scope filter.
 *
 * Returns the original array untouched when nothing is hidden — the common
 * case, and this runs on every recompute over the whole entry list.
 */
export function visibleEntries(
  entries: UsageEntry[],
  visible: readonly string[],
  all: readonly string[],
): UsageEntry[] {
  if (visible.length === all.length) return entries;
  const set = new Set(visible);
  return entries.filter((e) => set.has(e.source ?? ''));
}

/**
 * Did the visible root list actually change?
 *
 * NUL separator, not a space: a project path may contain spaces but never a
 * NUL, so this cannot report "unchanged" for two genuinely different lists.
 */
export function dirsChanged(a: readonly string[], b: readonly string[]): boolean {
  return a.join('\0') !== b.join('\0');
}
