/**
 * @file tour.ts
 * @brief The promo choreography as data — acts, beats, and what each one shows.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Separated from record.ts so the camera work (frames, timing, teardown) and
 * the story (what we show, in what order) can change independently. encode.ts
 * cuts the highlight reel on the BEAT names declared here, so a beat rename is
 * a two-file edit by construction rather than a silent mis-cut.
 *
 * Every act navigates by a key derived from Sidebar.tsx (see views.ts) and
 * every selector it touches comes from selectors.ts, where a required miss is
 * fatal. Between them, a renderer change cannot quietly produce a wrong film.
 */

import { THEMES } from '../../src/theme/themes';
import type { Page } from './cdp';
import { sleep } from './cdp';
import { scrub } from './mask';
import { requireSel, sel, type SelectorKey } from './selectors';
import { viewById, type TourView } from './views';

/** The app default — the film opens and closes on it. */
export const HERO_THEME = 'dracula';

/**
 * Theme ids, resolved to card names via THEMES. These are IDS, not display
 * names: an earlier list used names as both, so 'synthwave' (which is not a
 * theme) matched no card and the fallback wrote an invalid id — two silent
 * no-ops. `clickTheme` now throws on an unknown id.
 * One light theme is deliberate: half the collection is light and a tour of
 * four dark themes implies otherwise.
 */
export const THEME_TOUR = ['tokyo-night', 'catppuccin', 'daylight', 'cyber-neon', HERO_THEME];

/** One step of the 3D finale. `mode`/`plot` are button LABELS, as rendered. */
interface SpatialStep {
  mode?: string;
  plot?: string;
  dwell: number;
  /** Negative dollies in, positive backs out. */
  zoom?: number;
}

/**
 * The finale — THREE renderings, not a tour of all nine data modes.
 *
 * Marching through every mode made the closing act a catalogue: each shape got
 * under a second, none of them landed, and the whole thing outstayed its
 * welcome. Three held shots of the strongest plots say more. All three stay on
 * `terrain` on purpose, so the argument is "the same month, drawn three ways"
 * rather than nine unrelated charts flashing past.
 *
 * `terrain` also has to lead: it is the flagship mode, and the previous tour
 * skipped it entirely by starting its list at `rhythm`.
 */
export const SPATIAL_FINALE: SpatialStep[] = [
  { mode: 'terrain', plot: 'bars', dwell: 2200 }, //   the calendar landscape
  { plot: 'surface', dwell: 2000 }, //                 the same month, smoothed
  { plot: 'trail', dwell: 2400 }, //                   cumulative spend, snaking
];

/**
 * No `zoom` on any step, deliberately. A dolly needs a real wheel event over
 * the WebGL canvas, and under screencast load that stalled the renderer past a
 * 30s CDP timeout — the same failure the analytics and projects acts hit with
 * synthetic input. The plots read fine from the resting orbit, and the canvas
 * animates continuously, so the compositor keeps emitting frames without help.
 */

export interface TourCtx {
  page: Page;
  views: TourView[];
  demo: boolean;
  /** The throwaway $HOME to keep off camera (demo runs only). */
  home: string;
  /** Marks a cut point encode.ts can find by name. */
  beat: (name: string) => void;
}

/**
 * How long `.view-anim` takes to fade a freshly-switched view in from
 * opacity 0 — `--dur-3` in global.css — plus margin for the first paint.
 *
 * This is load-bearing for the GIF. encode.ts cuts each highlight segment at a
 * fixed offset from a BEAT, and beats used to be stamped before navigating, so
 * a segment could open on a view that was still transparent. Raw takes contain
 * fully blank content areas for exactly this reason: shell painted, view at
 * opacity 0. Stamping the beat only after the entrance has finished means an
 * offset of 0 is already a fully-painted view.
 */
const VIEW_ENTRANCE_MS = 300;
const SETTLE_MS = VIEW_ENTRANCE_MS + 220;

/**
 * Navigate by the view's real hotkey (falling back to its sidebar button), wait
 * out the entrance animation, and only then stamp the beat.
 */
async function arrive(ctx: TourCtx, id: string, beat?: string): Promise<void> {
  const v = viewById(ctx.views, id);
  if (v.key) {
    await ctx.page.key(v.key);
  } else {
    const ok = await ctx.page.clickByText(sel('navLabel'), v.label);
    if (!ok) throw new Error(`[promo] cannot reach view "${id}": no hotkey and no nav button`);
  }
  await sleep(SETTLE_MS);
  // Scrub the new view's content BEFORE the beat is stamped, so no frame of it
  // is ever captured carrying the throwaway path. Per-navigation rather than a
  // live observer: see the note at the top of mask.ts.
  if (ctx.demo) await scrub(ctx.page, ctx.home);
  if (beat) ctx.beat(beat);
}

/** Assert the view actually rendered before we spend screen time on it. */
async function expect(ctx: TourCtx, ...keys: SelectorKey[]): Promise<void> {
  for (const k of keys) {
    await ctx.page.waitFor(sel(k), 6000);
    await requireSel((s) => ctx.page.exists(s), k);
  }
}

/**
 * Below this the knowledge graph is just its own root node — nothing to film.
 * Root plus a couple of real hotspots is the least that reads as a graph.
 */
const MIN_GRAPH_NODES = 4;

/** Parse "N nodes · M connections" out of the graph's stats badge. */
async function graphNodeCount(ctx: TourCtx): Promise<number> {
  const text = await ctx.page.evaluate<string>(
    `document.querySelector(${JSON.stringify(sel('knowledgeStats'))})?.textContent ?? ''`,
  );
  return Number(/(\d+)\s+nodes/.exec(text ?? '')?.[1] ?? 0);
}

/**
 * Move the cursor to the middle of `sel` once and hold. Deliberately a single
 * event: the heavier views re-render on every mousemove (spotlight + recharts
 * tooltips), and a multi-step glide across them stalls the renderer.
 */
async function hoverOnce(ctx: TourCtx, selector: string, holdMs: number): Promise<void> {
  const b = await ctx.page.box(selector);
  if (!b) {
    await sleep(holdMs);
    return;
  }
  await ctx.page.mouseMove(b.x + b.w * 0.45, b.y + b.h * 0.55);
  await sleep(holdMs);
}

/**
 * Hold on the current view for `ms`, nudging the scroll by a pixel a few times
 * so the compositor actually emits frames.
 *
 * `Page.startScreencast` only produces a frame when something CHANGES. A still
 * dwell produces none, and encode.ts then holds the last frame it did get
 * across the whole gap — which is a frame of whatever was on screen BEFORE the
 * dwell. Measured: the projects act sat on the grid for 2.4s and emitted zero
 * frames, so the gif showed the knowledge graph (the previous, animating
 * screen) for that entire segment. The beat was right; there was simply no
 * picture of the grid to cut to.
 *
 * A 1px scroll and back is imperceptible and guarantees a frame. Use this
 * instead of `sleep()` for any dwell the gif is meant to show.
 */
async function dwell(ctx: TourCtx, ms: number): Promise<void> {
  const step = 500;
  let elapsed = 0;
  let n = 0;
  while (elapsed < ms) {
    const slice = Math.min(step, ms - elapsed);
    await sleep(slice);
    elapsed += slice;
    n++;
    // A sub-perceptual opacity flip on the status bar, applied by SCRIPT.
    //
    // Two constraints force this shape. It must not go through synthetic INPUT:
    // a single mouse or wheel event on the heavier views stalls the renderer
    // past a 30s CDP timeout (App.tsx#useSpotlight runs on every one). And it
    // must not depend on the view being scrollable: nudging `.content`'s
    // scrollTop was the first attempt, and it silently did nothing on the
    // accounts view, whose content fits — so that dwell still emitted no frames.
    // An opacity change always repaints, on every view, at 0.4% no one can see.
    await ctx.page.evaluate(`(() => {
      const el = document.querySelector('.statusbar');
      if (el) el.style.opacity = ${n % 2 === 0 ? "'1'" : "'0.996'"};
    })()`);
  }
  await ctx.page.evaluate(`(() => {
    const el = document.querySelector('.statusbar');
    if (el) el.style.opacity = '1';
  })()`);
}

/** Click a `.pill` by its exact label, failing with what was actually there. */
async function clickPill(ctx: TourCtx, label: string): Promise<void> {
  if (await ctx.page.clickByText(sel('pill'), label)) {
    await sleep(400);
    return;
  }
  const have = await ctx.page.evaluate<string[]>(
    `[...document.querySelectorAll(${JSON.stringify(sel('pill'))})].map((b) => (b.textContent||'').trim())`,
  );
  throw new Error(
    `[promo] pill "${label}" not found on screen (have: ${(have ?? []).join(', ')})`,
  );
}

async function clickTheme(ctx: TourCtx, id: string): Promise<void> {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`[promo] no such theme id: ${id}`);
  const ok = await ctx.page.evaluate<boolean>(`(() => {
    const cards = [...document.querySelectorAll(${JSON.stringify(sel('themeCard'))})];
    const card = cards.find((el) =>
      ((el.querySelector(${JSON.stringify(sel('themeName'))})?.textContent) || '')
        .trim().toLowerCase().startsWith(${JSON.stringify(theme.name.toLowerCase())}));
    if (!card) return false;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.click();
    return true;
  })()`);
  if (!ok) throw new Error(`[promo] theme card "${theme.name}" (${id}) not found in the grid`);
}

/** Click a labelled button inside the 3D control bar. */
async function spatialButton(ctx: TourCtx, key: SelectorKey, label: string): Promise<void> {
  const ok = await ctx.page.clickByText(sel(key), label);
  if (!ok) {
    const have = await ctx.page.evaluate<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(sel(key))})].map((b) => (b.textContent||'').trim())`,
    );
    throw new Error(
      `[promo] 3d button "${label}" not found (have: ${(have ?? []).join(', ')}) — ` +
        `SPATIAL_FINALE labels must match SpatialView's MODES/PLOTS as rendered`,
    );
  }
}

export interface Act {
  /** Beat name — encode.ts cuts the highlight reel on these. */
  beat: string;
  run: (ctx: TourCtx) => Promise<void>;
}

/**
 * The tour, ~46s. Order is the argument the film makes: what you spent, what
 * it means, where it went, across which accounts, what to do about it — then
 * the toys.
 */
export const ACTS: Act[] = [
  {
    // act 1 — the hero opener: today's numbers, live feed ticking
    beat: 'pulse',
    run: async (ctx) => {
      await arrive(ctx, 'overview', 'pulse');
      await expect(ctx, 'statCard');
      const boxes = [];
      for (let i = 0; i < 3; i++) {
        const b = await ctx.page.box(sel('statCard'), i);
        if (b) boxes.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      }
      await ctx.page.glide(boxes, 1000);
      await sleep(900);
      await ctx.page.parkCursor();
    },
  },
  {
    // act 2 — analytics: the merged dashboard and its three lenses
    beat: 'analytics',
    run: async (ctx) => {
      await arrive(ctx, 'insights', 'analytics');
      await expect(ctx, 'analyticsTabs');
      await dwell(ctx, 1600);
      // NO synthetic input anywhere in this act — no hover, no wheel. Analytics
      // mounts every economics panel and a dozen recharts surfaces at once, and
      // App.tsx#useSpotlight does a getBoundingClientRect plus a style write on
      // every mouse event; under screencast load a SINGLE one stalled the
      // renderer past a 30s CDP timeout. The tab switches are real DOM updates,
      // so they repaint on their own and the compositor keeps emitting frames.
      await dwell(ctx, 900);
      await clickPill(ctx, 'timelines & burn');
      await dwell(ctx, 1800);
      await clickPill(ctx, 'intelligence & roi');
      await dwell(ctx, 1800);
    },
  },
  {
    // act 3 — projects: the same data in three layouts, ending on the grid.
    // ProjectsView opens in 'split'; `.prj-card` only exists in 'grid' and the
    // graph canvas only in 'knowledge graph', so the act drives the mode pills
    // rather than assuming what is on screen.
    //
    // The beat is stamped LATE here — on the grid, not on arrival. This act
    // branches (the graph is skipped when it has no hotspots), so its internal
    // timings shift by more than a second between runs and any fixed offset
    // from arrival lands somewhere different each time. A beat marks the moment
    // worth filming, so for a branching act it belongs at that moment.
    beat: 'projects',
    run: async (ctx) => {
      await arrive(ctx, 'projects');
      await expect(ctx, 'pill');
      await sleep(1400); // the default split view: master list + detail pane
      await ctx.page.scrollBy(280);
      await sleep(900);

      await clickPill(ctx, 'knowledge graph');
      await expect(ctx, 'knowledgeGraph', 'knowledgeStats');
      await sleep(1200); // the force-directed layout needs a beat to settle

      // The graph is built from FILE HOTSPOTS. A corpus without per-file tool
      // usage — the synthetic demo world is one — yields the root node and
      // nothing else, which films as "1 nodes · 0 connections" on an empty
      // canvas and reads as a broken feature rather than an unused one.
      // So show it only when it has something to show.
      const nodes = await graphNodeCount(ctx);
      if (nodes >= MIN_GRAPH_NODES) {
        await sleep(1600);
      } else {
        console.warn(
          `[promo] knowledge graph has ${nodes} node(s) — too sparse to film, ` +
            `showing the project grid instead. (The demo corpus records no ` +
            `per-file tool usage, so hotspots come out empty.)`,
        );
      }

      // End on the grid: always populated, and the strongest frame for the gif.
      // The dwell is long on purpose — encode.ts clamps the projects highlight
      // to this act, so a short tail here starves the segment.
      await clickPill(ctx, 'grid');
      await expect(ctx, 'projectCard');
      await sleep(500); // let the cards' stagger finish before the beat
      ctx.beat('projects');
      await dwell(ctx, 2400);
      await ctx.page.parkCursor();
    },
  },
  {
    // act 4 — the multi-account dashboard and the cross-account resume command
    beat: 'accounts',
    run: async (ctx) => {
      await arrive(ctx, 'accounts', 'accounts');
      await expect(ctx, 'accountGrid');
      await dwell(ctx, 1200);
      // the limits poll fires at startup; wait for the banner rather than guess
      await ctx.page.waitFor(sel('headroom'), 4000);
      await expect(ctx, 'headroom', 'resumeCmd');
      await ctx.page.scrollTo(sel('headroom'), 'start');
      await dwell(ctx, 1000);
      await hoverOnce(ctx, sel('resumeCmd'), 1100);
      await dwell(ctx, 700);
      await ctx.page.scrollBy(380); // pan across the per-account cards + meters
      await dwell(ctx, 1500);
      await ctx.page.parkCursor();
    },
  },
  {
    // act 5 — the advisor. Chips are HOVERED, never clicked: a click would fire
    // a real Messages API request from a recording session.
    beat: 'advisor',
    run: async (ctx) => {
      await arrive(ctx, 'advisor', 'advisor');
      await expect(ctx, 'advisorGrid', 'advisorChip');
      await dwell(ctx, 1100);
      await hoverOnce(ctx, sel('advisorChip'), 900);
      await sleep(900);
      await ctx.page.parkCursor();
    },
  },
  {
    // act 6 — make it yours
    beat: 'themes',
    run: async (ctx) => {
      await arrive(ctx, 'settings', 'themes');
      await expect(ctx, 'themeGrid', 'themeCard');
      await sleep(500);
      // reveal the full collection — the newer themes live past the first 8.
      // Matched by CLASS: the button's copy changed once ("reveal all" →
      // "all themes · N") and a copy match silently stopped expanding it.
      await ctx.page.evaluate(`(() => {
        const btn = document.querySelector(${JSON.stringify(sel('themeReveal'))});
        if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
      })()`);
      await sleep(450);
      await ctx.page.scrollTo(sel('themeGrid'));
      await sleep(500);
      for (const t of THEME_TOUR) {
        await clickTheme(ctx, t);
        await sleep(680);
      }
      await ctx.page.parkCursor();
    },
  },
  {
    // finale — the 3D canvas
    beat: 'spatial',
    run: async (ctx) => {
      await arrive(ctx, 'spatial', 'spatial');
      await expect(ctx, 'spatialStudio', 'spatialControls', 'canvas');
      await sleep(1400);
      for (let i = 0; i < SPATIAL_FINALE.length; i++) {
        const step = SPATIAL_FINALE[i];
        if (step.mode) await spatialButton(ctx, 'spatialModeBtn', step.mode);
        if (step.plot) await spatialButton(ctx, 'spatialPlotBtn', step.plot);
        if (i === 0) ctx.beat('spatial-modes');
        if (step.zoom) {
          await ctx.page.wheel(step.zoom, sel('canvas'));
          await sleep(140);
          await ctx.page.wheel(step.zoom, sel('canvas'));
        }
        await sleep(step.dwell);
      }
    },
  },
];

/**
 * Views that get a still in docs/media/ for the README gallery, in the order
 * the README shows them.
 *
 * This list is exactly the SIDEBAR pages — see views.ts#loadSidebarViews. VIEWS
 * still carries `sessions`, `blocks`, `models` and `links`, which the sidebar no
 * longer renders; they are reachable by number key but are not pages of the app
 * any more, and one of them no longer renders its own content at all. Filming
 * them is how the previous take ended up showing a page that had been removed.
 * `promo-contract.test.ts` asserts this stays in step with the rail.
 */
export const SHOT_VIEWS: Array<{ id: string; file: string; caption: string }> = [
  { id: 'overview', file: 'pulse', caption: 'Pulse — today, this block, and live plan limits' },
  { id: 'insights', file: 'analytics', caption: 'Analytics — economics, ROI and forecasting' },
  { id: 'projects', file: 'projects', caption: 'Projects — spend per repo, four ways to slice it' },
  { id: 'accounts', file: 'accounts', caption: 'Accounts — every login, plan and limit side by side' },
  { id: 'spatial', file: 'spatial', caption: '3D canvas — nine data modes, seven renderings' },
  { id: 'advisor', file: 'advisor', caption: 'AI advisor — ask questions about your own usage' },
  { id: 'settings', file: 'settings', caption: 'Settings — seventeen themes, 160+ currencies' },
];
