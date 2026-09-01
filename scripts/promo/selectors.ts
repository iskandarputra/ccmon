/**
 * @file selectors.ts
 * @brief Every DOM hook the promo pipeline depends on, in one auditable table.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The tour used to carry its selectors inline, and every miss was a
 * `console.warn` that let the shoot continue. When the renderer was reworked,
 * six of them went stale at once and the recording kept exiting 0:
 *
 *   .sb-link   → .sb-dir-link    the throwaway $HOME path stopped being masked
 *                                and was published in the README gif
 *   .hr-cmd    → .acc-cmd-pill   the cross-resume hover became a no-op
 *   .spa-rail  → .spa-control-bar the three.js prewarm fell through, so the
 *                                finale cut in on an empty canvas
 *
 * So: one table, each entry tagged `required` or `optional`. A required miss
 * THROWS with the selector's name and owning file. `selectors.test.ts` greps
 * `src/` for every required entry, which turns a rename into a `npm test`
 * failure instead of a wrong film discovered weeks later.
 *
 * `owner` is the file the selector is written in — it is what the test greps,
 * and what the error message hands you to go fix.
 */

export interface SelectorDef {
  /** The CSS selector as the page sees it. */
  sel: string;
  /** Source file that renders it, relative to the repo root. */
  owner: string;
  /** What the tour uses it for — shows up in failure output. */
  note: string;
  /**
   * `false` for things that legitimately may not be on screen: panels gated on
   * data the synthetic world might not produce, and third-party markup.
   */
  required?: boolean;
  /**
   * Third-party class (recharts, three.js). Real, but not greppable in src/,
   * so the test skips it while the runtime assert still applies.
   */
  external?: boolean;
}

export const SELECTORS = {
  // ---- shell ----
  ready: {
    sel: '.stat-value',
    owner: 'src/components/cards/StatCard.tsx',
    note: 'readiness probe — a rendered snapshot has stat values',
    required: true,
  },
  content: {
    sel: '.content',
    owner: 'src/App.tsx',
    note: 'the scroll container every wheel() targets',
    required: true,
  },
  panel: {
    sel: '.panel',
    owner: 'src/components/ui/Panel.tsx',
    note: 'generic panel shell — used to confirm a view actually rendered',
    required: true,
  },
  navItem: {
    sel: '.nav-item',
    owner: 'src/components/layout/Sidebar.tsx',
    note: 'sidebar nav buttons',
    required: true,
  },
  navLabel: {
    sel: '.nav-label',
    owner: 'src/components/layout/Sidebar.tsx',
    note: 'nav button text, matched by clickNav()',
    required: true,
  },
  /**
   * The status bar shows ONE of these, and which one depends on the data:
   * a single source dir renders the raw path as `.sb-dir-link`, two or more
   * render `.sb-scope` account pills (labels only — the path lives in a title
   * tooltip that never paints on camera). So neither is individually required.
   * The demo world has two accounts and therefore renders the pills.
   *
   * What IS required is the invariant, which `assertNoHomeLeak` checks
   * directly: the throwaway $HOME must not be visible anywhere on the page.
   * Asserting the selector instead is what let a stale `.sb-link` mask fail
   * open and publish a /tmp path in the README gif.
   */
  dataDirLink: {
    sel: '.sb-dir-link',
    owner: 'src/components/layout/StatusBar.tsx',
    note: 'status bar data-dir path (single-source layout) — masked for the camera',
    required: false,
  },
  scopePills: {
    sel: '.sb-scope',
    owner: 'src/components/layout/StatusBar.tsx',
    note: 'multi-account scope pills (the demo world renders these)',
    required: false,
  },

  // ---- pulse (overview) ----
  statCard: {
    sel: '.g3',
    owner: 'src/views/OverviewView.tsx',
    note: 'the four hero stat cards the opener glides across',
    required: true,
  },
  feedItem: {
    sel: '.feed-item',
    owner: 'src/components/feed/LiveFeed.tsx',
    note: 'live feed rows — proof the ticker is landing on camera',
    required: false,
  },

  // ---- analytics (insights) ----
  analyticsTabs: {
    sel: '.ins-tab-toolbar',
    owner: 'src/views/InsightsView.tsx',
    note: 'intelligence / timelines / all-views sub-nav',
    required: true,
  },
  pill: {
    sel: '.pill',
    owner: 'src/views/InsightsView.tsx',
    note: 'tab + range pills, clicked by label',
    required: true,
  },
  chart: {
    sel: '.recharts-wrapper',
    owner: 'recharts',
    note: 'chart surface the hover stops sweep',
    required: true,
    external: true,
  },

  // ---- projects ----
  projectCard: {
    sel: '.prj-card',
    owner: 'src/views/ProjectsView.tsx',
    note: 'per-project cards — ProjectsView renders these in "grid" mode only, not the default "split"',
    required: true,
  },
  knowledgeGraph: {
    sel: '.kg-canvas',
    owner: 'src/components/knowledge/KnowledgeGraphCanvas.tsx',
    note: 'project knowledge graph canvas',
    required: true,
  },
  knowledgeToolbar: {
    sel: '.kg-toolbar',
    owner: 'src/components/knowledge/KnowledgeGraphCanvas.tsx',
    note: 'graph controls',
    required: true,
  },
  knowledgeStats: {
    sel: '.kg-stats-badge',
    owner: 'src/components/knowledge/KnowledgeGraphCanvas.tsx',
    note: '"N nodes · M connections" — read to skip the graph when it is degenerate',
    required: true,
  },

  // ---- accounts ----
  accountGrid: {
    sel: '.acc-grid',
    owner: 'src/views/AccountsView.tsx',
    note: 'the multi-account card grid',
    required: true,
  },
  accountMeter: {
    sel: '.acc-meter-card',
    owner: 'src/views/AccountsView.tsx',
    note: 'per-account plan limit meters',
    required: false,
  },
  headroom: {
    sel: '.acc-headroom',
    owner: 'src/views/AccountsView.tsx',
    note: 'cross-account rate-limit pacing banner',
    required: true,
  },
  resumeCmd: {
    sel: '.acc-cmd-pill',
    owner: 'src/views/AccountsView.tsx',
    note: 'the ready-to-run cross-resume command — the hero of the accounts act',
    required: true,
  },
  resumeCmdText: {
    sel: '.acc-cmd-text',
    owner: 'src/views/AccountsView.tsx',
    note: 'the command string itself',
    required: true,
  },

  // ---- advisor ----
  advisorGrid: {
    sel: '.adv-grid',
    owner: 'src/views/AdvisorView.tsx',
    note: 'advisor layout',
    required: true,
  },
  advisorChip: {
    sel: '.adv-chip',
    owner: 'src/views/AdvisorView.tsx',
    note: 'suggested-question chips — hovered, never clicked (no live API call on camera)',
    required: true,
  },

  // ---- orphaned views ----
  // `sessions`, `blocks`, `models` and `links` are still in VIEWS (so number
  // keys 7-0 reach them) but the sidebar no longer renders them, so they are
  // not pages of the app and the tour must not film them. Their hooks are
  // deliberately absent from this table: adding one back would let the tour
  // record a removed page again, which is exactly what happened before.
  // See views.ts#loadSidebarViews.

  // ---- settings / themes ----
  themeGrid: {
    sel: '.set-themes',
    owner: 'src/views/SettingsView.tsx',
    note: 'theme collection',
    required: true,
  },
  themeCard: {
    sel: '.set-theme-card',
    owner: 'src/views/SettingsView.tsx',
    note: 'one theme swatch — clicked by name',
    required: true,
  },
  themeName: {
    sel: '.set-theme-name',
    owner: 'src/views/SettingsView.tsx',
    note: 'theme label, matched against THEMES[].name',
    required: true,
  },
  themeReveal: {
    sel: '.set-reveal',
    owner: 'src/views/SettingsView.tsx',
    note: 'expands past the first 8 themes — matched by CLASS, never by its copy',
    required: true,
  },

  // ---- 3d ----
  spatialStudio: {
    sel: '.spa-studio',
    owner: 'src/views/SpatialView.tsx',
    note: 'root of the 3d view — the three.js chunk has landed once this exists',
    required: true,
  },
  spatialControls: {
    sel: '.spa-control-bar',
    owner: 'src/views/SpatialView.tsx',
    note: 'floating control bar; prewarm waits on this',
    required: true,
  },
  spatialModeBtn: {
    sel: '.spa-mode-btn',
    owner: 'src/views/SpatialView.tsx',
    note: 'data-mode buttons, clicked by label',
    required: true,
  },
  spatialPlotBtn: {
    sel: '.spa-plot-btn',
    owner: 'src/views/SpatialView.tsx',
    note: 'plot-type pills (bars/surface/trail/…)',
    required: true,
  },
  canvas: {
    sel: 'canvas',
    owner: 'three.js / @react-three/fiber',
    note: 'the WebGL surface the finale dollies through',
    required: true,
    external: true,
  },
} as const satisfies Record<string, SelectorDef>;

export type SelectorKey = keyof typeof SELECTORS;

/** The selector string for a key — the only way the tour should name a hook. */
export const sel = (k: SelectorKey): string => SELECTORS[k].sel;

/**
 * The demo shoot runs against a throwaway $HOME under /tmp. Nothing published
 * may show that path. Masking the one element that used to print it was too
 * narrow a guard — the class was renamed, the mask silently stopped applying,
 * and the path shipped. So check the INVARIANT: after masking, no visible text
 * anywhere on the page contains the throwaway home.
 *
 * Returns the offending text when it leaks, or null when the page is clean.
 */
export async function findHomeLeak(
  readVisibleText: () => Promise<string>,
  home: string,
): Promise<string | null> {
  const text = await readVisibleText();
  const needles = [home, home.replace(/\/+$/, '')].filter(Boolean);
  for (const n of needles) {
    const at = text.indexOf(n);
    if (at >= 0) return text.slice(Math.max(0, at - 40), at + n.length + 40).trim();
  }
  return null;
}

/**
 * Assert a required hook is on the page. A miss is fatal and names the owning
 * file, because the alternative — warn and keep filming — is what shipped a
 * broken gif last time.
 */
export async function requireSel(
  probe: (s: string) => Promise<boolean>,
  k: SelectorKey,
): Promise<void> {
  const d: SelectorDef = SELECTORS[k];
  if (await probe(d.sel)) return;
  const how = d.required
    ? `MISSING required selector`
    : `optional selector absent (continuing)`;
  const msg = `[promo] ${how}: ${k} → "${d.sel}"\n         owner: ${d.owner}\n         used for: ${d.note}`;
  if (d.required) throw new Error(msg);
  console.warn(msg);
}
