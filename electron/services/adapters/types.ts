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
   * Fresh per-file parse state, for formats whose lines are not
   * self-describing. Omit it when every line stands alone.
   *
   * Claude Code needs nothing here: a transcript line carries its own model,
   * timestamp and token split. Codex does not — the model arrives on an
   * earlier `turn_context` line and the speed tier on an earlier
   * `thread_settings_applied`, so a usage line read in isolation cannot be
   * priced. That second format is what proved this hook necessary; it was not
   * designed in advance.
   *
   * The WATCHER owns the lifetime: one state per file, created on first use,
   * carried across incremental tails, dropped on rescan. An adapter must never
   * keep this in module scope — `ADAPTERS` holds singletons shared by the app
   * and the CLI, so two watchers would corrupt each other's parse.
   */
  createState?(): unknown;

  /**
   * Byte-level reject for a line that cannot possibly carry data, applied by
   * the watcher BEFORE the line is decoded to a string.
   *
   * This is the single hottest decision in the whole pipeline: read-and-parse
   * is ~97% of scan time, and most lines in a transcript are prose, thinking
   * blocks or system chatter that can never produce a result. Answering "no"
   * here skips a UTF-8 decode, a string allocation and a `JSON.parse` — the
   * same trick ccusage plays with its SIMD `memmem` prefilter.
   * `Buffer.indexOf` is a native memmem, so this stays off the JS heap.
   *
   * MUST NOT produce false negatives: returning false for a line that
   * `parseLine` would have accepted silently loses usage. False positives only
   * cost the parse that would have happened anyway. Omit it entirely and every
   * line gets decoded, which is merely slower.
   *
   * Declaring this is also a contract in the other direction: `parseLine` will
   * only ever be called with lines that passed, so it need not re-check them.
   */
  mayCarryData?(line: Buffer): boolean;

  /**
   * Parse one line. Returns an entry, a marker, or null for anything that
   * carries no usage. Must not throw on malformed input — a corrupt line is
   * normal in a file being appended to concurrently.
   *
   * `state` is whatever {@link createState} returned for this file, or
   * undefined for adapters that declared none. Lines arrive in file order, so
   * a stateful adapter may rely on having seen everything before them.
   */
  parseLine(raw: string, file: string, lineNo: number, zone: Zone, state?: unknown): ParsedLine;
}

/** One data root paired with the adapter that understands it. */
export interface SourceRoot {
  dir: string;
  adapter: SourceAdapter;
}
