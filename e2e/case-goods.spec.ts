import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * FIGURES-ONLY-1 (Ross 10-18): the case shelves figures only. With ?fxgoods=1 three of the seven fixtures are products
 * a card with a kind would call goods (Dark Angel Olivia, Spike Spiegel) and media (Ryuko Matoi); in a real browser the
 * case stands none of them, the tiles still show every one, and the View card says how many the case leaves off.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');
const LEFT_OFF = ['Dark Angel Olivia', 'Spike Spiegel', 'Ryuko Matoi'];
const SHELVED = ['Rem', 'Nendoroid Hatsune Miku', 'Madoka Kaname', 'Hatsune Miku: Deep Sea Girl'];

async function open(page: Page, size: { width: number; height: number }, layout: 'case' | 'rows') {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall' }));
  });
  await page.setViewportSize(size);
  await page.goto(`/?layout=${layout}&fxgoods=1`);
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

for (const size of FOLD8) {
  test(`the case stands the figures and leaves the goods and the video off its shelves; the tiles keep them: ${size.name}`, async ({ page }) => {
    await open(page, size, 'case');
    await page.waitForSelector('button.cab-figure');
    const stood = await page.locator('button.cab-figure').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const name of LEFT_OFF) expect(stood, `${name} is not on a shelf`).not.toContain(name);
    for (const name of SHELVED) expect(stood, `${name} is on a shelf`).toContain(name);

    // the same collection as tiles: all seven
    await page.goto('/?layout=rows&fxgoods=1');
    for (const name of [...SHELVED, ...LEFT_OFF]) await expect(page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()).toBeVisible();
  });

  test(`the View card says "2 goods and 1 media not shelved": ${size.name}`, async ({ page }) => {
    await open(page, size, 'case');
    await page.waitForSelector('button.cab-figure');
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByText('2 goods and 1 media not shelved')).toBeVisible();
  });
}

test('with no goods or media in the collection the View card says nothing about shelving', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize({ width: 443, height: 558 });
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await page.getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('radio', { name: 'One cabinet' })).toBeVisible();
  await expect(page.getByText(/not shelved/)).toHaveCount(0);
});
