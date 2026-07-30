/**
 * @file index.ts
 * @brief Source-adapter registry and root discovery.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { claudeAdapter } from './claude';
import type { SourceAdapter, SourceRoot } from './types';

export type { SourceAdapter, SourceRoot } from './types';
export { claudeAdapter } from './claude';

/**
 * Every adapter ccmon knows, in precedence order.
 *
 * Claude Code is first and, for now, alone: it is the only format whose data
 * this build reads. Adding one here is what makes it discoverable — nothing
 * else needs to change in the watcher or the aggregator.
 */
export const ADAPTERS: SourceAdapter[] = [claudeAdapter];

/** Look up an adapter by its stable id. */
export function adapterById(id: string): SourceAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

/**
 * Every data root present on this machine, each tagged with its adapter.
 * Adapters that find nothing contribute nothing — a tool that isn't installed
 * is the normal case, not a failure.
 */
export function detectSourceRoots(extra: string[] = []): SourceRoot[] {
  const roots: SourceRoot[] = [];
  const seen = new Set<string>();
  for (const adapter of ADAPTERS) {
    for (const dir of adapter.detectRoots(extra)) {
      if (seen.has(dir)) continue; // first adapter to claim a dir owns it
      seen.add(dir);
      roots.push({ dir, adapter });
    }
  }
  return roots;
}
