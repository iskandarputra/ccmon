/**
 * @file cdp.ts
 * @brief Shared Chrome DevTools Protocol harness — client, app launch, input verbs.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Both promo consumers drive the SAME built app the same way, so the client,
 * the launch/teardown dance and the input verbs live here rather than in each:
 *
 *   record.ts  films a choreographed tour  (Page.startScreencast)
 *   shots.ts   captures one still per view (Page.captureScreenshot)
 *
 * This also replaced scripts/capture-views.mjs, which carried a second copy of
 * the client, its own port, and a hardcoded 1-9 view map that the sidebar had
 * long since reordered out from under it.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

export const REPO = path.resolve(__dirname, '..', '..');
/** Not 9222 — that port is the dev-session convention and would collide. */
export const CDP_PORT = 9223;
export const WIN = { width: 1600, height: 1000 };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- minimal CDP client ---------------------------------------------------

export type CdpParams = Record<string, unknown>;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: CdpParams;
  result?: CdpParams;
  error?: { message: string };
}

export class Cdp {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { res: (v: CdpParams) => void; rej: (e: Error) => void }
  >();
  private readonly listeners = new Map<string, (params: CdpParams) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      // RawData is Buffer | ArrayBuffer | Buffer[]; String() on the array form
      // yields comma-joined garbage, so normalise before parsing.
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as ArrayBuffer).toString('utf8');
      const msg = JSON.parse(text) as CdpMessage;
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

  /**
   * Every call is bounded. A wedged renderer used to leave the promise pending
   * forever, so the shoot burned its whole timeout and died with no clue which
   * step stalled — the log just stopped mid-act, in a different act each run.
   * Failing here names the method instead.
   */
  send(method: string, params: CdpParams = {}, timeoutMs = 30_000): Promise<CdpParams> {
    return new Promise((res, rej) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`[promo] CDP ${method} did not answer in ${timeoutMs}ms (renderer wedged?)`));
      }, timeoutMs);
      this.pending.set(id, {
        res: (v) => {
          clearTimeout(timer);
          res(v);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
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
      const targets = (await res.json()) as Array<{
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }>;
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

// ---- the built app --------------------------------------------------------

/** Newest mtime under `dir`, skipping the usual noise. 0 when absent. */
function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/**
 * Build the app if it is missing OR STALE.
 *
 * The staleness half is not a nicety. This used to check existence only, so a
 * `dist/` built before a renderer change was filmed as-is: the recording ran
 * against the previous build, and the tour failed on a view whose fix was
 * sitting un-built on disk. A promo run must film the working tree, or the
 * footage documents something that no longer exists.
 */
export function ensureBuilt(rebuild = false): void {
  const mainCjs = path.join(REPO, 'dist-electron', 'main.cjs');
  const indexHtml = path.join(REPO, 'dist', 'renderer', 'index.html');
  const missing = !fs.existsSync(mainCjs) || !fs.existsSync(indexHtml);

  let stale = false;
  if (!missing) {
    const built = Math.min(fs.statSync(mainCjs).mtimeMs, fs.statSync(indexHtml).mtimeMs);
    const newestSrc = Math.max(
      newestMtime(path.join(REPO, 'src')),
      newestMtime(path.join(REPO, 'electron')),
      newestMtime(path.join(REPO, 'shared')),
    );
    stale = newestSrc > built;
    if (stale) {
      console.log('[promo] build is older than src/ — rebuilding so the film matches the tree');
    }
  }

  if (rebuild || missing || stale) {
    console.log('[promo] building app…');
    const b = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build failed');
  }
}

export interface LaunchOpts {
  /** $HOME the app runs against — a throwaway dir keeps userData isolated. */
  home: string;
  /** Synthetic world (demo-data.ts) rather than the operator's real ~/.claude. */
  demo: boolean;
  theme: string;
}

export interface Launched {
  cdp: Cdp;
  proc: ChildProcess;
  /** Kills the app and closes the socket; safe to call twice. */
  stop: () => Promise<void>;
}

/** Write the settings + window geometry the shoot depends on into `home`. */
export function writeAppConfig(
  home: string,
  settings: Record<string, unknown>,
): void {
  const cfgDir = path.join(home, '.config', 'ccmon');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(
    path.join(cfgDir, 'window-state.json'),
    JSON.stringify({ x: 80, y: 80, width: WIN.width, height: WIN.height, maximized: false }),
  );
}

export async function launch(opts: LaunchOpts): Promise<Launched> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: opts.home };
  for (const k of [
    'CLAUDE_CONFIG_DIR',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_STATE_HOME',
    'VITE_DEV_SERVER_URL',
  ]) {
    delete env[k];
  }
  if (!opts.demo) env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.claude');
  // demo: serve synthetic plan limits so the accounts meters + cross-account
  // headroom banner render without a real Anthropic login (see accounts.ts).
  if (opts.demo) env.CCMON_DEMO_LIMITS = '1';

  const electronPath = require('electron') as unknown as string;
  const proc = spawn(
    electronPath,
    ['--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, '.'],
    { cwd: REPO, env, stdio: 'inherit' },
  );
  let exited = false;
  proc.on('exit', () => {
    exited = true;
  });

  const cdp = await Cdp.connect(await findPageTarget(CDP_PORT, 30_000));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // animations must run regardless of the host's reduced-motion setting
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  const stop = async (): Promise<void> => {
    cdp.close();
    if (exited) return;
    proc.kill('SIGTERM');
    await Promise.race([new Promise<void>((r) => proc.once('exit', () => r())), sleep(3000)]);
    if (!exited) proc.kill('SIGKILL');
  };

  return { cdp, proc, stop };
}

// ---- input + DOM verbs ----------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The verb set both consumers drive the page with. */
export class Page {
  constructor(private readonly c: Cdp) {}

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.c.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return ((r.result as CdpParams | undefined)?.value ?? null) as T;
  }

  /** A view hotkey. Callers get the digit from tour.ts, never by hand. */
  key(k: string): Promise<unknown> {
    return this.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`,
    );
  }

  exists(sel: string): Promise<boolean> {
    return this.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  }

  count(sel: string): Promise<number> {
    return this.evaluate<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  }

  box(sel: string, nth = 0): Promise<Box | null> {
    return this.evaluate<Box | null>(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(sel)})[${nth}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
  }

  /** Poll until `sel` is present. Returns false on timeout — callers decide. */
  async waitFor(sel: string, timeoutMs = 8000, stepMs = 250): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.exists(sel)) return true;
      if (Date.now() > deadline) return false;
      await sleep(stepMs);
    }
  }

  scrollTo(sel: string, block: 'start' | 'center' = 'center'): Promise<unknown> {
    return this.evaluate(
      `document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'smooth' })`,
    );
  }

  /** Click the first element whose trimmed textContent equals `text`. */
  clickByText(sel: string, text: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  click(sel: string, nth = 0): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(sel)})[${nth}];
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  mouseMove(x: number, y: number): Promise<CdpParams> {
    return this.c.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  /**
   * Scroll by script rather than by a synthetic wheel event.
   *
   * Prefer this over `wheel()` for ordinary panning. Synthetic INPUT on the
   * heavier views stalls the renderer past a 30s CDP timeout under screencast
   * load — analytics and projects both did — because every mouse event runs
   * App.tsx#useSpotlight over a very large tree. A scrollTop write repaints
   * without touching the input pipeline. `wheel()` remains for the 3D canvas,
   * where the zoom genuinely needs a real wheel event.
   */
  async scrollBy(dy: number, sel = '.content'): Promise<void> {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (el) el.scrollTop += ${dy};
    })()`);
  }

  async wheel(dy: number, sel = '.content'): Promise<void> {
    const b = await this.box(sel);
    if (!b) return;
    await this.c.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(b.x + b.w / 2),
      y: Math.round(b.y + b.h / 2),
      deltaX: 0,
      deltaY: dy,
    });
  }

  /** Smoothstep the cursor through `points` over `ms` total. */
  async glide(points: Array<{ x: number; y: number }>, ms: number): Promise<void> {
    if (points.length < 2) return sleep(ms);
    const segs = points.length - 1;
    const steps = Math.max(6, Math.round(ms / 33 / segs));
    for (let s = 0; s < segs; s++) {
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const ease = f * f * (3 - 2 * f);
        await this.mouseMove(
          points[s].x + (points[s + 1].x - points[s].x) * ease,
          points[s].y + (points[s + 1].y - points[s].y) * ease,
        );
        await sleep(ms / segs / steps);
      }
    }
  }

  /** Hover a few discrete points across `sel` (<=3 stops) — calmer than a sweep. */
  async hoverStops(sel: string, fractions: number[], pauseMs: number): Promise<void> {
    const b = await this.box(sel);
    if (!b) return sleep(fractions.length * (pauseMs + 200));
    let prev: { x: number; y: number } | null = null;
    for (const f of fractions) {
      const target = { x: b.x + 14 + (b.w - 28) * f, y: b.y + b.h * 0.55 };
      if (prev) await this.glide([prev, target], 200);
      else await this.mouseMove(target.x, target.y);
      prev = target;
      await sleep(pauseMs);
    }
  }

  /** Park the cursor off every interactive surface so no tooltip is stuck open. */
  parkCursor(): Promise<CdpParams> {
    return this.mouseMove(WIN.width - 6, WIN.height - 6);
  }

  bringToFront(): Promise<CdpParams> {
    return this.c.send('Page.bringToFront');
  }

  /**
   * Kill every animation and transition. Stills only: an occluded window stops
   * compositing mid-flight, so staggered panels would otherwise capture at
   * opacity 0. Never call this before a recording.
   */
  freezeMotion(): Promise<unknown> {
    return this.evaluate(`(() => {
      const s = document.createElement('style');
      s.id = 'promo-freeze';
      s.textContent = '*,*::before,*::after { animation: none !important; transition: none !important; }';
      document.head.appendChild(s);
    })()`);
  }
}
