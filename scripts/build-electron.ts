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
 */

import { build, type BuildOptions } from 'esbuild';

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'chokidar'],
  logLevel: 'info',
};

export async function buildElectron(): Promise<void> {
  await build({
    ...common,
    entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  });
}

if (require.main === module) {
  buildElectron().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
