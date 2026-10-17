// CASE-FB2b on the local full stack (Ross TALL1 10-15, option 1 as the default; the size audit: 403 of his 1,146
// copies are taller than a KLINGSBO shelf's 256 mm): user A's 1,200 owned (IMG-SHOW-1's seed: 325 at 1/4 = 400 mm and
// 204 at 1/6 = 267 mm, too tall for a stock shelf) with their images, at the Fold8's cover and open panels:
//   (a) every cabinet before the wall's last has figures on its shelves (no empty glass), by what the scene says each
//       holds (data-held, drawn or not); the first cabinets, stepped through in the cabinet view, stand their figures
//       too tall for a stock shelf inside, in tiers made by taking glass shelves out, which each names (data-removed);
//   (b) the sign-off shots of a cabinet with two glass shelves out holding 1/6 and 1/4 figures (the first cabinet), and
//       (open panel, while paging) of one with one shelf out holding 1/6 and 1/4 figures;
//   (c) at the open panel, the wall view paged to its end: every page draws figures on the shelves of each cabinet it
//       shows whole, as data-held says, and Next stops at the last page.
// On 086f61c5 (develop): 236 cabinets before the last stood with nothing on their shelves (the 1/4 and 1/6 figures each
// on a top, a cabinet of empty glass under them), no figure too tall for a stock shelf stood inside, and no cabinet
// took a shelf out (no data-removed).
import { expect, test } from '../fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { SHOT_VIEWPORTS } from '../caseViewports';
import { shotSizeError, signoffShot } from '../signoffShots';
import { heldImages, openOwned, ownedStack } from './heldCase';

/** A stock KLINGSBO's tallest compartment and its top (mm). */
const SHELF_MAX_MM = 259;
const TOP_MM = 1800;

let owned: Awaited<ReturnType<typeof ownedStack>>;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  owned = await ownedStack();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'cabinet' }));
  });
  await owned.stack.edge.clearFaults();
  await owned.stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

interface CabinetSeen {
  index: number;
  /** The glass shelves it stands without (surface indices), none for a stock one. */
  removed: number[];
  shelf: number;
  top: number;
  /** Figures too tall for a stock shelf standing inside it, and their heights. */
  tallInside: number[];
  /** And on its top. */
  tallOnTop: number[];
}

/** The focus cabinet as the cabinet view draws it. */
async function seen(page: Page): Promise<CabinetSeen> {
  return page.evaluate(
    ([shelfMax, topMm]) => {
      const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
      const index = Number(host.dataset.focus);
      const box = (JSON.parse(host.dataset.wall!) as number[][])[index]!;
      const cab = document.querySelector<HTMLElement>(`.cab[data-index="${index}"]`);
      const figures = Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'))
        .map((b) => JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; surface: number })
        .filter((w) => (w.x0 + w.x1) / 2 >= box[0]! && (w.x0 + w.x1) / 2 <= box[1]!);
      const inside = figures.filter((w) => w.surface < topMm);
      return {
        index,
        removed: cab?.dataset.removed ? cab.dataset.removed.split(',').map(Number) : [],
        shelf: inside.length,
        top: figures.length - inside.length,
        tallInside: inside.filter((w) => w.y1 - w.y0 > shelfMax).map((w) => Math.round(w.y1 - w.y0)),
        tallOnTop: figures.filter((w) => w.surface >= topMm && w.y1 - w.y0 > shelfMax).map((w) => Math.round(w.y1 - w.y0)),
      };
    },
    [SHELF_MAX_MM, TOP_MM] as const,
  );
}

/** Every figure drawn is grounded on its read picture, and the wall no longer changes. */
async function settled(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const bs = Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'));
          return JSON.stringify([bs.every((b) => b.dataset.grounded === '1'), document.querySelector<HTMLElement>('.cabinet-scene')!.dataset.wall, bs.map((b) => b.dataset.world)]);
        });
        const same = now === last && (JSON.parse(now) as [boolean])[0];
        last = now;
        return same;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe(true);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
}

/** What the scene says each cabinet holds: figures inside, on its top, and the shelves it stands without. */
async function held(page: Page): Promise<[number, number, number[]][]> {
  const attr = await page.locator('.cabinet-scene').getAttribute('data-held');
  expect(attr, 'the scene says what each cabinet holds (data-held)').not.toBeNull();
  return JSON.parse(attr!) as [number, number, number[]][];
}

/** Step the cabinet view's focus to cabinet `to` (from where it stands). */
async function stepTo(page: Page, to: number): Promise<void> {
  const scene = page.locator('.cabinet-scene');
  for (let i = Number(await scene.getAttribute('data-focus')); i < to; i++) {
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(scene).toHaveAttribute('data-focus', String(i + 1));
  }
}

test('(a) every cabinet before the last has figures on its shelves, the tall ones inside, in tiers; (b) a cabinet with shelves out holding 1/6 and 1/4 figures', async ({ context, page }, testInfo) => {
  test.setTimeout(300_000);
  const soft = expect.configure({ soft: true });
  await heldImages(context, page, owned.heads);
  await openOwned(page, owned);
  const scene = page.locator('.cabinet-scene');
  await expect(scene).toHaveAttribute('data-view', 'cabinet');
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await shot(page, testInfo, 'fb2b-first-cabinet');

  // (a) the whole wall, drawn or not
  const wall = await held(page);
  const bare = wall.slice(0, -1).flatMap(([inside], i) => (inside === 0 ? [i] : []));
  testInfo.annotations.push({
    type: 'wall',
    description: JSON.stringify({ cabinets: wall.length, bare: bare.length, withShelvesOut: wall.filter(([, , r]) => r.length > 0).length, oneOut: wall.filter(([, , r]) => r.length === 1).length, firstOneOut: wall.findIndex(([, , r]) => r.length === 1) }),
  });
  soft(bare, 'cabinets before the last with nothing on their shelves').toEqual([]);
  // on 086f61c5 the empty glass began here: its picture
  if (bare.length > 0) {
    await stepTo(page, bare[0]!);
    await shot(page, testInfo, 'fb2b-empty-glass');
  }

  // the first cabinets, drawn: the tall figures inside stand only where shelves came out, as each cabinet names
  const steps = Math.min(6, wall.length);
  const walk: CabinetSeen[] = [];
  let pictured = false;
  for (let i = Number(await scene.getAttribute('data-focus')); i < steps; i++) {
    if (walk.length > 0 || i > 0) await stepTo(page, i);
    const c = await seen(page);
    walk.push(c);
    soft(c.removed, `cabinet ${i} names the shelves the scene says it stands without`).toEqual(wall[i]![2]);
    // (b) a cabinet with glass shelves out holding a 1/6 (267 mm) and a 1/4 (400 mm) inside
    if (!pictured && c.removed.length > 0 && c.tallInside.some((h) => h < 300) && c.tallInside.some((h) => h >= 380)) {
      pictured = true;
      testInfo.annotations.push({ type: 'shelves out', description: JSON.stringify(c) });
      await shot(page, testInfo, 'fb2b-shelves-out');
    }
  }
  soft(walk.reduce((n, c) => n + c.tallInside.length, 0), 'figures too tall for a stock shelf standing inside').toBeGreaterThan(0);
  soft(walk.every((c) => c.tallInside.length === 0 || c.removed.length > 0), 'a tall figure inside only where shelves came out').toBe(true);
  soft(pictured, 'a cabinet with shelves out holding a 1/6 and a 1/4').toBe(true);
});

test('(c) the open panel pages the wall view to its end, each page drawing figures on the shelves of the cabinets it shows whole; (b) one with one shelf out', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('open'), 'the open panel shows the most cabinets a page: the fewest pages');
  test.setTimeout(300_000);
  await context.addInitScript(() => localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall' })));
  await heldImages(context, page, owned.heads);
  await openOwned(page, owned);
  const scene = page.locator('.cabinet-scene');
  await expect(scene).toHaveAttribute('data-view', 'wall');
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  const wall = await held(page);
  const next = page.getByRole('button', { name: 'Next cabinet' });
  const faults: string[] = [];
  let pages = 0;
  let oneShot = false;
  for (; pages < wall.length; pages++) {
    // the cabinets this page draws whole in the frame, and the figures it draws inside each
    const { drawn, heights } = await page.evaluate(([topMm]) => {
      const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
      const boxes = JSON.parse(host.dataset.wall!) as number[][];
      const frame = document.querySelector('.cabinet-scene__frame')!.getBoundingClientRect();
      const inside = new Map<number, number>();
      const tall = new Map<number, number[]>();
      for (const b of Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'))) {
        const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; surface: number };
        const r = b.getBoundingClientRect();
        if (r.x + r.width / 2 < frame.left || r.x + r.width / 2 > frame.right) continue;
        const cab = boxes.findIndex((c) => (w.x0 + w.x1) / 2 >= c[0]! && (w.x0 + w.x1) / 2 <= c[1]!);
        tall.set(cab, [...(tall.get(cab) ?? []), Math.round(w.y1 - w.y0)]);
        if (w.surface < topMm) inside.set(cab, (inside.get(cab) ?? 0) + 1);
      }
      return { drawn: [...inside.entries()], heights: [...tall.entries()] };
    }, [TOP_MM] as const);
    // (b) the first cabinet with one glass shelf out holding a 1/6 (267 mm) and a 1/4 (400 mm)
    const one = heights.find(([cab, hs]) => wall[cab]?.[2].length === 1 && hs.some((h) => h > 260 && h < 300) && hs.some((h) => h >= 380));
    if (!oneShot && one) {
      oneShot = true;
      testInfo.annotations.push({ type: 'one shelf out', description: JSON.stringify({ cabinet: one[0], removed: wall[one[0]]![2], heights: one[1] }) });
      await shot(page, testInfo, 'fb2b-one-shelf-out');
    }
    for (const [cab, n] of drawn) if (n > 0 && wall[cab]![0] === 0) faults.push(`page ${pages}: cabinet ${cab} draws ${n} inside, data-held says none`);
    const seenCabs = new Set(drawn.map(([cab]) => cab));
    for (let cab = Math.min(...seenCabs); cab <= Math.max(...seenCabs); cab++) {
      if (cab < wall.length - 1 && !seenCabs.has(cab)) faults.push(`page ${pages}: cabinet ${cab} draws nothing inside`);
    }
    if (await next.isDisabled()) break;
    const focus = await scene.getAttribute('data-focus');
    await next.click();
    await expect(scene).not.toHaveAttribute('data-focus', focus!);
  }
  testInfo.annotations.push({ type: 'paged', description: JSON.stringify({ pages: pages + 1, cabinets: wall.length }) });
  await shot(page, testInfo, 'fb2b-last-page');
  expect(faults).toEqual([]);
  expect(oneShot, 'a cabinet with one shelf out holding a 1/6 and a 1/4').toBe(true);
  await expect(next).toBeDisabled();
  expect(pages + 1, 'pages to the wall end').toBeLessThan(wall.length);
});
