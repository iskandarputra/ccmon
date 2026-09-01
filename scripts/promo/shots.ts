/**
 * @file shots.ts
 * @brief Captures one still per headline view into docs/media/ for the README gallery.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 *   tsx scripts/promo/shots.ts [--demo] [--days N] [--seed N] [--skip-gen]
 *                              [--rebuild] [--width N] [--out DIR]
 *
 * Same app, same launch path and same selector table as record.ts — it just
 * takes pictures instead of film. Two differences that matter:
 *
 *   1. Motion is FROZEN before the first capture. An occluded or backgrounded
 *      window stops compositing mid-animation, so staggered panels would
 *      otherwise be photographed at opacity 0.
 *   2. Output is COMMITTED (docs/media/ is tracked, promo/ is not), so each
 *      file is downscaled and re-encoded through ffmpeg to keep the repo light.
 *
 * Replaces scripts/capture-views.mjs, which duplicated the CDP client, expected
 * a dev server on port 9222, and drove a hardcoded 1-9 view map that the
 * sidebar had been reordered out from under.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureBuilt, launch, Page, sleep, writeAppConfig, REPO } from './cdp';
import {
  DEFAULT_ROOT,
  accountProjectDirs,
  generateAccounts,
  selfCheckAccounts,
} from './demo-data';
import { assertNoLeak, maskDemoHome } from './mask';
import { sel } from './selectors';
import { HERO_THEME, SHOT_VIEWS } from './tour';
import { loadViews, viewById } from './views';

const DEFAULT_OUT = path.join(REPO, 'docs', 'media');
/** README renders these at ~900px; 1440 keeps them crisp on HiDPI without bloat. */
const DEFAULT_WIDTH = 1440;
/** Loud rather than silent: a bloated gallery is a repo-weight regression. */
const MAX_BYTES = 700 * 1024;

/** Downscale + re-encode in place. ffmpeg is already required by encode.ts. */
function optimize(file: string, width: number): void {
  const tmp = `${file}.tmp.png`;
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file,
      '-vf', `scale=${width}:-2:flags=lanczos`,
      // png_compression 100 + a paletted-friendly predictor: these are flat UI
      // screenshots, so this is typically a 4-6x saving at zero visible cost.
      '-compression_level', '100',
      '-pred', 'mixed',
      tmp,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`ffmpeg failed on ${path.basename(file)}\n${r.stderr}`);
  }
  fs.renameSync(tmp, file);
}

const kb = (file: string): string => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = (n: string): boolean => argv.includes(`--${n}`);
  const opt = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const outDir = opt('out') ? path.resolve(opt('out')!) : DEFAULT_OUT;
  const width = Number(opt('width') ?? DEFAULT_WIDTH);
  const views = loadViews();

  ensureBuilt(flag('rebuild'));

  const demo = flag('demo');
  const home = demo ? DEFAULT_ROOT : path.join(os.tmpdir(), 'ccmon-real-home');
  if (demo && !flag('skip-gen')) {
    const sums = generateAccounts(home, {
      days: Number(opt('days') ?? 75),
      seed: Number(opt('seed') ?? 20260612),
    });
    console.log(`[shots] demo data: ${sums.length} accounts`);
    await selfCheckAccounts(home);
  } else if (!demo) {
    fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
  }

  const settings: Record<string, unknown> = { theme: HERO_THEME, pricingOffline: true };
  if (demo) settings.sources = accountProjectDirs(home);
  writeAppConfig(home, settings);

  fs.mkdirSync(outDir, { recursive: true });

  console.log('[shots] launching app — window will appear, hands off for ~40s');
  const app = await launch({ home, demo, theme: HERO_THEME });
  const page = new Page(app.cdp);

  try {
    if (!(await page.waitFor(sel('ready'), 45_000, 500))) {
      throw new Error('app never reached ready (no .stat-value on screen)');
    }

    if (demo) await maskDemoHome(page, home);

    // Warm the 3d chunk BEFORE freezing motion — three.js mounts on an
    // animation frame, and a frozen page never finishes mounting it.
    const spatial = viewById(views, 'spatial');
    if (spatial.key) {
      await page.key(spatial.key);
      if (!(await page.waitFor(sel('spatialControls'), 20_000))) {
        throw new Error('3d view never mounted');
      }
      await page.waitFor(sel('canvas'), 8000);
      await sleep(3000); // let the camera settle into its resting orbit
    }

    await page.freezeMotion();
    await page.parkCursor();

    const written: string[] = [];
    for (const shot of SHOT_VIEWS) {
      const v = viewById(views, shot.id);
      // an occluded window stops compositing — raise it so frames are fresh
      await page.bringToFront();
      if (v.key) await page.key(v.key);
      else await page.clickByText(sel('navLabel'), v.label);
      await sleep(shot.id === 'spatial' ? 2600 : 1400);

      if (demo) await assertNoLeak(page, home, shot.file);

      const file = path.join(outDir, `ccmon-${shot.file}.png`);
      const res = await app.cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(String(res.data), 'base64'));
      optimize(file, width);
      written.push(file);
      const size = fs.statSync(file).size;
      console.log(
        `[shots] ${shot.file.padEnd(10)} → ${path.basename(file)}  ${kb(file)}` +
          (size > MAX_BYTES ? '   ⚠ over budget' : ''),
      );
    }

    const total = written.reduce((n, f) => n + fs.statSync(f).size, 0);
    console.log(
      `[shots] ${written.length} stills, ${(total / 1024 / 1024).toFixed(2)} MB total → ${outDir}`,
    );
    const fat = written.filter((f) => fs.statSync(f).size > MAX_BYTES);
    if (fat.length) {
      console.warn(
        `[shots] ${fat.length} file(s) over ${MAX_BYTES / 1024} KB — these are committed, ` +
          `so re-run with a smaller --width before pushing:\n  ` +
          fat.map((f) => path.basename(f)).join('\n  '),
      );
    }
  } finally {
    await app.stop();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
