/**
 * @file pricing-archive.ts
 * @brief Date-stamped pricing layers enabling rates-of-the-day historical costing.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import type { LitellmEntry } from '../../shared/types';

type Catalog = Record<string, LitellmEntry>;

interface ArchiveLayer {
  /** local 'YYYY-MM-DD' the layer became current */
  since: string;
  models: Catalog;
}

interface ArchiveFile {
  layers: ArchiveLayer[];
}

const ARCHIVE_FILE = 'pricing-archive.json';

/**
 * Date-stamped pricing layers (docs/v2-spec.md §2). Every successful LiteLLM
 * refresh records the compacted catalog under the local date — but only when
 * it differs from the newest layer, so the file grows only when prices
 * actually change. Entries then cost at the rates of their day via
 * engine.costAt; days BEFORE the first layer fall back to current rates,
 * since past prices can't be fetched retroactively — the archive builds
 * forward from the first run. Pure Node, no Electron imports.
 */
export class PricingArchive {
  private readonly file: string;
  private layers: ArchiveLayer[] = [];

  constructor(cacheDir: string) {
    this.file = path.join(cacheDir, ARCHIVE_FILE);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as ArchiveFile;
      if (Array.isArray(raw?.layers)) {
        this.layers = raw.layers.filter(
          (l) => l && typeof l.since === 'string' && l.models && typeof l.models === 'object',
        );
        this.layers.sort((a, b) => (a.since < b.since ? -1 : 1));
      }
    } catch {
      /* no archive yet — first refresh creates it */
    }
  }

  /**
   * Record today's catalog. Appends a layer (or updates today's) only when
   * the table differs from the newest layer. Returns true when changed.
   */
  record(dateKey: string, models: Catalog): boolean {
    const last = this.layers[this.layers.length - 1];
    if (last && JSON.stringify(last.models) === JSON.stringify(models)) return false;
    if (last && last.since === dateKey) last.models = models;
    else this.layers.push({ since: dateKey, models });
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ layers: this.layers } satisfies ArchiveFile));
    } catch {
      /* persistence is best-effort; the in-memory layers still apply */
    }
    return true;
  }

  /** Newest layer with since ≤ dateKey, or null (date precedes all knowledge). */
  layerFor(dateKey: string): { idx: number; models: Catalog } | null {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      if (this.layers[i].since <= dateKey) return { idx: i, models: this.layers[i].models };
    }
    return null;
  }

  get size(): number {
    return this.layers.length;
  }
}
