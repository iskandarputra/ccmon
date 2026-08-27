/**
 * @file tools.test.ts
 * @brief Unit tests for the pure tool registry — root derivation, naming, grouping.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  accountGroups,
  accountRootFor,
  toolById,
  toolFor,
  toolForRoot,
} from '../../../shared/tools';
import { ADAPTERS } from '../adapters';

describe('toolFor — source dir → profile', () => {
  it('maps a Claude projects dir to the claude profile', () => {
    expect(toolFor('/home/u/.claude/projects').id).toBe('claude');
    expect(toolFor('/home/u/.claude-work/projects').id).toBe('claude');
  });

  it('maps both Codex data dirs to the codex profile', () => {
    expect(toolFor('/home/u/.codex/sessions').id).toBe('codex');
    expect(toolFor('/home/u/.codex/archived_sessions').id).toBe('codex');
  });

  it('falls back to claude for an unrecognised dir rather than throwing', () => {
    // detectSourceRoots can only produce known data dirs, but a hand-edited
    // settings.json can carry a stale path — a crash there would take the
    // whole accounts view down.
    expect(toolFor('/home/u/somewhere/else').id).toBe('claude');
  });

  it('uses Windows separators too', () => {
    expect(toolFor('C:\\Users\\u\\.codex\\sessions').id).toBe('codex');
  });
});

describe('accountRootFor — source dir → account root', () => {
  it('strips the Claude projects segment', () => {
    expect(accountRootFor('/home/u/.claude/projects')).toBe('/home/u/.claude');
  });

  it('collapses both Codex data dirs onto one home', () => {
    expect(accountRootFor('/home/u/.codex/sessions')).toBe('/home/u/.codex');
    expect(accountRootFor('/home/u/.codex/archived_sessions')).toBe('/home/u/.codex');
  });

  it('leaves a path that is not a known data dir alone', () => {
    // A custom root from `claudeDirs` may point straight at a projects dir or
    // at something else entirely; only a recognised data dir gets stripped.
    expect(accountRootFor('/mnt/archive/old')).toBe('/mnt/archive/old');
  });
});

describe('suggestWrapperName', () => {
  it('names the default roots "-personal"', () => {
    expect(toolById('claude').suggestWrapperName('/home/u/.claude')).toBe('claude-personal');
    expect(toolById('codex').suggestWrapperName('/home/u/.codex')).toBe('codex-personal');
  });

  it('carries a sibling suffix through', () => {
    expect(toolById('claude').suggestWrapperName('/home/u/.claude-work')).toBe('claude-work');
    expect(toolById('codex').suggestWrapperName('/home/u/.codex-work')).toBe('codex-work');
  });

  it('falls back to "-account" when the suffix strips to nothing', () => {
    expect(toolById('codex').suggestWrapperName('/home/u/.codex-')).toBe('codex-account');
  });
});

describe('isDefaultRoot', () => {
  it('is true only for the bare home each CLI falls back to', () => {
    expect(toolById('claude').isDefaultRoot('/home/u/.claude')).toBe(true);
    expect(toolById('claude').isDefaultRoot('/home/u/.claude-work')).toBe(false);
    expect(toolById('codex').isDefaultRoot('/home/u/.codex')).toBe(true);
    expect(toolById('codex').isDefaultRoot('/home/u/.codex-work')).toBe(false);
  });
});

describe('toolForRoot — account root → profile', () => {
  it('matches a bare home and a suffixed sibling', () => {
    expect(toolForRoot('/home/u/.codex').id).toBe('codex');
    expect(toolForRoot('/home/u/.codex-work').id).toBe('codex');
    expect(toolForRoot('/home/u/.claude-work').id).toBe('claude');
  });

  it('falls back to claude for a custom root from claudeDirs', () => {
    expect(toolForRoot('/mnt/archive/old-transcripts').id).toBe('claude');
  });
});

describe('accountGroups', () => {
  it("collapses a Codex home's two dirs into one group, ordered as given", () => {
    const groups = accountGroups([
      '/home/u/.claude/projects',
      '/home/u/.codex/sessions',
      '/home/u/.codex/archived_sessions',
      '/home/u/.claude-work/projects',
    ]);
    expect(groups.map((g) => g.root)).toEqual([
      '/home/u/.claude',
      '/home/u/.codex',
      '/home/u/.claude-work',
    ]);
    expect(groups[1].dirs).toEqual(['/home/u/.codex/sessions', '/home/u/.codex/archived_sessions']);
    expect(groups[1].tool.id).toBe('codex');
  });

  it('keeps two Claude roots apart', () => {
    const groups = accountGroups(['/home/u/.claude/projects', '/home/u/.claude-work/projects']);
    expect(groups).toHaveLength(2);
  });

  it('returns nothing for no dirs', () => {
    expect(accountGroups([])).toEqual([]);
  });
});

describe('registry drift', () => {
  it('every source adapter has a matching tool profile', () => {
    // A new adapter without a profile leaves its accounts with no label and
    // no wrapper — silently. This is the guard against that.
    for (const adapter of ADAPTERS) {
      expect(TOOLS.map((t) => t.id)).toContain(adapter.id);
    }
  });
});
