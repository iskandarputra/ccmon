/**
 * @file cross-account.test.ts
 * @brief Unit tests for recent-session discovery (cross-account resume material).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('recentSessions — codex rollouts', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-codexsess-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  /** A rollout at its real date-nested path, with `extra` filler lines. */
  const rollout = (base: string, id: string, cwd: string | null, extra = 0): string => {
    const dir = path.join(home, '.codex', base, '2026', '08', '15');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-08-15T20-44-21-${id}.jsonl`);
    const meta = JSON.stringify({
      type: 'session_meta',
      payload: { session_id: id, cwd, timestamp: '2026-08-15T12:44:21.791Z' },
    });
    const lines = [meta, ...Array.from({ length: extra }, () => '{"type":"event_msg"}')];
    fs.writeFileSync(file, lines.join('\n'));
    return file;
  };

  const sessionsDir = () => path.join(home, '.codex', 'sessions');

  it('takes the id from session_meta, not the filename', () => {
    // The filename embeds the uuid after a timestamp, so basename() — what the
    // Claude reader uses — would yield `rollout-2026-08-15T20-44-21-<uuid>`.
    const id = '01a00573-ab88-7cc3-ba91-2fe69cc82d3f';
    rollout('sessions', id, '/work/api');

    const found = recentSessions(sessionsDir());
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(id);
    expect(found[0].cwd).toBe('/work/api');
    expect(found[0].project).toBe('api');
  });

  it('reads the id even when the rollout carries no cwd', () => {
    rollout('sessions', 'no-cwd-here', null);
    const found = recentSessions(sessionsDir());
    expect(found[0].id).toBe('no-cwd-here');
    expect(found[0].cwd).toBeNull();
  });

  it('sorts newest first and honours the limit', () => {
    const a = rollout('sessions', 'aaa', '/work/a');
    const b = rollout('sessions', 'bbb', '/work/b');
    fs.utimesSync(a, new Date(1_000_000), new Date(1_000_000));
    fs.utimesSync(b, new Date(2_000_000), new Date(2_000_000));

    expect(recentSessions(sessionsDir()).map((s) => s.id)).toEqual(['bbb', 'aaa']);
    expect(recentSessions(sessionsDir(), 1).map((s) => s.id)).toEqual(['bbb']);
  });

  it('ignores files that are not rollouts', () => {
    rollout('sessions', 'real-one', '/work/api'); // creates the dir tree
    fs.writeFileSync(path.join(sessionsDir(), 'history.jsonl'), '{"x":1}\n');
    expect(recentSessions(sessionsDir()).map((s) => s.id)).toEqual(['real-one']);
  });

  it('dedupes an archived copy against the live one, keeping the newer', () => {
    // archived_sessions is scanned as its own source dir, but a single scan
    // must not double-count a session it finds twice.
    const id = 'dup-me';
    const archived = rollout('archived_sessions', id, '/work/api', 1);
    fs.utimesSync(archived, new Date(1_000_000), new Date(1_000_000));
    const live = rollout('sessions', id, '/work/api', 4);
    fs.utimesSync(live, new Date(2_000_000), new Date(2_000_000));

    expect(recentSessions(sessionsDir())).toHaveLength(1);
    expect(recentSessions(path.join(home, '.codex', 'archived_sessions'))).toHaveLength(1);
  });

  it('returns nothing for a home with no rollouts', () => {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    expect(recentSessions(sessionsDir())).toEqual([]);
  });
});
