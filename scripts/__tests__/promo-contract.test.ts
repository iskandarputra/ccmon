/**
 * @file promo-contract.test.ts
 * @brief Pins the promo pipeline's contract with the renderer it films.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The promo scripts drive the app through CSS selectors, view hotkeys and
 * button labels. None of that is type-checked: the renderer can rename a class
 * or reorder VIEWS and the shoot still compiles, still runs, and still exits 0
 * — having filmed the wrong thing. That is exactly what happened, six hooks at
 * once, and it was only noticed because the published gif looked stale.
 *
 * These tests are the cheap guard: they read the real renderer source and fail
 * `npm test` the moment the promo pipeline's assumptions stop being true.
 * They cost nothing to run and need no Electron, no display and no recording.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { SELECTORS, type SelectorDef } from '../promo/selectors';
import { SPATIAL_FINALE, THEME_TOUR, HERO_THEME, ACTS, SHOT_VIEWS } from '../promo/tour';
import { loadViews, loadSidebarViews, VIEW_KEYS } from '../promo/views';
import { THEMES } from '../../src/theme/themes';

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'src');

/** Every .tsx/.ts/.css under src/, concatenated — the haystack for class greps. */
function srcCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name)) parts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(SRC);
  return parts.join('\n');
}

const CORPUS = srcCorpus();

describe('promo selectors still exist in the renderer', () => {
  const entries = Object.entries(SELECTORS) as Array<[string, SelectorDef]>;

  it.each(entries.filter(([, d]) => d.required && !d.external))(
    'required selector %s is rendered somewhere in src/',
    (_name, def) => {
      // class selectors only — the table holds no attribute or structural ones
      const cls = def.sel.replace(/^\./, '');
      expect(
        CORPUS.includes(cls),
        `${def.sel} (${def.note}) is gone from src/. Expected it in ${def.owner}. ` +
          `Update scripts/promo/selectors.ts and the tour, or the next recording ` +
          `will film the wrong thing and still exit 0.`,
      ).toBe(true);
    },
  );

  it('names the owning file for every entry, so a failure is actionable', () => {
    for (const [name, def] of entries) {
      expect(def.owner, `${name} has no owner`).toBeTruthy();
      expect(def.note, `${name} has no note`).toBeTruthy();
      if (!def.external) {
        expect(
          fs.existsSync(path.join(REPO, def.owner)),
          `${name}.owner points at ${def.owner}, which does not exist`,
        ).toBe(true);
      }
    }
  });
});

describe('view map parsed from Sidebar.tsx', () => {
  it('parses the real VIEWS literal, spread included', () => {
    const views = loadViews();
    expect(views.length).toBeGreaterThanOrEqual(8);
    // CORE_VIEWS is spread in first, so pulse must lead and own key '1'
    expect(views[0].id).toBe('overview');
    expect(views[0].key).toBe('1');
    expect(new Set(views.map((v) => v.id)).size).toBe(views.length);
  });

  it('agrees with Sidebar.tsx#VIEW_KEYS — the badge alphabet', () => {
    const src = fs.readFileSync(path.join(SRC, 'components', 'layout', 'Sidebar.tsx'), 'utf8');
    const m = src.match(/export const VIEW_KEYS = \[([^\]]+)\]/);
    expect(m, 'Sidebar.tsx no longer exports VIEW_KEYS').toBeTruthy();
    const rendered = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(rendered).toEqual([...VIEW_KEYS]);
  });

  it('gives every view a key the hotkey handler actually accepts', () => {
    // Regression: the badge printed '0' and '-' for the last two views while
    // App.tsx did `Number(e.key) - 1` — which is -1 for '0' and NaN for '-'.
    // Both badges promised a key that did nothing.
    const views = loadViews();
    for (const v of views) {
      expect(v.key, `view "${v.id}" at index ${v.index} has no hotkey`).not.toBe('');
    }
    const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
    expect(
      app.includes('viewIndexForKey'),
      'App.tsx must resolve view hotkeys through Sidebar.tsx#viewIndexForKey, ' +
        'not by doing its own arithmetic on e.key',
    ).toBe(true);
  });
});

describe('tour references only things that exist', () => {
  it('films only pages the SIDEBAR actually renders', () => {
    // The regression this pins: VIEWS still carries `sessions`, `blocks`,
    // `models` and `links`, which number keys 7-0 reach but the sidebar no
    // longer renders. The tour filmed two of them, and one — blocks — no
    // longer renders its own content, so the take contained a removed page.
    // If it is not in the left rail, it is not a page and must not be filmed.
    const sidebar = new Set(loadSidebarViews().map((v) => v.id));
    for (const s of SHOT_VIEWS) {
      expect(
        sidebar.has(s.id),
        `SHOT_VIEWS shoots "${s.id}", which the sidebar does not render — ` +
          `it is an orphaned view, not a page. Sidebar pages: ${[...sidebar].join(', ')}`,
      ).toBe(true);
    }
  });

  it('shoots every sidebar page — the gallery is the whole app', () => {
    const shot = new Set(SHOT_VIEWS.map((s) => s.id));
    for (const v of loadSidebarViews()) {
      expect(
        shot.has(v.id),
        `the sidebar renders "${v.id}" but the README gallery never shows it`,
      ).toBe(true);
    }
  });

  it('every act targets a page the sidebar renders', () => {
    const sidebar = new Set(loadSidebarViews().map((v) => v.id));
    for (const id of [
      'overview',
      'insights',
      'projects',
      'accounts',
      'advisor',
      'settings',
      'spatial',
    ]) {
      expect(sidebar.has(id), `the tour navigates to "${id}", which is not a sidebar page`).toBe(
        true,
      );
    }
  });

  it('every theme in the tour is a real theme id', () => {
    const ids = new Set(THEMES.map((t) => t.id));
    for (const id of [...THEME_TOUR, HERO_THEME]) {
      expect(ids.has(id), `THEME_TOUR names "${id}", which is not a theme id`).toBe(true);
    }
  });

  it('tours at least one light theme — half the collection is light', () => {
    const light = new Set(THEMES.filter((t) => !t.dark).map((t) => t.id));
    expect(THEME_TOUR.some((id) => light.has(id))).toBe(true);
  });

  it('every 3d mode and plot label matches SpatialView as rendered', () => {
    const spa = fs.readFileSync(path.join(SRC, 'views', 'SpatialView.tsx'), 'utf8');
    const modes = [
      ...(spa.match(/const MODES: Mode\[\] = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    const plots = [
      ...(spa.match(/const PLOTS: Plot\[\] = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    // MODE_LABELS renames a couple of ids for display; the tour clicks by label
    const labels = Object.fromEntries(
      [
        ...(spa.match(/const MODE_LABELS[^=]*= \{([^}]+)\}/)?.[1] ?? '').matchAll(
          /(\w+):\s*'([^']+)'/g,
        ),
      ].map((m) => [m[1], m[2]]),
    );
    expect(modes.length, 'could not parse MODES out of SpatialView.tsx').toBeGreaterThan(3);
    const renderedModes = new Set(modes.map((m) => labels[m] ?? m));

    for (const step of SPATIAL_FINALE) {
      if (step.mode) {
        expect(
          renderedModes.has(step.mode),
          `SPATIAL_FINALE clicks mode "${step.mode}"; rendered labels are: ${[...renderedModes].join(', ')}`,
        ).toBe(true);
      }
      if (step.plot) {
        expect(
          plots.includes(step.plot),
          `SPATIAL_FINALE clicks plot "${step.plot}"; rendered plots are: ${plots.join(', ')}`,
        ).toBe(true);
      }
    }
  });

  it('opens the finale on terrain, the flagship mode', () => {
    // the previous tour started its list at 'rhythm' and never showed terrain
    expect(SPATIAL_FINALE[0].mode).toBe('terrain');
  });
});

describe('encode cuts on beats the tour actually emits', () => {
  it('every highlight beat is declared by an act', () => {
    const enc = fs.readFileSync(path.join(REPO, 'scripts', 'promo', 'encode.ts'), 'utf8');
    const block = enc.match(/const HIGHLIGHTS[^=]*=\s*\[([\s\S]*?)\n\s*\];/)?.[1] ?? '';
    const wanted = [...block.matchAll(/\['([^']+)'/g)].map((m) => m[1]);
    expect(wanted.length, 'could not parse HIGHLIGHTS out of encode.ts').toBeGreaterThan(3);

    const emitted = new Set(ACTS.map((a) => a.beat));
    for (const a of ACTS) emitted.add(`${a.beat}:end`); // stamped by record.ts
    emitted.add('spatial-modes'); // emitted mid-act by the finale
    for (const name of wanted) {
      expect(
        emitted.has(name),
        `encode.ts cuts on beat "${name}", which no act in tour.ts emits ` +
          `(acts emit: ${[...emitted].join(', ')})`,
      ).toBe(true);
    }
  });
});

describe('README gallery', () => {
  it('shoots only views that exist, with unique filenames', () => {
    const ids = new Set(loadViews().map((v) => v.id));
    const files = new Set<string>();
    for (const s of SHOT_VIEWS) {
      expect(ids.has(s.id), `SHOT_VIEWS names view "${s.id}", which is not in VIEWS`).toBe(true);
      expect(files.has(s.file), `duplicate shot filename "${s.file}"`).toBe(false);
      files.add(s.file);
      expect(s.caption.length).toBeGreaterThan(10);
    }
  });

  it('the README embeds every still the pipeline publishes', () => {
    const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    for (const s of SHOT_VIEWS) {
      expect(
        readme.includes(`ccmon-${s.file}.png`),
        `shots.ts publishes docs/media/ccmon-${s.file}.png, but the README never shows it`,
      ).toBe(true);
    }
  });
});
