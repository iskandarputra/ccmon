/**
 * @file account-setup.test.ts
 * @brief Unit tests for shell detection, managed-script rendering, and idempotent apply.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applySetup,
  createAccountDir,
  detectShells,
  managedNames,
  planSetup,
  renameAccountDir,
  renderManagedScript,
  scanRcForWrappers,
  suggestLabel,
  writeWrapperAccounts,
  type SetupEnv,
} from '../account-setup';
import type { SetupOptions } from '../../../shared/types';

let home: string;
let env: SetupEnv;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-setup-'));
  env = { home, loginShell: '/usr/bin/zy', platform: 'linux' };
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const opts = (over: Partial<SetupOptions> = {}): SetupOptions => ({
  accounts: [
    { name: 'claude-personal', root: path.join(home, '.claude') },
    { name: 'claude-work', root: path.join(home, '.claude-work') },
  ],
  rcPaths: [path.join(home, '.bashrc')],
  installHelper: true,
  ...over,
});

describe('detectShells — login shell precedence', () => {
  it('flags the login shell from the account record, not $SHELL', () => {
    // the real-world trap: $SHELL says zsh, but the login shell is zy and
    // ~/.zshrc does not even exist. We must pick zy, not zsh — and zsh, having
    // no rc and not being the login shell, must not be shown at all.
    fs.writeFileSync(path.join(home, '.zyrc'), '# zy\n');
    fs.writeFileSync(path.join(home, '.bashrc'), '# bash\n');
    const { platform, shells } = detectShells(env);
    expect(platform).toBe('linux');
    expect(shells.map((s) => s.shell)).toEqual(['zy', 'bash']); // zsh hidden
    const zy = shells.find((s) => s.shell === 'zy')!;
    const bash = shells.find((s) => s.shell === 'bash')!;
    expect(zy.detected).toBe(true);
    expect(zy.note).toBe('your login shell');
    expect(bash.detected).toBe(false);
    expect(bash.note).toBe('rc present');
  });

  it('reports an already-linked rc', () => {
    fs.writeFileSync(path.join(home, '.zyrc'), '# zy\n# >>> ccmon managed >>>\n');
    const zy = detectShells(env).shells.find((s) => s.shell === 'zy')!;
    expect(zy.linked).toBe(true);
    expect(zy.note).toBe('already linked');
  });

  it('shows ONLY the login shell + shells with an rc — nothing you do not run', () => {
    // login shell is bash, with no rc files anywhere: bash shows (we will
    // create its rc), zy and zsh are hidden (not login, no rc).
    const shells = detectShells({ home, loginShell: '/bin/bash', platform: 'linux' }).shells;
    expect(shells.map((s) => s.shell)).toEqual(['bash']);
    expect(shells[0].note).toContain('creates ~/.bashrc');
  });
});

describe('detectShells — per-OS targets', () => {
  it('macOS bash targets ~/.bash_profile (the login file), not ~/.bashrc', () => {
    fs.writeFileSync(path.join(home, '.bash_profile'), '# bash\n'); // so bash is shown
    const mac: SetupEnv = { home, loginShell: '/bin/zsh', platform: 'darwin' };
    const shells = detectShells(mac).shells;
    const bash = shells.find((s) => s.shell === 'bash')!;
    expect(bash.rcPath).toBe(path.join(home, '.bash_profile'));
    const zsh = shells.find((s) => s.shell === 'zsh')!; // login shell → shown even without an rc
    expect(zsh.detected).toBe(true);
  });

  it('Windows offers a single PowerShell profile target', () => {
    const profile = path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const { platform, shells } = detectShells({ home, loginShell: null, platform: 'win32', psProfile: profile });
    expect(platform).toBe('win32');
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ shell: 'powershell', family: 'powershell', detected: true, rcPath: profile });
  });
});

describe('renderManagedScript', () => {
  it('emits a launcher per account with $HOME-relative config dirs', () => {
    const out = renderManagedScript(opts().accounts, home);
    expect(out).toContain('claude-personal() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude";');
    expect(out).toContain('claude-work() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude-work";');
  });

  it('emits cross-resume helpers for each ordered pair', () => {
    const out = renderManagedScript(opts().accounts, home);
    expect(out).toContain('claude-personal-from-work() {');
    expect(out).toContain('claude-work-from-personal() {');
  });

  it('suggestLabel maps the default root to claude-personal', () => {
    expect(suggestLabel(path.join(home, '.claude'))).toBe('claude-personal');
    expect(suggestLabel(path.join(home, '.claude-work'))).toBe('claude-work');
    expect(suggestLabel(path.join(home, '.claude_research'))).toBe('claude-research');
  });
});

describe('planSetup — validation', () => {
  it('flags an invalid wrapper name', () => {
    const p = planSetup(opts({ accounts: [{ name: 'bad name', root: path.join(home, '.claude') }] }), env);
    expect(p.problems.some((x) => x.includes('invalid wrapper name'))).toBe(true);
  });

  it('flags when no shell is selected', () => {
    const p = planSetup(opts({ rcPaths: [] }), env);
    expect(p.problems).toContain('pick at least one shell to link');
  });

  it('marks an already-linked rc as no-change', () => {
    const rc = path.join(home, '.bashrc');
    fs.writeFileSync(rc, '# >>> ccmon managed >>>\n');
    const p = planSetup(opts(), env);
    expect(p.rcEdits[0].alreadyLinked).toBe(true);
    expect(p.rcEdits[0].blockToAdd).toBe('');
  });
});

describe('applySetup — writes and idempotency', () => {
  it('writes the managed file, links the rc, and installs the executable helper', () => {
    const r = applySetup(opts(), env);
    expect(r.ok).toBe(true);

    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).toContain('claude-work() {');

    const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    expect(rc).toContain('# >>> ccmon managed >>>');
    expect(rc).toContain('claude-accounts.sh');

    const helper = path.join(home, '.local', 'bin', 'claude-cross-resume');
    expect(fs.existsSync(helper)).toBe(true);
    expect(fs.statSync(helper).mode & 0o111).toBeGreaterThan(0); // executable
    expect(r.reloadHint).toContain('source ~/.bashrc');
  });

  it('is idempotent — a second apply links nothing new and never duplicates the block', () => {
    applySetup(opts(), env);
    const r2 = applySetup(opts(), env);
    expect(r2.linkedRc).toHaveLength(0);
    const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    expect(rc.match(/# >>> ccmon managed >>>/g)).toHaveLength(1);
  });

  it('appends without clobbering existing rc content', () => {
    const rc = path.join(home, '.bashrc');
    fs.writeFileSync(rc, 'export EDITOR=vim'); // no trailing newline
    applySetup(opts(), env);
    const after = fs.readFileSync(rc, 'utf8');
    expect(after).toContain('export EDITOR=vim');
    expect(after).toContain('# >>> ccmon managed >>>');
  });
});

describe('writeWrapperAccounts — quick rename/untrack, no rc involved', () => {
  it('writes the managed file without touching any rc', () => {
    const r = writeWrapperAccounts(opts().accounts, env);
    expect(r.ok).toBe(true);
    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).toContain('claude-work() {');
    expect(fs.existsSync(path.join(home, '.bashrc'))).toBe(false);
  });

  it('a rename overwrites the launcher under the new name only', () => {
    writeWrapperAccounts(opts().accounts, env);
    const renamed = opts().accounts.map((a) =>
      a.name === 'claude-work' ? { ...a, name: 'claude-client-x' } : a,
    );
    writeWrapperAccounts(renamed, env);
    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).toContain('claude-client-x() {');
    expect(managed).not.toContain('claude-work() {');
    expect(managed).toContain('claude-personal() {'); // untouched account survives
  });

  it('untracking drops the account from the file entirely', () => {
    writeWrapperAccounts(opts().accounts, env);
    const kept = opts().accounts.filter((a) => a.name !== 'claude-work');
    writeWrapperAccounts(kept, env);
    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).not.toContain('claude-work');
    expect(managed).toContain('claude-personal() {');
  });

  it('untracking every account leaves an empty (but valid) managed file', () => {
    writeWrapperAccounts(opts().accounts, env);
    const r = writeWrapperAccounts([], env);
    expect(r.ok).toBe(true);
    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).not.toContain('claude-personal');
    expect(managed).not.toContain('claude-work');
  });

  it('rejects an invalid or duplicate name without writing', () => {
    fs.mkdirSync(path.join(home, '.config', 'ccmon'), { recursive: true });
    const before = 'sentinel';
    fs.writeFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), before);

    const bad = writeWrapperAccounts([{ name: '1bad', root: path.join(home, '.claude') }], env);
    expect(bad.ok).toBe(false);

    const dup = writeWrapperAccounts(
      [
        { name: 'claude-x', root: path.join(home, '.claude') },
        { name: 'claude-x', root: path.join(home, '.claude-work') },
      ],
      env,
    );
    expect(dup.ok).toBe(false);

    const managed = fs.readFileSync(path.join(home, '.config', 'ccmon', 'claude-accounts.sh'), 'utf8');
    expect(managed).toBe(before); // rejected writes never touch the file
  });
});

describe('conflict detection — pre-existing hand-written wrappers', () => {
  // the real scenario: the user already has hand-written claude-* in ~/.zyrc
  const HANDWRITTEN =
    '# zy\n' +
    'claude-personal() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude"; claude "$@" ); }\n' +
    'claude-work()     { ( export CLAUDE_CONFIG_DIR="$HOME/.claude-work"; claude "$@" ); }\n' +
    'claude-personal-from-work() { claude-cross-resume "$HOME/.claude-work" "$HOME/.claude" "$1"; }\n';

  const zyOpts = (over: Partial<SetupOptions> = {}): SetupOptions => ({
    ...opts(),
    rcPaths: [path.join(home, '.zyrc')],
    ...over,
  });

  it('scanRcForWrappers finds the hand-written single-line defs', () => {
    const rc = path.join(home, '.zyrc');
    fs.writeFileSync(rc, HANDWRITTEN);
    const found = scanRcForWrappers(rc, managedNames(zyOpts().accounts));
    expect(found.map((f) => f.name).sort()).toEqual(
      ['claude-personal', 'claude-personal-from-work', 'claude-work'].sort(),
    );
    expect(found.every((f) => f.canTidy)).toBe(true);
  });

  it('planSetup warns about shadowing and lists the defs per rc', () => {
    fs.writeFileSync(path.join(home, '.zyrc'), HANDWRITTEN);
    const p = planSetup(zyOpts(), env);
    expect(p.warnings.some((w) => w.includes('already defines') && w.includes('shadowed'))).toBe(true);
    expect(p.rcEdits[0].existing.length).toBe(3);
  });

  it('tidy OFF — appends the link but never touches the hand-written lines', () => {
    const rc = path.join(home, '.zyrc');
    fs.writeFileSync(rc, HANDWRITTEN);
    applySetup(zyOpts({ tidyExisting: false }), env);
    const after = fs.readFileSync(rc, 'utf8');
    // original defs are intact (uncommented) and the source block is appended
    expect(after).toContain('claude-personal() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude";');
    expect(after).not.toContain('# ccmon superseded');
    expect(after).toContain('# >>> ccmon managed >>>');
  });

  it('tidy ON — comments out the superseded single-line defs and is idempotent', () => {
    const rc = path.join(home, '.zyrc');
    fs.writeFileSync(rc, HANDWRITTEN);
    const r = applySetup(zyOpts({ tidyExisting: true }), env);
    expect(r.tidiedRc).toContain(rc);
    const after = fs.readFileSync(rc, 'utf8');
    expect(after).toContain('# ccmon superseded → claude-personal()');
    expect(after).toContain('# ccmon superseded → claude-work()');
    // no live (uncommented) hand-written def remains
    expect(after).not.toMatch(/^claude-personal\(\)/m);

    // second apply changes nothing — already tidied + linked
    const r2 = applySetup(zyOpts({ tidyExisting: true }), env);
    expect(r2.tidiedRc).toHaveLength(0);
    expect(r2.linkedRc).toHaveLength(0);
    expect(fs.readFileSync(rc, 'utf8')).toBe(after);
  });

  it('leaves a MULTI-line hand-written def alone (flagged for manual removal)', () => {
    const rc = path.join(home, '.zyrc');
    fs.writeFileSync(
      rc,
      'claude-work() {\n  ( export CLAUDE_CONFIG_DIR="$HOME/.claude-work"; claude "$@" )\n}\n',
    );
    const p = planSetup(zyOpts({ tidyExisting: true }), env);
    const work = p.rcEdits[0].existing.find((e) => e.name === 'claude-work')!;
    expect(work.canTidy).toBe(false);

    applySetup(zyOpts({ tidyExisting: true }), env);
    const after = fs.readFileSync(rc, 'utf8');
    expect(after).toContain('claude-work() {'); // untouched — not safely single-line
    expect(after).not.toContain('# ccmon superseded → claude-work() {');
  });
});

describe('PowerShell (Windows) setup', () => {
  const profile = () => path.join(home, 'profile.ps1');
  const winEnv = (): SetupEnv => ({ home, loginShell: null, platform: 'win32', psProfile: profile() });
  const winOpts = (over: Partial<SetupOptions> = {}): SetupOptions => ({
    ...opts(),
    rcPaths: [profile()],
    ...over,
  });

  it('renders function-style wrappers and omits the bash cross-resume helpers', () => {
    const script = renderManagedScript(winOpts().accounts, home, 'powershell');
    expect(script).toContain(
      'function claude-personal { $env:CLAUDE_CONFIG_DIR = "$HOME/.claude"; claude @args }',
    );
    expect(script).toContain(
      'function claude-work { $env:CLAUDE_CONFIG_DIR = "$HOME/.claude-work"; claude @args }',
    );
    expect(script).not.toContain('claude-cross-resume');
    expect(managedNames(winOpts().accounts, 'powershell')).toEqual(['claude-personal', 'claude-work']);
  });

  it('writes the .ps1 managed file, dot-sources it from $PROFILE, and skips the Unix helper', () => {
    const r = applySetup(winOpts({ installHelper: true }), winEnv());
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(home, '.config', 'ccmon', 'claude-accounts.ps1'))).toBe(true);
    const prof = fs.readFileSync(profile(), 'utf8');
    expect(prof).toContain('# >>> ccmon managed >>>');
    expect(prof).toContain('. "$HOME/.config/ccmon/claude-accounts.ps1"');
    expect(r.helperInstalled).toBe(false); // bash helper is Unix-only
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'claude-cross-resume'))).toBe(false);
  });

  it('detects and tidies a pre-existing PowerShell function def', () => {
    fs.writeFileSync(
      profile(),
      'function claude-work { $env:CLAUDE_CONFIG_DIR = "$HOME/.claude-work"; claude @args }\n',
    );
    const found = scanRcForWrappers(profile(), managedNames(winOpts().accounts, 'powershell'), 'powershell');
    expect(found.map((f) => f.name)).toContain('claude-work');
    expect(found.find((f) => f.name === 'claude-work')!.canTidy).toBe(true);

    applySetup(winOpts({ tidyExisting: true }), winEnv());
    expect(fs.readFileSync(profile(), 'utf8')).toContain('# ccmon superseded → function claude-work {');
  });
});

describe('createAccountDir', () => {
  it('creates ~/.claude-<suffix>/projects for a valid suffix', () => {
    const res = createAccountDir('research', env);
    expect(res.ok).toBe(true);
    expect(res.root).toBe(path.join(home, '.claude-research'));
    expect(fs.existsSync(path.join(res.root, 'projects'))).toBe(true);
  });

  it('rejects an invalid suffix', () => {
    const res = createAccountDir('../escape', env);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('renameAccountDir', () => {
  it('moves ~/.claude-<old> to ~/.claude-<new> on disk', () => {
    const oldRoot = path.join(home, '.claude-work-mine');
    fs.mkdirSync(path.join(oldRoot, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(oldRoot, '.credentials.json'), '{}');

    const res = renameAccountDir(oldRoot, 'work-yes', env);
    expect(res.ok).toBe(true);
    expect(res.root).toBe(path.join(home, '.claude-work-yes'));
    expect(fs.existsSync(oldRoot)).toBe(false);
    expect(fs.existsSync(path.join(res.root, '.credentials.json'))).toBe(true);
  });

  it('refuses to rename the default ~/.claude root', () => {
    const defaultRoot = path.join(home, '.claude');
    fs.mkdirSync(defaultRoot, { recursive: true });
    const res = renameAccountDir(defaultRoot, 'personal-old', env);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/default/);
    expect(fs.existsSync(defaultRoot)).toBe(true);
  });

  it('rejects a collision with an existing account dir', () => {
    const oldRoot = path.join(home, '.claude-a');
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.mkdirSync(path.join(home, '.claude-b'), { recursive: true });
    const res = renameAccountDir(oldRoot, 'b', env);
    expect(res.ok).toBe(false);
    expect(fs.existsSync(oldRoot)).toBe(true); // untouched
  });

  it('rejects an invalid suffix without touching the source dir', () => {
    const oldRoot = path.join(home, '.claude-work');
    fs.mkdirSync(oldRoot, { recursive: true });
    const res = renameAccountDir(oldRoot, '../escape', env);
    expect(res.ok).toBe(false);
    expect(fs.existsSync(oldRoot)).toBe(true);
  });

  it('errors when the source dir does not exist', () => {
    const res = renameAccountDir(path.join(home, '.claude-ghost'), 'ghost2', env);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
