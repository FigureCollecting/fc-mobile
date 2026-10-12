import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * The tiles' sync badge (Pending, Offline, "as of 14:05 CDT") and their xN
 * count, drawn by the real JustifiedRows from the ?fxsync=1 fixtures, in the
 * narrow tiles of the Fold8's cover: every tile width from 76 to 95 px, the
 * width each tile is set to through the CSSOM (which the CSP allows). A word
 * of the badge never splits across lines, the badge and its text stay inside
 * the tile, at its left edge, and it never sits over the count, which keeps the top-right
 * corner. TYPE-1 raised the badge to --font-2xs
 * (11 px) and the count to --font-xs (12 px); this is where they meet.
 */

const TILE_WIDTHS = Array.from({ length: 20 }, (_, i) => 76 + i);

/** Every badge text, with no count, x2 and x12 (src/dev-fixtures/fixtures.ts SYNC_STATES). */
const COMBOS = ['Pending', 'Offline', 'as of today', 'as of another day'].flatMap((text) =>
  ['no count', '×2', '×12'].map((count) => `${text} / ${count}`),
);

interface Reading {
  combos: string[];
  failures: string[];
}

test.use({ timezoneId: 'America/Chicago' });

for (const name of ['fold8-cover', 'fold8-cover-sideways']) {
  const viewport = CASE_VIEWPORTS.find((v) => v.name === name)!;

  test(`${name}: in a 76-95 px tile no badge word splits across lines, and the badge stays in the tile, clear of the xN count`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
    });
    await page.clock.setFixedTime(new Date('2026-10-13T19:05:00Z'));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?layout=rows&fx=2&fxsync=1');
    await page.waitForSelector('.jrows__item .sync-badge--pending');
    await page.evaluate(() => document.fonts.ready);

    const reading: Reading = await page.evaluate((widths) => {
      /** Each character of `el`'s text and the box it is drawn in (null for none: a space at a line end). */
      const charBoxes = (el: Element): { ch: string; box: DOMRect | null }[] => {
        const chars: { ch: string; box: DOMRect | null }[] = [];
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          for (let i = 0; i < node.data.length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            chars.push({ ch: node.data[i], box: [...range.getClientRects()].find((r) => r.width > 0) ?? null });
          }
        }
        return chars;
      };

      /** The words of `el`'s text that start on one line and end on another. */
      const splitWords = (el: Element): string[] => {
        const split: string[] = [];
        let word: { ch: string; box: DOMRect | null }[] = [];
        for (const c of [...charBoxes(el), { ch: ' ', box: null }]) {
          if (!/\s/.test(c.ch)) {
            word.push(c);
            continue;
          }
          const tops = word.flatMap((w) => (w.box === null ? [] : [w.box.top]));
          if (tops.length && Math.max(...tops) - Math.min(...tops) > 3) split.push(word.map((w) => w.ch).join(''));
          word = [];
        }
        return split;
      };

      const combos = new Set<string>();
      const failures: string[] = [];
      for (const item of document.querySelectorAll<HTMLElement>('.jrows__item')) {
        const badge = item.querySelector('.sync-badge:not(.sync-badge--known)');
        if (!badge) continue;
        const text = (badge.textContent ?? '').trim();
        const count = item.querySelector('.jrows__count');
        const countText = count ? (count.textContent ?? '').trim() : 'no count';
        const kind = badge.classList.contains('sync-badge--pending')
          ? 'Pending'
          : text === 'Offline'
            ? 'Offline'
            : text.includes(',')
              ? 'as of another day'
              : 'as of today';
        combos.add(`${kind} / ${countText}`);
        const given = item.style.width;
        for (const w of widths) {
          item.style.width = `${w}px`;
          const at = `${w}px tile "${text}" ${countText}`;
          const tile = item.getBoundingClientRect();
          const b = badge.getBoundingClientRect();
          const split = splitWords(badge);
          if (split.length) failures.push(`${at}: splits ${split.join(', ')}`);
          const ink = charBoxes(badge).flatMap((c) => (c.box === null ? [] : [c.box]));
          const left = Math.min(b.left, ...ink.map((r) => r.left));
          const right = Math.max(b.right, ...ink.map((r) => r.right));
          if (left < tile.left - 0.5 || right > tile.right + 0.5) failures.push(`${at}: leaves the tile (${(left - tile.left).toFixed(1)}..${(right - tile.left).toFixed(1)} of ${w})`);
          if (Math.abs(b.left - tile.left - 4) > 0.5) failures.push(`${at}: off the tile's left edge (${(b.left - tile.left).toFixed(1)} px in)`);
          if (count) {
            const c = count.getBoundingClientRect();
            if (Math.abs(tile.right - c.right - 4) > 0.5 || Math.abs(c.top - tile.top - 4) > 0.5) failures.push(`${at}: the count left the top-right corner`);
            const x = Math.min(b.right, c.right) - Math.max(b.left, c.left);
            const y = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top);
            if (x > 0.5 && y > 0.5) failures.push(`${at}: over the count by ${x.toFixed(1)} x ${y.toFixed(1)} px`);
          }
        }
        item.style.width = given;
      }
      return { combos: [...combos].sort(), failures };
    }, TILE_WIDTHS);

    expect(reading.combos).toEqual(expect.arrayContaining(COMBOS));
    expect(reading.failures).toEqual([]);
  });
}
