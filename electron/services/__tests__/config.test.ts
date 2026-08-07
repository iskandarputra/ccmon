/**
 * @file config.test.ts
 * @brief Unit tests for the power-user config loader.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * `~/.config/ccmon/config.json` is hand-edited by definition — it is the only
 * config surface ccmon has no UI for. So the contract is narrow and absolute:
 * whatever is in there, `loadConfig()` returns an object and never throws.
 * A syntax error in a hand-edited file must not stop the app from starting.
 *
 * `os.homedir` is mocked rather than the filesystem, so the test exercises the
 * real `CONFIG_PATH` construction instead of a path it invented.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;

/** Point os.homedir() at a scratch dir, then import the module fresh. */
async function loadWithHome(): Promise<typeof import('../config')> {
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof os>('os');
    return { ...actual, default: { ...actual, homedir: () => home }, homedir: () => home };
  });
  vi.resetModules();
  return import('../config');
}

const writeConfig = (body: string) => {
  const dir = path.join(home, '.config', 'ccmon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), body);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-cfg-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.doUnmock('os');
  vi.resetModules();
});

describe('loadConfig', () => {
  it('returns an empty object when no config exists — the normal case', async () => {
    const { loadConfig } = await loadWithHome();
    expect(loadConfig()).toEqual({});
  });

  it('resolves the path under ~/.config/ccmon', async () => {
    const { CONFIG_PATH } = await loadWithHome();
    expect(CONFIG_PATH).toBe(path.join(home, '.config', 'ccmon', 'config.json'));
  });

  it('reads extra data roots', async () => {
    writeConfig(JSON.stringify({ claudeDirs: ['/extra/root', '~/archive/claude'] }));
    const { loadConfig } = await loadWithHome();
    expect(loadConfig().claudeDirs).toEqual(['/extra/root', '~/archive/claude']);
  });

  it('reads pricing overrides with tier, contextLimit and fast', async () => {
    writeConfig(
      JSON.stringify({
        pricing: {
          '^my-proxy-opus': {
            in: 15,
            out: 75,
            tier: { in: 30 },
            contextLimit: 1_000_000,
            fast: 6,
          },
        },
      }),
    );
    const { loadConfig } = await loadWithHome();
    expect(loadConfig().pricing?.['^my-proxy-opus']).toMatchObject({
      in: 15,
      tier: { in: 30 },
      contextLimit: 1_000_000,
      fast: 6,
    });
  });

  it('reads display alias maps', async () => {
    writeConfig(
      JSON.stringify({
        modelAliases: { 'arn:aws:bedrock:::profile/abc': 'opus (bedrock)' },
        projectAliases: { '/home/me/work/api': 'api' },
      }),
    );
    const { loadConfig } = await loadWithHome();
    const cfg = loadConfig();
    expect(cfg.modelAliases?.['arn:aws:bedrock:::profile/abc']).toBe('opus (bedrock)');
    expect(cfg.projectAliases?.['/home/me/work/api']).toBe('api');
  });

  /** The whole point: a hand-edited file with a trailing comma must not crash startup. */
  it('returns {} for malformed JSON instead of throwing', async () => {
    writeConfig('{ "claudeDirs": ["/a",], }');
    const { loadConfig } = await loadWithHome();
    expect(loadConfig()).toEqual({});
  });

  it('returns {} for an empty file', async () => {
    writeConfig('');
    const { loadConfig } = await loadWithHome();
    expect(loadConfig()).toEqual({});
  });

  it('returns {} when the config path is a directory', async () => {
    fs.mkdirSync(path.join(home, '.config', 'ccmon', 'config.json'), { recursive: true });
    const { loadConfig } = await loadWithHome();
    expect(loadConfig()).toEqual({});
  });
});
