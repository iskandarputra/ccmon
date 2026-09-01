/**
 * @file record.ts
 * @brief Films the scripted ccmon tour over CDP — synthetic data, live feed, screencast frames.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Launches the BUILT app, runs the choreography in tour.ts, and captures
 * compositor frames via Page.startScreencast into promo/take/.
 * The window appears on screen for the duration — hands off mouse/keyboard.
 *
 * By default the subject is the REAL ~/.claude (read-only: a throwaway $HOME
 * keeps userData isolated and nothing is ever written into the data dir).
 * --demo films the synthetic multi-account world from demo-data.ts instead,
 * with env-gated synthetic plan limits so the accounts view renders fully.
 *
 *   tsx scripts/promo/record.ts [--demo] [--days N] [--seed N] [--skip-gen] [--rebuild]
 *
 * Then: tsx scripts/promo/encode.ts
 *
 * This file owns the CAMERA only. What gets shown lives in tour.ts, which
 * hooks the page exclusively through selectors.ts (a required miss is fatal)
 * and navigates with keys derived from Sidebar.tsx (views.ts). That split is
 * the fix for the previous version, where stale inline selectors and a
 * hardcoded 1-9 key map produced a wrong film that still exited 0.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureBuilt,
  launch,
  Page,
  sleep,
  writeAppConfig,
  REPO,
  WIN,
  type CdpParams,
} from './cdp';
import {
  DEFAULT_ROOT,
  accountProjectDirs,
  generateAccounts,
  selfCheckAccounts,
  startLiveTicker,
} from './demo-data';
import { assertNoLeak, maskDemoHome } from './mask';
import { requireSel, sel } from './selectors';
import { ACTS, HERO_THEME, type TourCtx } from './tour';
import { loadViews } from './views';

const TAKE_DIR = path.join(REPO, 'promo', 'take');
const FRAMES_DIR = path.join(TAKE_DIR, 'frames');

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = (n: string): boolean => argv.includes(`--${n}`);
  const opt = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const views = loadViews();
  console.log(
    `[record] view map from Sidebar.tsx: ${views.map((v) => `${v.key || '·'}=${v.id}`).join(' ')}`,
  );

  ensureBuilt(flag('rebuild'));

  // throwaway $HOME (isolated userData) — demo data only when asked
  const demo = flag('demo');
  const home = demo ? DEFAULT_ROOT : path.join(os.tmpdir(), 'ccmon-real-home');
  const seed = Number(opt('seed') ?? 20260612);
  if (demo) {
    if (!flag('skip-gen')) {
      const sums = generateAccounts(home, { days: Number(opt('days') ?? 75), seed });
      const files = sums.reduce((n, s) => n + s.files, 0);
      const lines = sums.reduce((n, s) => n + s.lines, 0);
      console.log(`[record] demo data: ${sums.length} accounts, ${files} sessions, ${lines} lines`);
      await selfCheckAccounts(home);
    }
  } else {
    // film the real ~/.claude; make sure no stale demo tree shadows it
    fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
  }

  const settings: Record<string, unknown> = { theme: HERO_THEME, pricingOffline: true };
  // demo: scope every view to all synthetic accounts at once, so the data views
  // read full and the accounts dashboard shows "all in view".
  if (demo) settings.sources = accountProjectDirs(home);
  writeAppConfig(home, settings);

  fs.rmSync(TAKE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('[record] launching app — window will appear, hands off for ~60s');
  const app = await launch({ home, demo, theme: HERO_THEME });
  const page = new Page(app.cdp);
  let stopTicker: (() => void) | null = null;

  try {
    // wait for the snapshot to land (real datasets take a few seconds)
    if (!(await page.waitFor(sel('ready'), 45_000, 500))) {
      throw new Error('app never reached ready (no .stat-value on screen)');
    }
    await requireSel((s) => page.exists(s), 'content');

    if (demo) await maskDemoHome(page, home);

    // prewarm the lazy three.js chunk so the finale cuts in clean. The old
    // version waited on `.spa-rail`, which no longer exists, so it fell through
    // after burning 8s and the finale opened on an unmounted canvas.
    const spatial = views.find((v) => v.id === 'spatial');
    if (spatial?.key) {
      await page.key(spatial.key);
      if (!(await page.waitFor(sel('spatialControls'), 20_000))) {
        throw new Error('3d view never mounted during prewarm');
      }
      await page.waitFor(sel('canvas'), 8000);
      await sleep(2500);
      await page.key(views[0].key);
      await sleep(900);
    }

    // demo mode fakes a live feed; real mode relies on actual activity
    if (demo) {
      stopTicker = startLiveTicker(home, seed + 1);
      await sleep(4200);
    } else {
      await sleep(1200);
    }

    // ---- roll camera ----
    const frames: Array<{ file: string; ts: number }> = [];
    const beats: Array<{ name: string; t: number }> = [];
    let pendingWrites = 0;
    let recording = true;
    /**
     * Offset from wall clock onto the FRAME clock, measured once on the first
     * frame. Beats are stamped as `Date.now()/1000 + clockSkew`.
     *
     * encode.ts compares beat times against frame times, so the two must share
     * a clock. Frames carry `Page.screencastFrame`'s `metadata.timestamp` (the
     * compositor's); beats were stamped with `Date.now()`. The two ran ~0.65s
     * apart, so every `rel(beat)` was offset by that much and every highlight
     * segment landed late — which is why the gif kept opening or closing on a
     * view's entrance fade however the offsets were retuned.
     *
     * Sampling the last frame's timestamp directly does NOT work either:
     * startScreencast only emits a frame when the page CHANGES, so during a
     * still dwell the frame clock freezes and a beat stamped then collapses
     * onto the previous one. (Measured: the projects act reported a 0.00s
     * window because nothing moved between its beat and its end.) A fixed skew
     * keeps beats on the frame timeline AND advancing through idle.
     */
    let clockSkew: number | null = null;
    app.cdp.on('Page.screencastFrame', (p: CdpParams) => {
      // Fire-and-forget: frames still in flight when the screencast stops (or
      // the app is killed) are acked into the void, and their replies never
      // come. That is normal teardown, not a wedge, so it must not surface as
      // the bounded-send timeout — it failed an otherwise complete take.
      void app.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      if (!recording) return;
      const meta = p.metadata as { timestamp?: number } | undefined;
      const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
      const ts = meta?.timestamp ?? Date.now() / 1000;
      if (clockSkew === null) clockSkew = ts - Date.now() / 1000;
      frames.push({ file, ts });
      pendingWrites++;
      fs.writeFile(path.join(FRAMES_DIR, file), Buffer.from(String(p.data), 'base64'), (err) => {
        pendingWrites--;
        if (err) console.error('[record] frame write failed:', err.message);
      });
    });

    const ctx: TourCtx = {
      page,
      views,
      demo,
      home,
      beat: (name) => {
        // wall clock projected onto the frame clock — see clockSkew above
        beats.push({ name, t: Date.now() / 1000 + (clockSkew ?? 0) });
        console.log(`[record]   · ${name}`);
      },
    };

    await page.bringToFront();
    await app.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: 3200,
      maxHeight: 2000,
      everyNthFrame: 1,
    });
    await sleep(400);

    for (const act of ACTS) {
      console.log(`[record] ▸ ${act.beat}`);
      await act.run(ctx);

      // The live feed only appears in the opener, and every ticker append costs
      // a debounced FULL recompute in main plus a renderer re-render. Left
      // running for the whole tour it saturated the renderer alongside the
      // 30fps screencast, and CDP calls stalled — the shoot hung in a different
      // act on each run. Film the feed, then stop the clock.
      if (stopTicker) {
        stopTicker();
        stopTicker = null;
        console.log('[record] live ticker stopped — feed is on camera, recompute freed');
      }
      // Acts stamp their OWN beat, from tour.ts#arrive, once the view's 300ms
      // entrance fade has finished. Stamping it here (before navigating) is what
      // let encode.ts open a highlight segment on a view still at opacity 0 —
      // a blank page in the gif with the shell painted around it.
      if (!beats.some((b) => b.name === act.beat)) {
        throw new Error(
          `[record] act "${act.beat}" never stamped its beat — encode.ts cuts on ` +
            `beat names, so this would mis-cut the highlight reel. Pass the beat ` +
            `name to arrive() in tour.ts.`,
        );
      }
      // Close the act. encode.ts clamps every highlight segment to end before
      // this, minus a margin: a segment that ran past it bled into the NEXT
      // act's 300ms entrance fade and ended on a blank page. Without a recorded
      // end there is nothing to clamp against and the lengths are guesswork.
      ctx.beat(`${act.beat}:end`);
      // per-act, not once at startup: the accounts view leaked three demo paths
      // past a single startup check because it had not mounted yet
      if (demo) await assertNoLeak(page, home, act.beat);
    }
    ctx.beat('end');
    await sleep(300);

    // ---- cut ----
    recording = false;
    await app.cdp.send('Page.stopScreencast');
    for (let i = 0; i < 100 && pendingWrites > 0; i++) await sleep(100);
    if (!frames.length) throw new Error('no frames captured');
    const dur = frames[frames.length - 1].ts - frames[0].ts;
    fs.writeFileSync(
      path.join(TAKE_DIR, 'meta.json'),
      JSON.stringify({ recordedAt: new Date().toISOString(), win: WIN, frames, beats }, null, 2),
    );
    console.log(
      `[record] ${frames.length} frames over ${dur.toFixed(1)}s ` +
        `(~${(frames.length / dur).toFixed(0)} fps) → ${TAKE_DIR}`,
    );
    console.log(`[record] beats: ${beats.map((b) => b.name).join(' → ')}`);
    console.log('[record] next: tsx scripts/promo/encode.ts');
  } finally {
    stopTicker?.();
    await app.stop();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
