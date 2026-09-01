/**
 * @file mask.ts
 * @brief Keeps the throwaway demo $HOME off camera, and proves it stayed off.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The demo shoot runs the app against a synthetic world under /tmp so the
 * operator's real transcripts are never filmed. Several surfaces print an
 * absolute path from that world — the status bar, each account card, and the
 * ready-to-run cross-resume command — so the path has to be rewritten before
 * the camera rolls.
 *
 * THREE mistakes are baked into this file's history, and all are guarded now:
 *
 *   1. Masking ONE element by class. When `.sb-link` was renamed the mask
 *      silently stopped applying and a /tmp path shipped in the README gif.
 *      → `scrub` rewrites every TEXT NODE, so it depends on no single class.
 *
 *   2. Verifying ONCE, at startup, on the first view. The accounts view had
 *      not rendered yet, so its three leaked paths passed and were filmed.
 *      → `assertNoLeak` scrubs AND verifies, and runs at every stop.
 *
 *   3. Keeping a live MutationObserver to re-apply the scrub. Walking the DOM
 *      on every mutation, with the demo live-feed ticker appending rows
 *      continuously, made the renderer so slow the shoot blew its timeout.
 *      → NO observer. The paths live in view content, so scrubbing right after
 *        each navigation (and again at each assert) is both sufficient and
 *        effectively free.
 *
 * The rewrite maps the throwaway home onto `~`, which is what a real install
 * would show: /tmp/ccmon-demo/.claude-work → ~/.claude-work.
 */

import type { Page } from './cdp';
import { findHomeLeak, sel } from './selectors';

/**
 * One pass: rewrite `home` → `~` in every text node, plus the attributes that
 * could carry it. Cheap enough to call on every navigation; safe to call twice.
 */
export async function scrub(page: Page, home: string): Promise<void> {
  await page.evaluate(`(() => {
    const HOME = ${JSON.stringify(home)};
    const swap = (s) => s.split(HOME).join('~');

    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue && n.nodeValue.includes(HOME)) hits.push(n);
    }
    for (const n of hits) n.nodeValue = swap(n.nodeValue);

    // titles never paint on camera, but scrubbing them keeps the assertion
    // below honest rather than merely passing
    for (const el of document.querySelectorAll('[title],[aria-label]')) {
      for (const attr of ['title', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && v.includes(HOME)) el.setAttribute(attr, swap(v));
      }
    }
    for (const input of document.querySelectorAll('input,textarea')) {
      if (input.value && input.value.includes(HOME)) input.value = swap(input.value);
    }
  })()`);
}

/** First scrub, plus a note about which status-bar layout is in play. */
export async function maskDemoHome(page: Page, home: string): Promise<void> {
  await scrub(page, home);
  const which = (await page.exists(sel('dataDirLink')))
    ? 'single-source path'
    : (await page.exists(sel('scopePills')))
      ? 'multi-account scope pills'
      : 'no data-dir element';
  await assertNoLeak(page, home, 'startup');
  console.log(`[promo] demo home masked (${which}); re-scrubbed at every stop`);
}

/**
 * Scrub, then fail the shoot if the throwaway home is still visible.
 *
 * Called per act and per still, not once — the leak that shipped was on a view
 * that had not been navigated to when the single startup check ran.
 */
export async function assertNoLeak(page: Page, home: string, where: string): Promise<void> {
  await scrub(page, home);
  const leak = await findHomeLeak(
    () => page.evaluate<string>('document.body.innerText || ""'),
    home,
  );
  if (!leak) return;
  throw new Error(
    `[promo] the throwaway $HOME is on camera at "${where}" and would be published.\n` +
      `        home: ${home}\n` +
      `        seen: …${leak}…\n` +
      `        scrub() in scripts/promo/mask.ts did not reach it — it is probably\n` +
      `        rendered into an attribute, a canvas, or a shadow root.`,
  );
}
