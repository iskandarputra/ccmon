/**
 * @file transcript-cache.ts
 * @brief Persistent disk cache for transcript entries and file metadata.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Saves indexed transcripts across restarts so startup drops from ~15s to <50ms.
 * Degrades gracefully on corruption or missing files.
 */

import fs from 'fs';
import path from 'path';
import type { CompactMarker, LimitsMarker, UsageEntry } from '../../shared/types';

const fsp = fs.promises;
export const CACHE_VERSION = 2;

export interface CachedFileMeta {
  mtimeMs: number;
  size: number;
}

export interface ToolResultSummary {
  source: string;
  day: string;
  count: number;
  chars: number;
}

export interface CachedIndex {
  version: number;
  savedAt: number;
  files: Record<string, CachedFileMeta>;
  entries: UsageEntry[];
  compactions: CompactMarker[];
  toolResults: ToolResultSummary[];
  limits: LimitsMarker[];
  resetTs: number | null;
}

export async function loadTranscriptCache(cachePath: string): Promise<CachedIndex | null> {
  try {
    const raw = await fsp.readFile(cachePath, 'utf8');
    const data = JSON.parse(raw) as CachedIndex;
    if (data.version !== CACHE_VERSION || !Array.isArray(data.entries) || !data.files) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function saveTranscriptCache(
  cachePath: string,
  data: Omit<CachedIndex, 'version' | 'savedAt'>,
): Promise<void> {
  try {
    const dir = path.dirname(cachePath);
    await fsp.mkdir(dir, { recursive: true });
    const payload: CachedIndex = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      ...data,
    };
    const tmp = `${cachePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload), 'utf8');
    await fsp.rename(tmp, cachePath);
  } catch (err) {
    // Non-fatal if cache write fails (e.g. disk full / read-only dir)
    console.error('[ccmon] failed to persist transcript cache:', err);
  }
}
