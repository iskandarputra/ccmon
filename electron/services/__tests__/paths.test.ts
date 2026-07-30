/**
 * @file paths.test.ts
 * @brief Unit tests for data-root discovery — path lists, ~ expansion, dedupe.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { candidateRoots, detectProjectDirs, expandHome, splitPathList } from '../paths';

describe('expandHome', () => {
  it('expands a bare ~ and a leading ~/ to the home directory', () => {
    const home = os.homedir();
    expect(expandHome('~')).toBe(home);
    expect(expandHome('~/.claude')).toBe(path.join(home, '.claude'));
  });

  it('leaves absolute paths and mid-string tildes alone', () => {
    expect(expandHome('/srv/claude')).toBe('/srv/claude');
    expect(expandHome('/srv/~backup/claude')).toBe('/srv/~backup/claude');
  });
});

describe('splitPathList', () => {
  it('splits a comma-separated list and trims each entry', () => {
    expect(splitPathList('/a/one, /a/two ,/a/three')).toEqual(['/a/one', '/a/two', '/a/three']);
  });

  it('treats a single path as a list of one', () => {
    expect(splitPathList('/only/one')).toEqual(['/only/one']);
  });

  it('drops empty entries from stray or trailing commas', () => {
    expect(splitPathList('/a/one,,/a/two,')).toEqual(['/a/one', '/a/two']);
    expect(splitPathList(' , ')).toEqual([]);
  });

  it('returns an empty list for unset values', () => {
    expect(splitPathList(undefined)).toEqual([]);
    expect(splitPathList(null)).toEqual([]);
    expect(splitPathList('')).toEqual([]);
  });

  it('expands ~ in every entry', () => {
    const home = os.homedir();
    expect(splitPathList('~/.claude,~/.claude-work')).toEqual([
      path.join(home, '.claude'),
      path.join(home, '.claude-work'),
    ]);
  });
});

describe('candidateRoots — CLAUDE_CONFIG_DIR', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });

  it('yields every entry of a comma-separated list, in order, before the defaults', () => {
    process.env.CLAUDE_CONFIG_DIR = '/srv/claude-a,/srv/claude-b';
    const roots = candidateRoots();
    expect(roots.slice(0, 2)).toEqual(['/srv/claude-a', '/srv/claude-b']);
    // the standard roots still follow
    expect(roots).toContain(path.join(os.homedir(), '.claude'));
    expect(roots).toContain(path.join(os.homedir(), '.config', 'claude'));
  });

  it('still handles the single-path form', () => {
    process.env.CLAUDE_CONFIG_DIR = '/srv/claude-only';
    expect(candidateRoots()[0]).toBe('/srv/claude-only');
  });

  it('contributes nothing when unset or blank', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(candidateRoots()[0]).toBe(path.join(os.homedir(), '.claude'));
    process.env.CLAUDE_CONFIG_DIR = '   ';
    expect(candidateRoots()[0]).toBe(path.join(os.homedir(), '.claude'));
  });
});

describe('detectProjectDirs', () => {
  let tmp: string;
  const saved = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-paths-'));
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Build `<tmp>/<name>/projects` and return the root path. */
  const mkRoot = (name: string): string => {
    const root = path.join(tmp, name);
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    return root;
  };

  it('resolves every root in a comma-separated CLAUDE_CONFIG_DIR', () => {
    const a = mkRoot('a');
    const b = mkRoot('b');
    process.env.CLAUDE_CONFIG_DIR = `${a},${b}`;
    const dirs = detectProjectDirs();
    expect(dirs).toContain(path.join(a, 'projects'));
    expect(dirs).toContain(path.join(b, 'projects'));
  });

  it('is the regression guard: a list must not resolve to one bogus joined path', () => {
    const a = mkRoot('a');
    const b = mkRoot('b');
    process.env.CLAUDE_CONFIG_DIR = `${a},${b}`;
    // The old behaviour pushed the raw value, producing "<a>,<b>/projects",
    // which does not exist — so BOTH real roots silently vanished.
    expect(detectProjectDirs()).not.toContain(path.join(`${a},${b}`, 'projects'));
    expect(detectProjectDirs().length).toBeGreaterThanOrEqual(2);
  });

  it('skips entries that do not exist without dropping the ones that do', () => {
    const a = mkRoot('a');
    process.env.CLAUDE_CONFIG_DIR = `${a},${path.join(tmp, 'nope')}`;
    expect(detectProjectDirs()).toContain(path.join(a, 'projects'));
  });

  it('accepts a root given as its projects/ dir, and dedupes the two spellings', () => {
    const a = mkRoot('a');
    process.env.CLAUDE_CONFIG_DIR = `${a},${path.join(a, 'projects')}`;
    const hits = detectProjectDirs().filter((d) => d === path.join(a, 'projects'));
    expect(hits).toHaveLength(1);
  });

  it('expands ~ in extra dirs from the user config', () => {
    const root = mkRoot('home-ish');
    vi.spyOn(os, 'homedir').mockReturnValue(root);
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(detectProjectDirs(['~'])).toContain(path.join(root, 'projects'));
  });

  it('puts extra dirs ahead of the detected roots', () => {
    const extra = mkRoot('extra');
    const env = mkRoot('env');
    process.env.CLAUDE_CONFIG_DIR = env;
    expect(detectProjectDirs([extra])[0]).toBe(path.join(extra, 'projects'));
  });
});
