/**
 * @file index.ts
 * @brief Source-adapter registry and root discovery.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import type { SourceAdapter, SourceRoot } from './types';

export type { SourceAdapter, SourceRoot } from './types';
export { claudeAdapter } from './claude';
export { codexAdapter } from './codex';

/**
 * Every adapter ccmon knows, in precedence order.
 *
 * Claude Code first because it is the format ccmon was built around and the
 * one `npm run parity` pins. Codex second — it is what proved the seam:
 * fitting it required adding per-file parse state to `SourceAdapter`, which no
 * amount of designing against a single format would have surfaced.
 *
 * Adding one here is what makes it discoverable; nothing else needs to change
 * in the watcher or the aggregator.
 */
export const ADAPTERS: SourceAdapter[] = [claudeAdapter, codexAdapter];

/** Look up an adapter by its stable id. */
export function adapterById(id: string): SourceAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

/**
 * Every data root present on this machine, each tagged with its adapter.
 *
 * `extra` is keyed BY ADAPTER ID. Handing every adapter the same list was a
 * latent bug: a user's `claudeDirs` entry was probed as a Codex home, so a
 * Claude root that happened to hold a `sessions/` dir would be claimed by the
 * wrong parser. Adapters that find nothing contribute nothing — a tool that
 * isn't installed is the normal case, not a failure.
 */
export function detectSourceRoots(extra: Partial<Record<string, string[]>> = {}): SourceRoot[] {
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
