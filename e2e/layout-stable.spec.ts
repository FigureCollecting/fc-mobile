import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * LAYOUT-STABLE-1 (Ross 10-18, a first launch: the larger figures "flash into and out of place while it works out what goes
 * where"): the pictures of a collection arrive over minutes, each changing what its figure packs as, and the whole wall was
 * packed again for every one. With the held basis (?fxsteady=1 turns it on for the fixtures, whose pictures never stream in
 * of themselves) no figure changes its place more than once however slowly the pictures are read. The same fixtures
 * without it, 140 figures none labelled wide so each is packed by its picture, are the control: most move again and again.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FIXTURES = '/?layout=case&fx=20&fxbranch=masked&fxuniq=1&fxwidth=none';

type Frame = [number, Record<string, string>];

/** Every figure the case draws, frame by frame: its place (centre, base, surface) and its art; and each picture's alpha read staggered, seeded. */
async function watch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall' }));
    // the pictures are read slowly, each after its own delay (the app's alpha reads: its crossOrigin canvas reads)
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      if (this.crossOrigin !== 'anonymous') return decode.call(this);
      return new Promise<void>((r) => setTimeout(r, 100 + rand() * 1200)).then(() => decode.call(this));
    };
    const w = window as unknown as { __frames: Frame[]; __t0: number };
    w.__frames = [];
    w.__t0 = performance.now();
    let dirty = true;
    let last = '';
    new MutationObserver(() => { dirty = true; }).observe(document, { attributes: true, attributeFilter: ['data-world', 'data-art'], childList: true, subtree: true });
    const tick = () => {
      if (dirty) {
        dirty = false;
        const cur: Record<string, string> = {};
        for (const b of document.querySelectorAll<HTMLElement>('button.cab-figure')) {
          const world = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; surface: number };
          const at = [(world.x0 + world.x1) / 2, world.y0, world.surface].map((n) => Math.round(n * 10) / 10);
          cur[b.dataset.figureId!] = `${at.join(',')}|${b.dataset.art}`;
        }
        const s = JSON.stringify(cur);
        if (s !== last) { last = s; w.__frames.push([Math.round(performance.now() - w.__t0), cur]); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

/** Wait until the wall has stood still for `quietMs` after at least `minMs`. */
async function stood(page: Page, minMs: number, quietMs: number, maxMs: number): Promise<Frame[]> {
  const t0 = Date.now();
  let last = -1;
  let since = Date.now();
  for (;;) {
    const f = await frames(page);
    if (f.length !== last) { last = f.length; since = Date.now(); }
    if (Date.now() - t0 >= minMs && Date.now() - since >= quietMs) return f;
    if (Date.now() - t0 > maxMs) return f;
    await page.waitForTimeout(500);
  }
}

/** How many times each figure changed its place. */
function moves(all: Frame[]): Map<string, number> {
  const out = new Map<string, number>();
  const last = new Map<string, string>();
  for (const [, cur] of all) {
    for (const [id, v] of Object.entries(cur)) {
      const at = v.split('|')[0]!;
      const was = last.get(id);
      if (was !== undefined && was !== at) out.set(id, (out.get(id) ?? 0) + 1);
      last.set(id, at);
    }
  }
  return out;
}

async function open(page: Page, query: string) {
  await watch(page);
  await page.setViewportSize({ width: 443, height: 558 });
  await page.goto(`${FIXTURES}${query}`);
  await page.waitForSelector('button.cab-figure', { timeout: 30_000 });
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

test('with the held basis no figure changes its place more than once while the pictures are read slowly', async ({ page }) => {
  await open(page, '&fxsteady=1');
  const all = await stood(page, 8_000, 5_000, 60_000);
  const m = moves(all);
  const drawn = new Set(all.flatMap(([, cur]) => Object.keys(cur)));
  expect(drawn.size, 'a wall of figures was drawn').toBeGreaterThan(40);
  const twice = [...m].filter(([, n]) => n > 1);
  expect(twice, `figures that changed their place more than once: ${JSON.stringify(twice.slice(0, 5))}`).toEqual([]);
  // what the wall settled on is laid out by the pictures (the one tidy-up), not left as plates
  const last = all[all.length - 1]![1];
  const kinds = Object.values(last).map((v) => v.split('|')[1]);
  expect(kinds.filter((k) => k === 'masked').length, 'pictures drawn at the end').toBeGreaterThan(kinds.length / 2);
});

test('control: the same pictures without it move most figures again and again (the old behaviour)', async ({ page }) => {
  // the wall may take up to the 60 s stood() allows to stand still: in the case's arrangement (PACK1) it took 31 s on a
  // busy host, past the default 30 s (22 s in the list's order before it)
  test.setTimeout(90_000);
  await open(page, '');
  const all = await stood(page, 8_000, 5_000, 60_000);
  const twice = [...moves(all)].filter(([, n]) => n > 1);
  expect(twice.length, 'figures that changed their place more than once without the held basis').toBeGreaterThan(10);
});
