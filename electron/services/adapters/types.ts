/**
 * @file types.ts
 * @brief The source-adapter seam — what a coding-CLI data format must provide.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * ccmon reads Claude Code transcripts. Other coding CLIs write their own local
 * usage logs, and this is the boundary that lets one be added without touching
 * the tailer, the dedupe, the pricing engine or the aggregator.
 *
 * The split is deliberate. An adapter owns everything FORMAT-specific:
 *   - where the tool keeps its data
 *   - which files in there carry usage
 *   - how one line becomes an entry or a marker
 *
 * The watcher owns everything format-INdependent: byte offsets and incremental
 * tailing, the best-wins dedupe, marker collection, and the file→root mapping.
 *
 * Interface validated against a second real format before being committed to:
 * Gemini CLI writes `~/.gemini/tmp/<hash>/chats/session-*.jsonl` with
 * `{type, model, timestamp, tokens: {input, output, cached, thoughts, tool,
 * total}}`, which fits `detectRoots` + `files` + `parseLine` without change.
 */

import type { Zone } from '../../../shared/daykey';
import type { ParsedLine } from '../../../shared/types';

export interface SourceAdapter {
  /** Stable machine id, stamped onto every entry as `agent` (e.g. 'claude'). */
  readonly id: string;
  /** Human label for the UI (e.g. 'Claude Code'). */
  readonly label: string;

  /**
   * Data roots this adapter can read, in precedence order. Returns [] when the
   * tool isn't installed — absence is normal, never an error. `extra` carries
   * user-configured roots for adapters that support them.
   */
  detectRoots(extra?: string[]): string[];

  /**
   * Does this filename carry usage for this adapter? Called during the
   * directory walk, so it must be a cheap path test — no IO.
   *
   * Exists because "every .jsonl under the root" is not universal: some tools
   * keep prompt history, logs and usage side by side in one tree.
   */
  owns(file: string): boolean;

  /**
   * Parse one line. Returns an entry, a marker, or null for anything that
   * carries no usage. Must not throw on malformed input — a corrupt line is
   * normal in a file being appended to concurrently.
   */
  parseLine(raw: string, file: string, lineNo: number, zone: Zone): ParsedLine;
}

/** One data root paired with the adapter that understands it. */
export interface SourceRoot {
  dir: string;
  adapter: SourceAdapter;
}
