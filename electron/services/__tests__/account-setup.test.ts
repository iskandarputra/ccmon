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
  resolveEnvSecrets,
  resolveLoginShell,
  scanRcForWrappers,
  suggestLabel,
  visibleAccountDirs,
  writeWrapperAccounts,
  type SetupEnv,
} from '../account-setup';
import { PROVIDER_PRESETS } from '../../../shared/providerPresets';
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

  it('macOS surfaces bash when only ~/.bashrc exists, still targeting ~/.bash_profile', () => {
    // people carry a ~/.bashrc over from Linux and source it from .bash_profile;
    // that machine clearly runs bash, so hiding it would be wrong.
    fs.writeFileSync(path.join(home, '.bashrc'), '# bash\n');
    const shells = detectShells({ home, loginShell: '/bin/bash', platform: 'darwin' }).shells;
    const bash = shells.find((s) => s.shell === 'bash')!;
    expect(bash.rcPath).toBe(path.join(home, '.bash_profile'));
    expect(bash.exists).toBe(false); // the TARGET does not exist yet
  });

  it('macOS shows bash from ~/.bashrc even when it is not the login shell', () => {
    fs.writeFileSync(path.join(home, '.bashrc'), '# bash\n');
    const shells = detectShells({ home, loginShell: '/bin/zsh', platform: 'darwin' }).shells;
    const bash = shells.find((s) => s.shell === 'bash')!;
    expect(bash.detected).toBe(false);
    expect(bash.note).toBe('~/.bashrc present · creates ~/.bash_profile');
  });

  it('never returns an empty list: a fresh macOS account falls back to zsh', () => {
    // no rc files, and the login shell could not be resolved (no $SHELL in a
    // Finder-launched app, dscl unavailable) — the wizard still needs a target.
    const { shells } = detectShells({ home, loginShell: null, platform: 'darwin' });
    expect(shells).toHaveLength(1);
    expect(shells[0].shell).toBe('zsh');
    expect(shells[0].rcPath).toBe(path.join(home, '.zshrc'));
    expect(shells[0].note).toBe('no login shell detected · creates ~/.zshrc');
  });

  it('the empty-list fallback is bash on Linux', () => {
    const { shells } = detectShells({ home, loginShell: null, platform: 'linux' });
    expect(shells.map((s) => s.shell)).toEqual(['bash']);
    expect(shells[0].rcPath).toBe(path.join(home, '.bashrc'));
  });

  it('Windows offers a single PowerShell profile target', () => {
    const profile = path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const { platform, shells } = detectShells({ home, loginShell: null, platform: 'win32', psProfile: profile });
    expect(platform).toBe('win32');
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ shell: 'powershell', family: 'powershell', detected: true, rcPath: profile });
  });
});

describe('resolveLoginShell — per-OS account record', () => {
  const saved = process.env.SHELL;
  afterEach(() => {
    if (saved === undefined) delete process.env.SHELL;
    else process.env.SHELL = saved;
  });

  it('reads Directory Services on macOS, not getent', () => {
    const calls: string[] = [];
    const probe = (file: string, args: string[]) => {
      calls.push(file);
      return file === 'dscl' && args.includes('UserShell') ? 'UserShell: /bin/bash\n' : null;
    };
    expect(resolveLoginShell('darwin', probe)).toBe('/bin/bash');
    expect(calls).toEqual(['dscl']); // getent does not exist on macOS
  });

  it('reads /etc/passwd via getent elsewhere', () => {
    const probe = (file: string) =>
      file === 'getent' ? 'me:x:1000:1000:me:/home/me:/usr/bin/zy\n' : null;
    expect(resolveLoginShell('linux', probe)).toBe('/usr/bin/zy');
  });

  it('falls back to $SHELL when the probe answers nothing', () => {
    process.env.SHELL = '/bin/fish';
    expect(resolveLoginShell('darwin', () => null)).toBe('/bin/fish');
  });

  it('returns null when the probe fails and $SHELL is unset — the Finder-launch case', () => {
    delete process.env.SHELL;
    expect(resolveLoginShell('darwin', () => null)).toBeNull();
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

  it('calls the helper by its install path — ~/.local/bin is not on PATH on macOS', () => {
    const out = renderManagedScript(opts().accounts, home);
    expect(out).toContain('"$HOME/.local/bin/claude-cross-resume" "$HOME/.claude-work" "$HOME/.claude"');
    expect(out).not.toMatch(/^\s*claude-\S+\(\) \{ claude-cross-resume/m); // never bare
  });

  it('suggestLabel maps the default root to claude-personal', () => {
    expect(suggestLabel(path.join(home, '.claude'))).toBe('claude-personal');
    expect(suggestLabel(path.join(home, '.claude-work'))).toBe('claude-work');
    expect(suggestLabel(path.join(home, '.claude_research'))).toBe('claude-research');
  });
});

describe('renderManagedScript — per-account environment (alternate providers)', () => {
  // the real case: Claude Code pointed at DeepSeek is a base URL + a token +
  // a model mapping, none of which is a config dir
  const deepseek = () => [
    { name: 'claude-personal', root: path.join(home, '.claude') },
    {
      name: 'claude-deepseek',
      root: path.join(home, '.claude-deepseek'),
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-secret',
        ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
      },
    },
  ];

  it('exports the extra env inside the same subshell as the config dir', () => {
    const out = renderManagedScript(deepseek(), home);
    expect(out).toContain(
      `claude-deepseek() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude-deepseek" ` +
        `ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' ANTHROPIC_AUTH_TOKEN='sk-secret' ` +
        `ANTHROPIC_MODEL='deepseek-v4-pro[1m]'; claude "$@" ); }`,
    );
    // an account with no env keeps exactly the old one-variable form
    expect(out).toContain('claude-personal() { ( export CLAUDE_CONFIG_DIR="$HOME/.claude"; claude "$@" ); }');
  });

  it('single-quotes values so nothing in a token or URL is expanded', () => {
    const out = renderManagedScript(
      [
        { name: 'claude-a', root: path.join(home, '.claude') },
        { name: 'claude-b', root: path.join(home, '.claude-b'), env: { T: "a$HOME`x'y" } },
      ],
      home,
    );
    expect(out).toContain(`T='a$HOME\`x'\\''y'`);
  });

  it('a cross-resume INTO a provider account carries that provider', () => {
    // without this the helper ends in `exec claude --resume` with only
    // CLAUDE_CONFIG_DIR set, and the resumed session silently talks to Anthropic
    const out = renderManagedScript(deepseek(), home);
    expect(out).toContain(
      `claude-deepseek-from-personal() { ( export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' ` +
        `ANTHROPIC_AUTH_TOKEN='sk-secret' ANTHROPIC_MODEL='deepseek-v4-pro[1m]'; ` +
        `"$HOME/.local/bin/claude-cross-resume" "$HOME/.claude" "$HOME/.claude-deepseek" "$1" ); }`,
    );
    // and resuming into the plain account exports nothing extra
    expect(out).toContain(
      `claude-personal-from-deepseek() { ( "$HOME/.local/bin/claude-cross-resume" ` +
        `"$HOME/.claude-deepseek" "$HOME/.claude" "$1" ); }`,
    );
  });

  it('PowerShell sets the same variables and restores them all', () => {
    const out = renderManagedScript(deepseek(), home, 'powershell');
    expect(out).toContain(`'ANTHROPIC_BASE_URL' = 'https://api.deepseek.com/anthropic'`);
    expect(out).toContain(`'ANTHROPIC_MODEL' = 'deepseek-v4-pro[1m]'`);
    expect(out).toContain(`$ccmonPrev[$k] = [Environment]::GetEnvironmentVariable($k)`);
  });

  it('rejects an unusable variable name, a reserved one, and an embedded newline', () => {
    const bad = (env: Record<string, string>) =>
      planSetup(opts({ accounts: [{ name: 'claude-x', root: path.join(home, '.claude'), env }] })).problems;
    expect(bad({ 'BAD NAME': 'v' }).some((p) => p.includes('invalid environment variable name'))).toBe(true);
    expect(bad({ CLAUDE_CONFIG_DIR: '/x' }).some((p) => p.includes('comes from the config dir'))).toBe(true);
    expect(bad({ T: 'a\nb' }).some((p) => p.includes('line break'))).toBe(true);
  });
});

describe('provider presets + secret references', () => {
  const preset = () => PROVIDER_PRESETS.find((p) => p.id === 'deepseek')!;
  const withPreset = () => [
    { name: 'claude-deepseek', root: path.join(home, '.claude-deepseek'), env: preset().env },
  ];

  it('the DeepSeek preset is valid input to the generator', () => {
    // a preset that trips its own validator would be worse than no preset
    const p = planSetup(
      opts({ accounts: resolveEnvSecrets(withPreset(), () => 'sk-real') }),
      env,
    );
    expect(p.problems).toEqual([]);
  });

  it('resolves ${ccmon:…} to the stored secret at write time', () => {
    const resolved = resolveEnvSecrets(withPreset(), (name) =>
      name === 'deepseek-key' ? 'sk-real' : null,
    );
    expect(resolved[0].env!.ANTHROPIC_AUTH_TOKEN).toBe('sk-real');
    // untouched values pass through, and the input is not mutated
    expect(resolved[0].env!.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(withPreset()[0].env!.ANTHROPIC_AUTH_TOKEN).toContain('${ccmon:');
  });

  it('REFUSES to write an unresolved reference rather than sending it as a token', () => {
    const p = planSetup(opts({ accounts: resolveEnvSecrets(withPreset(), () => null) }), env);
    expect(p.problems.some((x) => x.includes('ccmon does not have'))).toBe(true);
  });

  it('a masked resolution is what a preview renders — never the real key', () => {
    const masked = resolveEnvSecrets(withPreset(), () => '••••••••real');
    const p = planSetup(opts({ accounts: masked }), env);
    expect(p.problems).toEqual([]);
    expect(p.managedScript).toContain('••••••••real');
    expect(p.managedScript).not.toContain('sk-real');
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

  it('Windows: creates the missing $PROFILE directory and dot-sources the .ps1', () => {
    // Documents\PowerShell does not exist until a profile does — writing
    // straight into it used to fail with ENOENT on a clean machine.
    const profile = path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const win: SetupEnv = { home, loginShell: null, platform: 'win32', psProfile: profile };
    const r = applySetup(opts({ rcPaths: [profile] }), win);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);

    const written = fs.readFileSync(profile, 'utf8');
    expect(written).toContain('# >>> ccmon managed >>>');
    expect(written).toContain('claude-accounts.ps1');
    expect(fs.existsSync(path.join(home, '.config', 'ccmon', 'claude-accounts.ps1'))).toBe(true);
    expect(r.reloadHint).toContain('. ~'); // PowerShell dot-source, not `source`
    expect(r.reloadHint).not.toContain('source ~');
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

  it('renders function-style wrappers that RESTORE the environment afterwards', () => {
    const script = renderManagedScript(winOpts().accounts, home, 'powershell');
    expect(script).toContain('function claude-personal {');
    expect(script).toContain(`'CLAUDE_CONFIG_DIR' = "$HOME/.claude"`);
    expect(script).toContain(`'CLAUDE_CONFIG_DIR' = "$HOME/.claude-work"`);
    expect(script).toContain('claude @args');
    // $env: writes the PROCESS environment, so without the restore a single
    // claude-work would rebind every later bare `claude` in that session.
    expect(script).toContain('} finally {');
    expect(script).toContain('Remove-Item -Path "env:$k"');
  });

  it('emits cross-resume wrappers on Windows too, calling the .ps1 helper', () => {
    const script = renderManagedScript(winOpts().accounts, home, 'powershell');
    expect(script).toContain('function claude-personal-from-work {');
    expect(script).toContain('"$HOME/.config/ccmon/claude-cross-resume.ps1"');
    expect(managedNames(winOpts().accounts)).toEqual([
      'claude-personal',
      'claude-work',
      'claude-personal-from-work',
      'claude-work-from-personal',
    ]);
  });

  it('writes the .ps1 managed file, dot-sources it from $PROFILE, and installs the PS helper', () => {
    const r = applySetup(winOpts({ installHelper: true }), winEnv());
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(home, '.config', 'ccmon', 'claude-accounts.ps1'))).toBe(true);
    const prof = fs.readFileSync(profile(), 'utf8');
    expect(prof).toContain('# >>> ccmon managed >>>');
    expect(prof).toContain('. "$HOME/.config/ccmon/claude-accounts.ps1"');

    expect(r.helperInstalled).toBe(true);
    const helper = path.join(home, '.config', 'ccmon', 'claude-cross-resume.ps1');
    expect(fs.readFileSync(helper, 'utf8')).toContain('claude --resume $Id');
    // the bash twin has no business on Windows
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'claude-cross-resume'))).toBe(false);
  });

  it('warns about the execution policy, which the wizard cannot change itself', () => {
    const p = planSetup(winOpts({ installHelper: true }), winEnv());
    expect(p.warnings.some((w) => w.includes('Set-ExecutionPolicy'))).toBe(true);
    expect(p.helperDest).toBe(path.join(home, '.config', 'ccmon', 'claude-cross-resume.ps1'));
  });

  it('detects and tidies a pre-existing PowerShell function def', () => {
    fs.writeFileSync(
      profile(),
      'function claude-work { $env:CLAUDE_CONFIG_DIR = "$HOME/.claude-work"; claude @args }\n',
    );
    const found = scanRcForWrappers(profile(), managedNames(winOpts().accounts), 'powershell');
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

describe('visibleAccountDirs', () => {
  const DEFAULT = '/home/u/.claude/projects';
  const WORK = '/home/u/.claude-work/projects';
  const TEAM = '/home/u/.claude-work-team/projects';
  const ALL = [DEFAULT, WORK, TEAM];

  it('passes everything through with no prefs', () => {
    expect(visibleAccountDirs(ALL)).toEqual(ALL);
    expect(visibleAccountDirs(ALL, {})).toEqual(ALL);
  });

  it('drops hidden roots and keeps the original order', () => {
    expect(visibleAccountDirs(ALL, { '/home/u/.claude-work': { hidden: true } })).toEqual([
      DEFAULT,
      TEAM,
    ]);
  });

  it('can hide the default account like any other', () => {
    expect(visibleAccountDirs(ALL, { '/home/u/.claude': { hidden: true } })).toEqual([WORK, TEAM]);
  });

  it('ignores the untrack-from-shell pref — a different concern entirely', () => {
    expect(visibleAccountDirs(ALL, { '/home/u/.claude-work': { disabled: true } })).toEqual(ALL);
  });

  it('refuses to hide everything, so the app can never end up with no data', () => {
    const prefs = {
      '/home/u/.claude': { hidden: true },
      '/home/u/.claude-work': { hidden: true },
      '/home/u/.claude-work-team': { hidden: true },
    };
    expect(visibleAccountDirs(ALL, prefs)).toEqual(ALL);
  });

  it('keeps stale prefs for accounts that no longer exist harmless', () => {
    expect(visibleAccountDirs([DEFAULT], { '/home/u/.claude-gone': { hidden: true } })).toEqual([
      DEFAULT,
    ]);
  });
});
