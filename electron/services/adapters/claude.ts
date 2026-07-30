/**
 * @file claude.ts
 * @brief Claude Code source adapter — the format ccmon was built around.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * A thin binding of the existing discovery and parser behind the adapter seam.
 * The logic is unchanged on purpose: `npm run parity` compares this path against
 * ccusage at 0.000% drift, so the refactor had to be behaviour-preserving.
 */

import { detectProjectDirs } from '../paths';
import { parseLine } from '../parser';
import type { Zone } from '../../../shared/daykey';
import type { ParsedLine } from '../../../shared/types';
import type { SourceAdapter } from './types';

export const claudeAdapter: SourceAdapter = {
  id: 'claude',
  label: 'Claude Code',

  detectRoots(extra: string[] = []): string[] {
    return detectProjectDirs(extra);
  },

  // Every .jsonl under a projects/ root is a transcript. The tree is not flat —
  // subagent and workflow transcripts nest several levels deep and all carry
  // billable usage — so this stays a suffix test rather than a depth rule.
  owns(file: string): boolean {
    return file.endsWith('.jsonl');
  },

  parseLine(raw: string, file: string, lineNo: number, zone: Zone): ParsedLine {
    return parseLine(raw, file, lineNo, zone);
  },
};
