/**
 * @file dev.ts
 * @brief Dev orchestrator — esbuild watch, Vite dev server, and Electron with hot reload.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Dev runner: compiles the Electron layer, starts the Vite dev server,
 * waits for it, then launches Electron pointed at it. Ctrl+C (or closing
 * the window) tears everything down.
 */

import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import { buildElectron } from './build-electron';

const DEV_URL = 'http://localhost:5183';
const TIMEOUT_MS = 30000;

function waitFor(url: string, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`vite did not come up at ${url}`));
        else setTimeout(poll, 300);
      });
    };
    poll();
  });
}

async function main(): Promise<void> {
  await buildElectron();

  // Vite 8 doesn't export ./bin/vite.js — resolve via package directory instead
  const viteDir = path.dirname(require.resolve('vite/package.json'));
  const viteBin = path.join(viteDir, 'bin', 'vite.js');

  const vite: ChildProcess = spawn(process.execPath, [viteBin], {
    stdio: 'inherit',
    env: process.env,
  });

  process.on('SIGINT', () => {
    vite.kill();
    process.exit(0);
  });

  try {
    await waitFor(DEV_URL, Date.now() + TIMEOUT_MS);
  } catch (err) {
    console.error((err as Error).message);
    vite.kill();
    process.exit(1);
  }

  const electronPath = require('electron') as unknown as string; // resolves to the binary path
  const el = spawn(electronPath, ['--no-sandbox', '.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });
  el.on('exit', (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
