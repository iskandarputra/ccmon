/**
 * @file record.ts
 * @brief Films a scripted ccmon tour over CDP — synthetic data, live feed, screencast frames.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Launches the BUILT app, drives a ~32s choreography through the headline
 * views — including the multi-account dashboard — and captures compositor
 * frames via Page.startScreencast into promo/take/.
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
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import {
  DEFAULT_ROOT,
  accountProjectDirs,
  generateAccounts,
  selfCheckAccounts,
  startLiveTicker,
} from './demo-data';

const REPO = path.resolve(__dirname, '..', '..');
const TAKE_DIR = path.join(REPO, 'promo', 'take');
const FRAMES_DIR = path.join(TAKE_DIR, 'frames');
const CDP_PORT = 9223; // not 9222 — keep clear of the dev-session convention
const WIN = { width: 1600, height: 1000 };
const HERO_THEME = 'nord'; // the app default — the ad opens and closes on it
const THEME_TOUR = ['tokyo night', 'catppuccin', 'synthwave', HERO_THEME];
/** 3D finale: every data mode, bars view only ('rhythm $' mirrors rhythm). */
const SPATIAL_MODES = ['rhythm', 'models', 'projects', 'blocks', 'sessions', 'tools', 'what-if'];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- minimal CDP client ---------------------------------------------------

type CdpParams = Record<string, unknown>;
interface CdpMessage {
  id?: number;
  method?: string;
  params?: CdpParams;
  result?: CdpParams;
  error?: { message: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { res: (v: CdpParams) => void; rej: (e: Error) => void }>();
  private readonly listeners = new Map<string, (params: CdpParams) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as CdpMessage;
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result ?? {});
      } else if (msg.method) {
        this.listeners.get(msg.method)?.(msg.params ?? {});
      }
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    return new Cdp(ws);
  }

  send(method: string, params: CdpParams = {}): Promise<CdpParams> {
    return new Promise((res, rej) => {
      const id = this.nextId++;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, handler: (params: CdpParams) => void): void {
    this.listeners.set(method, handler);
  }

  close(): void {
    this.ws.close();
  }
}

async function findPageTarget(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await res.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find(
        (t) => t.type === 'page' && t.url.startsWith('file://') && t.webSocketDebuggerUrl,
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* electron not up yet */
    }
    if (Date.now() > deadline) throw new Error('CDP page target never appeared');
    await sleep(300);
  }
}

// ---- the shoot ------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function main(): Promise<void> {
  const argv = process.argv;
  const flag = (n: string): boolean => argv.includes(`--${n}`);
  const opt = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  // 1. built app present?
  const mainCjs = path.join(REPO, 'dist-electron', 'main.cjs');
  const indexHtml = path.join(REPO, 'dist', 'renderer', 'index.html');
  if (flag('rebuild') || !fs.existsSync(mainCjs) || !fs.existsSync(indexHtml)) {
    console.log('[record] building app…');
    const b = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build failed');
  }

  // 2. throwaway $HOME (isolated userData) — demo data only when asked
  const demo = flag('demo');
  const fakeHome = demo ? DEFAULT_ROOT : path.join(os.tmpdir(), 'ccmon-real-home');
  if (demo) {
    if (!flag('skip-gen')) {
      const sums = generateAccounts(fakeHome, {
        days: Number(opt('days') ?? 75),
        seed: Number(opt('seed') ?? 20260612),
      });
      const files = sums.reduce((n, s) => n + s.files, 0);
      const lines = sums.reduce((n, s) => n + s.lines, 0);
      console.log(`[record] demo data: ${sums.length} accounts, ${files} sessions, ${lines} lines`);
      await selfCheckAccounts(fakeHome);
    }
  } else {
    // film the real ~/.claude; make sure no stale demo tree shadows it
    fs.rmSync(path.join(fakeHome, '.claude'), { recursive: true, force: true });
  }
  const cfgDir = path.join(fakeHome, '.config', 'ccmon');
  fs.mkdirSync(cfgDir, { recursive: true });
  const settings: Record<string, unknown> = { theme: HERO_THEME, pricingOffline: true };
  // demo: scope every view to all synthetic accounts at once, so the data
  // views read full and the accounts dashboard shows "all in view".
  if (demo) settings.sources = accountProjectDirs(fakeHome);
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(
    path.join(cfgDir, 'window-state.json'),
    JSON.stringify({ x: 80, y: 80, width: WIN.width, height: WIN.height, maximized: false }),
  );

  fs.rmSync(TAKE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // 3. launch the built app against the fake $HOME
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fakeHome };
  for (const k of ['CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'VITE_DEV_SERVER_URL']) {
    delete env[k];
  }
  if (!demo) env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.claude');
  // demo: serve synthetic plan limits so the accounts meters + cross-account
  // headroom banner render without a real Anthropic login (see accounts.ts).
  if (demo) env.CCMON_DEMO_LIMITS = '1';
  const electronPath = require('electron') as unknown as string;
  console.log('[record] launching app — window will appear, hands off for ~45s');
  const el: ChildProcess = spawn(
    electronPath,
    ['--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, '.'],
    { cwd: REPO, env, stdio: 'inherit' },
  );
  let elExited = false;
  el.on('exit', () => {
    elExited = true;
  });

  let cdp: Cdp | null = null;
  let stopTicker: (() => void) | null = null;
  try {
    cdp = await Cdp.connect(await findPageTarget(CDP_PORT, 30_000));
    const c = cdp;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    // animations must run regardless of the host's reduced-motion setting
    await c.send('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });

    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await c.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return ((r.result as CdpParams | undefined)?.value ?? null) as T;
    };
    const key = (k: string): Promise<unknown> =>
      evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
    const box = (sel: string, nth = 0): Promise<Box | null> =>
      evaluate<Box | null>(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(sel)})[${nth}];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`);
    const mouseMove = (x: number, y: number): Promise<CdpParams> =>
      c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
    const wheel = async (dy: number, sel = '.content'): Promise<void> => {
      const b = await box(sel);
      if (!b) return;
      await c.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(b.x + b.w / 2),
        y: Math.round(b.y + b.h / 2),
        deltaX: 0,
        deltaY: dy,
      });
    };
    const glide = async (points: Array<{ x: number; y: number }>, ms: number): Promise<void> => {
      if (points.length < 2) return sleep(ms);
      const segs = points.length - 1;
      const steps = Math.max(6, Math.round(ms / 33 / segs));
      for (let s = 0; s < segs; s++) {
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const ease = f * f * (3 - 2 * f);
          await mouseMove(
            points[s].x + (points[s + 1].x - points[s].x) * ease,
            points[s].y + (points[s + 1].y - points[s].y) * ease,
          );
          await sleep(ms / segs / steps);
        }
      }
    };
    /** Hover a few discrete points (≤3 stops) — calmer than a full sweep. */
    const hoverStops = async (sel: string, fractions: number[], pauseMs: number): Promise<void> => {
      const b = await box(sel);
      if (!b) return sleep(fractions.length * (pauseMs + 200));
      let prev: { x: number; y: number } | null = null;
      for (const f of fractions) {
        const target = { x: b.x + 14 + (b.w - 28) * f, y: b.y + b.h * 0.55 };
        if (prev) await glide([prev, target], 200);
        else await mouseMove(target.x, target.y);
        prev = target;
        await sleep(pauseMs);
      }
    };
    const clickTheme = async (id: string): Promise<void> => {
      const ok = await evaluate<boolean>(`(() => {
        const cards = [...document.querySelectorAll('.set-theme-card')];
        const card = cards.find((el) =>
          ((el.querySelector('.set-theme-name')?.textContent) || '').trim().toLowerCase().startsWith(${JSON.stringify(id.toLowerCase())}));
        if (!card) return false;
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.click();
        return true;
      })()`);
      if (!ok) {
        console.warn(`[record] theme card "${id}" not found — using settings API`);
        await evaluate(`window.ccmon?.setSettings({ theme: ${JSON.stringify(id)} })`);
      }
    };
    const clickRail = async (label: string): Promise<void> => {
      const ok = await evaluate<boolean>(`(() => {
        const btn = [...document.querySelectorAll('.spa-rail-btn')]
          .find((el) => (el.textContent || '').trim() === ${JSON.stringify(label)});
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (!ok) console.warn(`[record] rail button "${label}" not found`);
    };
    /** Click a sidebar nav item by its label — settings has no number hotkey. */
    const clickNav = async (label: string): Promise<void> => {
      const ok = await evaluate<boolean>(`(() => {
        const item = [...document.querySelectorAll('.nav-item')]
          .find((el) => ((el.querySelector('.nav-label')?.textContent) || '').trim() === ${JSON.stringify(label)});
        if (!item) return false;
        item.click();
        return true;
      })()`);
      if (!ok) console.warn(`[record] nav item "${label}" not found`);
    };

    // 4. wait for the snapshot to land (real datasets take a few seconds)
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      ready = await evaluate<boolean>(`!!document.querySelector('.stat-value')?.textContent`);
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('app never reached ready (.stat-value empty)');

    if (demo) {
      // the statusbar prints the data dir — keep the throwaway path off camera
      await evaluate(`(() => {
        const fix = () => {
          const el = document.querySelector('.sb-link');
          if (el && el.textContent !== '~/.claude/projects') el.textContent = '~/.claude/projects';
        };
        fix();
        new MutationObserver(fix).observe(document.body, { childList: true, subtree: true, characterData: true });
      })()`);
    }

    // 5. prewarm the lazy three.js chunk so the finale cuts in clean
    await key('4');
    for (let i = 0; i < 16; i++) {
      if (await evaluate<boolean>(`!!document.querySelector('.spa-rail')`)) break;
      await sleep(500);
    }
    await sleep(2500);
    await key('1');
    await sleep(900);

    // 6. demo mode fakes a live feed; real mode relies on actual activity
    if (demo) {
      stopTicker = startLiveTicker(fakeHome, Number(opt('seed') ?? 20260612) + 1);
      await sleep(4200);
    } else {
      await sleep(1200);
    }

    // 7. roll camera
    const frames: Array<{ file: string; ts: number }> = [];
    const beats: Array<{ name: string; t: number }> = [];
    let pendingWrites = 0;
    let recording = true;
    c.on('Page.screencastFrame', (p) => {
      void c.send('Page.screencastFrameAck', { sessionId: p.sessionId });
      if (!recording) return;
      const meta = p.metadata as { timestamp?: number } | undefined;
      const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
      frames.push({ file, ts: meta?.timestamp ?? Date.now() / 1000 });
      pendingWrites++;
      fs.writeFile(path.join(FRAMES_DIR, file), Buffer.from(String(p.data), 'base64'), (err) => {
        pendingWrites--;
        if (err) console.error('[record] frame write failed:', err.message);
      });
    });
    const beat = (name: string): void => {
      beats.push({ name, t: Date.now() / 1000 });
      console.log(`[record] ▸ ${name}`);
    };

    await c.send('Page.bringToFront');
    await c.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: 3200,
      maxHeight: 2000,
      everyNthFrame: 1,
    });

    // ---- choreography (~32s) ----
    // act 1 — the hero opener
    beat('overview');
    await sleep(400);
    const statBoxes: Box[] = [];
    for (let i = 0; i < 2; i++) {
      const b = await box('.g3', i);
      if (b) statBoxes.push(b);
    }
    await glide(statBoxes.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })), 800);
    await sleep(500);

    // act 2 — the analytics sweep
    await key('2');
    beat('activity');
    await sleep(700);
    await hoverStops('.recharts-wrapper', [0.3, 0.45, 0.6], 420); // 3 bars, no more
    await sleep(600);

    await key('3');
    beat('insights');
    await sleep(2200);

    await key('7');
    beat('models');
    await sleep(500);
    await hoverStops('.recharts-wrapper', [0.35, 0.6], 420);
    await sleep(600);

    await key('8');
    beat('projects');
    await sleep(2000);

    await key('6');
    beat('blocks');
    await sleep(2200);

    // act 3 — the multi-account dashboard + cross-account headroom
    await key('9');
    beat('accounts');
    // limits poll fires at startup, but wait for the banner to be safe on camera
    for (let i = 0; i < 12; i++) {
      if (await evaluate<boolean>(`!!document.querySelector('.acc-headroom')`)) break;
      await sleep(250);
    }
    await sleep(1100);
    await evaluate(
      `document.querySelector('.acc-headroom')?.scrollIntoView({ block: 'start', behavior: 'smooth' })`,
    );
    await sleep(900);
    await hoverStops('.hr-cmd', [0.5, 0.85], 480); // the ready-to-run resume command
    await sleep(700);
    await wheel(360, '.content'); // pan down across the per-account cards + meters
    await sleep(1500);

    // act 4 — make it yours: settings has no number hotkey now, open the rail
    await clickNav('settings');
    beat('themes');
    await sleep(500);
    // reveal the full theme collection — the newer themes live past the first 8
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((el) => ((el.textContent) || '').trim().toLowerCase().startsWith('reveal all'));
      if (btn) btn.click();
    })()`);
    await sleep(450);
    await evaluate(
      `document.querySelector('.set-themes')?.scrollIntoView({ block: 'center', behavior: 'smooth' })`,
    );
    await sleep(500);
    for (const t of THEME_TOUR) {
      await clickTheme(t);
      await sleep(650);
    }

    // finale: every data mode in 3D, bars only, with a slow dolly-in
    await key('4');
    beat('spatial');
    await sleep(1500);
    for (let i = 0; i < SPATIAL_MODES.length; i++) {
      await clickRail(SPATIAL_MODES[i]);
      if (i === 0) beat('spatial-modes');
      if (i === 2 || i === 4) {
        await wheel(-130, 'canvas'); // zoom in as the shapes morph
        await sleep(120);
        await wheel(-130, 'canvas');
        await sleep(860);
      } else {
        await sleep(950);
      }
    }
    await wheel(110, 'canvas'); // ease back out for the closing frame
    await sleep(900);
    beat('end');
    await sleep(300);

    // 8. cut
    recording = false;
    await c.send('Page.stopScreencast');
    for (let i = 0; i < 100 && pendingWrites > 0; i++) await sleep(100);
    if (!frames.length) throw new Error('no frames captured');
    const dur = frames[frames.length - 1].ts - frames[0].ts;
    fs.writeFileSync(
      path.join(TAKE_DIR, 'meta.json'),
      JSON.stringify({ recordedAt: new Date().toISOString(), win: WIN, frames, beats }, null, 2),
    );
    console.log(
      `[record] ${frames.length} frames over ${dur.toFixed(1)}s (~${(frames.length / dur).toFixed(0)} fps) → ${TAKE_DIR}`,
    );
    console.log('[record] next: tsx scripts/promo/encode.ts');
  } finally {
    stopTicker?.();
    cdp?.close();
    if (!elExited) {
      el.kill('SIGTERM');
      await Promise.race([new Promise<void>((r) => el.once('exit', () => r())), sleep(3000)]);
      if (!elExited) el.kill('SIGKILL');
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
