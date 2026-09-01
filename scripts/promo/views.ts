/**
 * @file views.ts
 * @brief The renderer's view order and hotkeys, read from Sidebar.tsx source.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The tour must press the key that actually selects a view. Hardcoding the
 * digits is exactly what broke last time: the sidebar was reordered, and a
 * tour still pressing 2/3/6/7/8/9 filmed analytics captioned "activity",
 * models captioned "blocks", and so on — with a green exit code.
 *
 * So the map comes from `src/components/layout/Sidebar.tsx`. It is PARSED from
 * the file's text rather than imported: the module evaluates JSX at load, so
 * `import { VIEWS }` under plain node dies on `React is not defined`, and the
 * promo scripts stay pure node like the rest of the tooling.
 *
 * A parse that finds nothing THROWS. `selectors.test.ts` runs this parse and
 * asserts the ids it returns, so restructuring VIEWS into a shape this cannot
 * read fails at `npm test` rather than mid-shoot.
 */

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
export const SIDEBAR_SRC = path.join(REPO, 'src', 'components', 'layout', 'Sidebar.tsx');

/** Mirrors Sidebar.tsx#VIEW_KEYS — the badge alphabet, kept in step by the test. */
export const VIEW_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='] as const;

export interface TourView {
  id: string;
  label: string;
  /** Position in VIEWS — and therefore the hotkey index. */
  index: number;
  /** The key that selects it, or '' when it is past the key alphabet. */
  key: string;
}

/** Pull `{ id: 'x', label: 'y' }` literals out of one array body, in order. */
function parseEntries(body: string): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const re = /\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    out.push({ id: m[1], label: m[2] });
  }
  return out;
}

/** The body of `export const <name>: ViewDef[] = [ … ];` */
function arrayBody(src: string, name: string): string {
  const start = src.indexOf(`export const ${name}: ViewDef[] = [`);
  if (start < 0) throw new Error(`[promo] Sidebar.tsx no longer declares ${name}: ViewDef[]`);
  const open = src.indexOf('[', start);
  const close = src.indexOf('];', open);
  if (close < 0) throw new Error(`[promo] could not find the end of ${name} in Sidebar.tsx`);
  return src.slice(open + 1, close);
}

/**
 * VIEWS in renderer order, each with the key that selects it.
 * Expands the `...CORE_VIEWS` spread the real declaration uses.
 */
export function loadViews(srcPath: string = SIDEBAR_SRC): TourView[] {
  const src = fs.readFileSync(srcPath, 'utf8');
  const core = parseEntries(arrayBody(src, 'CORE_VIEWS'));
  const viewsBody = arrayBody(src, 'VIEWS');

  const entries = viewsBody.includes('...CORE_VIEWS')
    ? [...core, ...parseEntries(viewsBody)]
    : parseEntries(viewsBody);

  if (entries.length < 2) {
    throw new Error(
      `[promo] parsed ${entries.length} views out of Sidebar.tsx — the VIEWS literal changed shape. ` +
        `Update scripts/promo/views.ts to match.`,
    );
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) throw new Error(`[promo] duplicate view id parsed: ${e.id}`);
    seen.add(e.id);
  }

  return entries.map((e, index) => ({
    ...e,
    index,
    key: VIEW_KEYS[index] ?? '',
  }));
}

/**
 * The views the SIDEBAR actually renders — the real pages of the app.
 *
 * This is NOT the same set as VIEWS, and the difference is what made the
 * previous tour film a page that no longer exists. VIEWS is the hotkey/command
 * -palette order and still carries `sessions`, `blocks`, `models` and `links`;
 * the sidebar renders only the Workspace group (CORE_VIEWS) plus the Tools and
 * System items. A view in VIEWS but not in the sidebar is orphaned: reachable
 * by a number key, absent from navigation, and in at least one case no longer
 * rendering its own content.
 *
 * The tour and the README gallery must both come from THIS list. If a page is
 * not in the left rail, it is not a page.
 */
export function loadSidebarViews(srcPath: string = SIDEBAR_SRC): TourView[] {
  const src = fs.readFileSync(srcPath, 'utf8');
  const core = parseEntries(arrayBody(src, 'CORE_VIEWS'));

  // the secondary groups render inline `<NavItem view={{ id, label }} …>`
  const fnStart = src.indexOf('export function Sidebar()');
  if (fnStart < 0) throw new Error('[promo] Sidebar.tsx no longer exports function Sidebar()');
  const extras = parseEntries(src.slice(fnStart));

  const all = [...core, ...extras];
  if (!all.length) {
    throw new Error('[promo] parsed no sidebar views out of Sidebar.tsx — the render changed shape');
  }

  const views = loadViews(srcPath);
  return all.map((e) => {
    const v = views.find((x) => x.id === e.id);
    if (!v) {
      throw new Error(
        `[promo] the sidebar renders "${e.id}", which is not in VIEWS — it therefore ` +
          `has no hotkey and the tour cannot navigate to it reliably.`,
      );
    }
    return v;
  });
}

/** Look a view up by id, failing loudly when the tour names one that is gone. */
export function viewById(views: TourView[], id: string): TourView {
  const v = views.find((x) => x.id === id);
  if (!v) {
    throw new Error(
      `[promo] the tour references view "${id}", which is no longer in Sidebar.tsx#VIEWS ` +
        `(have: ${views.map((x) => x.id).join(', ')})`,
    );
  }
  return v;
}
