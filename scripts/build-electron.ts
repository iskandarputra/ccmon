/**
 * @file build-electron.ts
 * @brief esbuild bundler for the Electron main and preload entries.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Bundles the Electron main process and preload script with esbuild into
 * dist-electron/ (CJS, self-contained — the bundled pricing snapshots are
 * inlined as JSON imports). `electron` stays external by necessity and
 * `chokidar` by choice: it is the one production dependency, shipped in
 * node_modules by electron-builder.
 *
 * The headless CLI builds from the same services into dist-cli/ with a
 * shebang, and is deliberately a SEPARATE bundle: it must not link Electron,
 * which is what keeps `ccmon json` runnable under plain node.
 */

import fs from 'fs/promises';
import path from 'path';
import { build, type BuildOptions } from 'esbuild';

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'chokidar'],
  logLevel: 'info',
};

export async function buildElectron(): Promise<void> {
  await build({
    ...common,
    outdir: 'dist-electron',
    entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  });
}

/**
 * Windows has no shebang and no executable bit, so the shipped `index.cjs`
 * cannot be run directly the way the README's `ln -sf` runs it on Unix. This
 * batch shim sits beside it and is what a user puts on PATH (or points a
 * Claude Code `statusLine.command` at): it forwards every argument to node and
 * propagates the exit code, which a statusline needs to stay silent on error.
 */
const CMD_SHIM = [
  '@echo off',
  'rem ccmon CLI launcher (generated) — Windows has no shebang.',
  'setlocal',
  'node "%~dp0index.cjs" %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n');

export async function buildCli(): Promise<void> {
  await build({
    ...common,
    outdir: 'dist-cli',
    entryPoints: ['cli/index.ts'],
    banner: { js: '#!/usr/bin/env node' },
  });
  // the shebang is only useful if the file is executable — npm's bin symlink
  // does not add the bit for you
  await fs.chmod(path.join('dist-cli', 'index.cjs'), 0o755);
  await fs.writeFile(path.join('dist-cli', 'ccmon.cmd'), CMD_SHIM);
}

if (require.main === module) {
  const cliOnly = process.argv.includes('--cli-only');
  const task = cliOnly ? buildCli() : Promise.all([buildElectron(), buildCli()]);
  task.catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
