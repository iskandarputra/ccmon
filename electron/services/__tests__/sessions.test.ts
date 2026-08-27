/**
 * @file sessions.test.ts
 * @brief Unit tests for live coding-CLI session detection, per account.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { liveSessions } from '../tools/sessions';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-sessions-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/** This test process is, by construction, alive. */
const SELF = process.pid;

/** A pid that is almost certainly dead — 2^22 is above every default pid_max. */
const DEAD = 4_194_303;

function claudeRoot(name = '.claude-work'): string {
  const root = path.join(home, name);
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  return root;
}

const writeSession = (root: string, pid: number, extra: Record<string, unknown> = {}) =>
  fs.writeFileSync(
    path.join(root, 'sessions', `${pid}.json`),
    JSON.stringify({ pid, sessionId: `s-${pid}`, cwd: '/w/api', kind: 'interactive', ...extra }),
  );

describe('Claude sessions — the tool keeps its own registry', () => {
  it('reports a session whose process is alive', () => {
    const root = claudeRoot();
    writeSession(root, SELF, { status: 'busy', name: 'api' });

    const live = liveSessions(root);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: `s-${SELF}`, cwd: '/w/api', status: 'busy', label: 'api' });
  });

  it('drops a record whose process is gone', () => {
    const root = claudeRoot();
    writeSession(root, DEAD);
    expect(liveSessions(root)).toEqual([]);
  });

  it('drops a REUSED pid rather than reporting a dead session as running', () => {
    // The subtle one. The pid is alive (it is us), but the recorded start time
    // belongs to a process that exited long ago and whose number came around
    // again. Without the procStart check this reads as a running session.
    const root = claudeRoot();
    writeSession(root, SELF, { procStart: '1' });
    const live = liveSessions(root);
    if (process.platform === 'linux') {
      expect(live).toEqual([]);
    } else {
      // /proc is Linux-only; elsewhere liveness is the pid probe alone and a
      // reused pid cannot be distinguished. Documented, not silently wrong.
      expect(live).toHaveLength(1);
    }
  });

  it('accepts a live pid whose recorded start time matches', () => {
    const root = claudeRoot();
    if (process.platform !== 'linux') return;
    const stat = fs.readFileSync(`/proc/${SELF}/stat`, 'utf8');
    const procStart = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    writeSession(root, SELF, { procStart });
    expect(liveSessions(root)).toHaveLength(1);
  });

  it('ignores the .key files that sit beside the registry', () => {
    const root = claudeRoot();
    writeSession(root, SELF);
    fs.writeFileSync(path.join(root, 'sessions', `${SELF}.abc123.key`), 'not json');
    expect(liveSessions(root)).toHaveLength(1);
  });

  it('survives a truncated or non-JSON record', () => {
    const root = claudeRoot();
    fs.writeFileSync(path.join(root, 'sessions', '1.json'), '{"pid":');
    expect(() => liveSessions(root)).not.toThrow();
    expect(liveSessions(root)).toEqual([]);
  });

  it('returns nothing for an account that has never run', () => {
    const root = path.join(home, '.claude-fresh');
    fs.mkdirSync(root, { recursive: true });
    expect(liveSessions(root)).toEqual([]);
  });
});

describe('Codex sessions — one lock file per running session', () => {
  const codexHome = () => {
    const root = path.join(home, '.codex');
    fs.mkdirSync(path.join(root, 'thread-writer-locks'), { recursive: true });
    return root;
  };

  it('counts a session lock', () => {
    const root = codexHome();
    const id = '01a0421d-433f-7883-96cc-4f767305210a';
    fs.writeFileSync(path.join(root, 'thread-writer-locks', `${id}.lock`), '');

    const live = liveSessions(root);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(id);
  });

  it("ignores Codex's own coordination lock", () => {
    // a dotfile, and not a session — counting it would report a phantom
    const root = codexHome();
    fs.writeFileSync(path.join(root, 'thread-writer-locks', '.coordination.lock'), '');
    expect(liveSessions(root)).toEqual([]);
  });

  it('returns nothing when Codex has never run', () => {
    const root = path.join(home, '.codex-fresh');
    fs.mkdirSync(root, { recursive: true });
    expect(liveSessions(root)).toEqual([]);
  });
});
