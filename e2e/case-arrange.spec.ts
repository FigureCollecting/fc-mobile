import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { touchTap } from './touch';

/**
 * PACK1 (Ross 10-26): the case stands its figures in an arrangement chosen in the View card (series, then scale, then name
 * by default; scale, then series, then name; series, then name; scale, then name; name; date added), apart from the list's
 * sort, a gap filled only within a group. At the Fold8 cover and open panels, in classic and Free camera.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');

/** The fixtures by id (the copies `-xN` are their figure's): series and scale as the fixtures list them. */
const SERIES: Record<string, string> = {
  'fx-spike': 'Cowboy Bebop',
  'fx-ryuuko': 'Kill la Kill',
  'fx-dark-angel': 'Original Character',
  'fx-madoka': 'Puella Magi Madoka Magica',
  'fx-rem': 'Re:Zero',
  'fx-miku-nendo': 'Vocaloid',
  'fx-miku-deepsea': 'Vocaloid',
};
const SCALE_RANK: Record<string, number> = { 'fx-rem': 7, 'fx-ryuuko': 7, 'fx-spike': 8, 'fx-madoka': 8, 'fx-miku-deepsea': 8, 'fx-dark-angel': 8, 'fx-miku-nendo': Infinity };
const NAMES: Record<string, string> = {
  'fx-dark-angel': 'Dark Angel Olivia',
  'fx-miku-deepsea': 'Hatsune Miku: Deep Sea Girl',
  'fx-madoka': 'Madoka Kaname',
  'fx-miku-nendo': 'Nendoroid Hatsune Miku',
  'fx-rem': 'Rem',
  'fx-ryuuko': 'Ryuko Matoi',
  'fx-spike': 'Spike Spiegel',
};
const base = (id: string) => id.replace(/-x\d+$/, '');

async function openCase(page: Page, size: { width: number; height: number }, prefs: Record<string, unknown> | null = null, query = '&fx=3') {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    // (once: a reload keeps what the page itself has stored since)
    if (p !== null && sessionStorage.getItem('pack1-seeded') === null) {
      localStorage.setItem('fc-case-prefs', JSON.stringify(p));
      sessionStorage.setItem('pack1-seeded', '1');
    }
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** The figures' ids as the case stands them, cabinet by cabinet, each from its top down, left to right. */
async function order(page: Page): Promise<string[]> {
  return (JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-order'))!) as string[][]).flat();
}

async function arrangeBy(page: Page, label: string) {
  await page.getByRole('button', { name: 'View' }).click();
  const group = page.getByRole('group', { name: 'Arrange by' });
  await group.getByRole('radio', { name: label, exact: true }).click();
  await expect(group.getByRole('radio', { name: label, exact: true })).toBeChecked();
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(group).toHaveCount(0);
}

/** Never back to an earlier group along the case (the one tall fixture, which waits for a tier or a top, aside). */
function grouped(ids: readonly string[], rank: (id: string) => number | string): boolean {
  const ranks = ids.filter((id) => base(id) !== 'fx-dark-angel').map((id) => rank(base(id)));
  return ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
}

for (const size of FOLD8) {
  test(`a fresh device arranges the case by series, then scale, then name: ${size.name}`, async ({ page }) => {
    await openCase(page, size);
    const scene = page.locator('.cabinet-scene');
    await expect(scene).toHaveAttribute('data-arrange', 'series-scale-name');
    const ids = await order(page);
    // on the shelves Cowboy Bebop first (Dark Angel Olivia, too tall for a stock shelf, waits for a top or a tier); every
    // series together, in order
    expect(ids.filter((id) => base(id) !== 'fx-dark-angel').slice(0, 3), ids.join(' ')).toEqual(['fx-spike', 'fx-spike-x2', 'fx-spike-x3']);
    expect(grouped(ids, (id) => SERIES[id]), ids.join(' ')).toBe(true);
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('group', { name: 'Arrange by' }).getByRole('radio', { name: 'Series, then scale, then name' })).toBeChecked();
  });

  for (const free of [false, true]) {
    test(`switching the arrangement packs the case again, and the device keeps it${free ? ', in the Free camera' : ''}: ${size.name}`, async ({ page }) => {
      await openCase(page, size, free ? { freeCamera: true } : null);
      const scene = page.locator('.cabinet-scene');
      if (free) await expect(scene).toHaveAttribute('data-free-camera', '1');
      const before = await order(page);

      await arrangeBy(page, 'Name');
      await expect(scene).toHaveAttribute('data-arrange', 'name');
      const byName = await order(page);
      expect(byName).not.toEqual(before);
      expect([...byName].sort()).toEqual([...before].sort());
      // no groups: the shelf figures read strictly by name
      const names = byName.filter((id) => base(id) !== 'fx-dark-angel').map((id) => NAMES[base(id)]);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

      await arrangeBy(page, 'Scale, then name');
      await expect(scene).toHaveAttribute('data-arrange', 'scale-name');
      expect(grouped(await order(page), (id) => SCALE_RANK[id])).toBe(true);

      await page.reload();
      await page.waitForSelector('button.cab-figure');
      await expect(scene).toHaveAttribute('data-arrange', 'scale-name');
    });
  }

  test(`the list keeps its own sort whatever the case's arrangement: ${size.name}`, async ({ page }) => {
    await openCase(page, size, null, '&fx=1');
    /** The tiles' pictures in the list's order, then back to the case. */
    const tiles = async () => {
      await page.goto('/?layout=rows&fx=1');
      await page.waitForSelector('button.jrows__item img');
      const srcs = await page.locator('button.jrows__item img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
      await page.goto('/?layout=case&fx=1');
      await page.waitForSelector('button.cab-figure');
      return srcs;
    };
    const listed = await tiles();
    expect(listed).toHaveLength(7);
    // the case stands them otherwise than the list does
    const shown = async () => page.locator('button.cab-figure img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
    expect(await shown()).not.toEqual(listed);
    await arrangeBy(page, 'Date added, newest first');
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-arrange', 'date-added');
    expect(await tiles()).toEqual(listed);
    await arrangeBy(page, 'Scale, then series, then name');
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-arrange', 'scale-series-name');
    expect(await tiles()).toEqual(listed);
  });

  test(`the one-cabinet view starts again at the first cabinet, and a tap opens the figure it shows: ${size.name}`, async ({ page }) => {
    await openCase(page, size, { view: 'cabinet' });
    const scene = page.locator('.cabinet-scene');
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(scene).toHaveAttribute('data-focus', '1');
    await arrangeBy(page, 'Name');
    await expect(scene).toHaveAttribute('data-focus', '0');
    // a figure the frame shows whole: its card is that figure
    const frame = (await scene.boundingBox())!;
    const figures = page.locator('button.cab-figure');
    let tapped: string | null = null;
    for (let i = 0; i < (await figures.count()) && tapped === null; i++) {
      const b = await figures.nth(i).boundingBox();
      if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) {
        tapped = await figures.nth(i).getAttribute('aria-label');
        await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
      }
    }
    expect(tapped).not.toBeNull();
    await expect(page.locator('.figure-viewer-sheet__name').first()).toHaveText(tapped!);
  });
}
