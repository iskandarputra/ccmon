/**
 * @file useScopedDirs.ts
 * @brief The source dirs the current snapshot is scoped to (renderer mirror of main's sourceScope).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useMemo } from 'react';
import { useUsageStore } from '../store/useUsageStore';
import { scopedDirs } from '../lib/limits';

/**
 * The account source dirs the current snapshot is built from — used to keep
 * the overview's binding limit windows aligned with the usage on screen now
 * that live limits are polled for every account regardless of scope.
 */
export function useScopedDirs(): string[] {
  const sources = useUsageStore((s) => s.settings?.sources ?? null);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  return useMemo(() => scopedDirs(sources, sourceDirs), [sources, sourceDirs]);
}
