// CASE-FB2b on the local full stack (Ross TALL1 10-15, option 1 as the default; the size audit: 403 of his 1,146
// copies are taller than a KLINGSBO shelf's 256 mm): user A's 1,200 owned (IMG-SHOW-1's seed: 325 at 1/4 = 400 mm and
// 204 at 1/6 = 267 mm, too tall for a stock shelf) with their images, in the cabinet view at the Fold8's cover and open
// panels:
//   (a) walked cabinet by cabinet to the wall's end: every cabinet before the last has figures on its shelves (no
//       empty glass), and the figures too tall for a stock shelf stand inside, in tiers the cabinets made by taking
//       glass shelves out, which each cabinet names (data-removed);
//   (b) the sign-off shots of a cabinet with glass shelves out holding 1/6 and 1/4 figures (on this wall, a 44 % share
//       of tall figures, each cabinet takes two out), and, filtered to a third tall (1/4, 1/7, 1/8 and no scale), of
//       a cabinet with one shelf out, its tier holding 1/4 figures.
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

test('(a) walked to its end, every cabinet before the last has figures on its shelves, the tall ones inside, in tiers; (b) cabinets with shelves out holding 1/6 and 1/4 figures', async ({ context, page }, testInfo) => {
  test.setTimeout(600_000);
  const soft = expect.configure({ soft: true });
  await heldImages(context, page, owned.heads);
  await openOwned(page, owned);
  const scene = page.locator('.cabinet-scene');
  await expect(scene).toHaveAttribute('data-view', 'cabinet');
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  const cabinets = (JSON.parse((await scene.getAttribute('data-wall'))!) as number[][]).length;
  const walk: CabinetSeen[] = [];
  let pictured = false;
  let emptyShot = false;
  await shot(page, testInfo, 'fb2b-first-cabinet');
  for (let i = 0; i < cabinets; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(scene).toHaveAttribute('data-focus', String(i));
    const c = await seen(page);
    walk.push(c);
    // (on 086f61c5) the first cabinet before the last with nothing on its shelves, and its neighbours
    if (!emptyShot && c.shelf === 0 && i < cabinets - 1) {
      emptyShot = true;
      await shot(page, testInfo, 'fb2b-empty-glass');
    }
    // (b) the first cabinet with glass shelves out holding a 1/6 (267 mm) and a 1/4 (400 mm) inside
    if (!pictured && c.removed.length > 0 && c.tallInside.some((h) => h < 300) && c.tallInside.some((h) => h >= 380)) {
      pictured = true;
      testInfo.annotations.push({ type: 'shelves out', description: JSON.stringify(c) });
      await shot(page, testInfo, 'fb2b-shelves-out');
    }
  }
  await expect(page.getByRole('button', { name: 'Next cabinet' })).toBeDisabled();
  await shot(page, testInfo, 'fb2b-last-cabinet');
  const bare = walk.slice(0, -1).filter((c) => c.shelf === 0).map((c) => c.index);
  testInfo.annotations.push({
    type: 'wall',
    description: JSON.stringify({ cabinets, bare: bare.length, withShelvesOut: walk.filter((c) => c.removed.length > 0).length, tallInside: walk.reduce((n, c) => n + c.tallInside.length, 0) }),
  });
  testInfo.annotations.push({ type: 'cabinets', description: walk.map((c) => `${c.index}:${c.removed.join('+') || '-'}:${c.shelf}/${c.top}`).join(' ') });
  soft(bare, 'cabinets before the last with nothing on their shelves').toEqual([]);
  soft(walk.reduce((n, c) => n + c.tallInside.length, 0), 'figures too tall for a stock shelf standing inside').toBeGreaterThan(0);
  soft(walk.every((c) => c.tallInside.length === 0 || c.removed.length > 0), 'a tall figure inside only where shelves came out').toBe(true);
  soft(pictured, `a cabinet with shelves out holding a 1/6 and a 1/4; with shelves out: ${walk.filter((c) => c.removed.length > 0).slice(0, 12).map((c) => `${c.index}:${c.removed.join('+')}:[${c.tallInside.join(',')}]`).join(' ')}`).toBe(true);

  // (b) filtered to a third tall (no 1/6): a cabinet takes one shelf out, its tier holding 1/4 figures
  await page.evaluate(() => {
    history.pushState(null, '', `/?scale=${encodeURIComponent('1/4|1/7|1/8|Unspecified')}`);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(scene).toHaveAttribute('data-focus', '0');
  await settled(page);
  const filtered = (JSON.parse((await scene.getAttribute('data-wall'))!) as number[][]).length;
  let one: CabinetSeen | null = null;
  for (let i = 0; i < filtered && one === null; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(scene).toHaveAttribute('data-focus', String(i));
    const c = await seen(page);
    if (c.removed.length === 1 && c.tallInside.some((h) => h >= 380)) one = c;
  }
  testInfo.annotations.push({ type: 'one shelf out', description: JSON.stringify(one) });
  soft(one, `a cabinet with one shelf out holding 1/4 figures, of ${filtered}`).not.toBeNull();
  if (one) await shot(page, testInfo, 'fb2b-one-shelf-out');
});
