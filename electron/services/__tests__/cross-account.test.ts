/**
 * @file cross-account.test.ts
 * @brief Unit tests for recent-session discovery (cross-account resume material).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { recentSessions } from '../cross-account';

let root: string;
let projects: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-xacc-'));
  projects = path.join(root, 'projects');
  const proj = path.join(projects, '-home-isz-work-alpha');
  const nested = path.join(proj, 'subagents'); // transcripts nest — must still be found
  fs.mkdirSync(nested, { recursive: true });

  const write = (dir: string, id: string, cwd: string | null, mtimeSec: number) => {
    const lines = [
      JSON.stringify({ type: 'summary' }), // a head line without cwd
      JSON.stringify(cwd ? { type: 'user', cwd, sessionId: id } : { type: 'user', sessionId: id }),
    ];
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fs.utimesSync(file, mtimeSec, mtimeSec);
  };

  write(proj, 'aaaa', '/home/isz/work/alpha', 1000);
  write(proj, 'bbbb', '/home/isz/work/beta', 2000);
  write(proj, 'cccc', null, 1500); // no cwd in the head
  write(nested, 'dddd', '/home/isz/work/alpha', 1800); // nested one level deeper
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('recentSessions', () => {
  it('returns sessions newest-first with cwd + project label', () => {
    const rows = recentSessions(projects);
    expect(rows.map((r) => r.id)).toEqual(['bbbb', 'dddd', 'cccc', 'aaaa']);
    const beta = rows.find((r) => r.id === 'bbbb')!;
    expect(beta.cwd).toBe('/home/isz/work/beta');
    expect(beta.project).toBe('beta');
  });

  it('keeps a session whose head carries no cwd (cwd null, project from dir name)', () => {
    const c = recentSessions(projects).find((r) => r.id === 'cccc')!;
    expect(c.cwd).toBeNull();
    expect(c.project).toBe('-home-isz-work-alpha');
  });

  it('finds nested (subagent) transcripts recursively', () => {
    expect(recentSessions(projects).some((r) => r.id === 'dddd')).toBe(true);
  });

  it('respects the limit (newest only)', () => {
    expect(recentSessions(projects, 1).map((r) => r.id)).toEqual(['bbbb']);
  });

  it('returns [] for a missing dir', () => {
    expect(recentSessions(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});
