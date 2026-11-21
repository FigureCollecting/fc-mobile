import { test, expect } from './fixtures';
import { SHOT_VIEWPORTS } from './caseViewports';
import { shotSizeError, signoffShot } from './signoffShots';

/**
 * P1 stills: /privacy opened by its address, signed out, in both themes, at each sign-off size (the Fold8 cover and the
 * desktop window among them): the top of the page and its end. The PNGs land in
 * test-results/signoff/<project>/privacy-<theme>-<top|end>.png.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`onboarding, ${theme} theme: the create-account slide keeps its three choices and shows the link to /privacy under the dots`, async ({ page }, testInfo) => {
    await page.addInitScript((t) => localStorage.setItem('fc-theme', t), theme);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Page 4' }).click();
    await page.waitForTimeout(700);
    const link = page.getByRole('link', { name: 'How we use your data' });
    await expect(link).toBeInViewport({ ratio: 1 });
    const linkBox = (await link.boundingBox())!;
    for (const name of ['Create Account', 'Sign In', 'Browse as Guest']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = (await button.boundingBox())!;
      expect(box.y + box.height, `${name} stands above the link`).toBeLessThanOrEqual(linkBox.y);
    }
    await signoffShot(page, testInfo, `privacy-onboarding-${theme}`);
  });

  test(`/privacy, ${theme} theme: the page fits the width, reads from the top and scrolls to its end`, async ({ page }, testInfo) => {
    const panel = SHOT_VIEWPORTS.find((v) => v.name === testInfo.project.name)!;
    await page.addInitScript((t) => localStorage.setItem('fc-theme', t), theme);
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

    // Nothing runs off the side, and the text column is no wider than a comfortable line.
    expect(await page.locator('.privacy').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const column = (await page.locator('.privacy__text').boundingBox())!;
    expect(column.x).toBeGreaterThanOrEqual(0);
    expect(column.x + column.width).toBeLessThanOrEqual(panel.width);
    expect(column.width).toBeLessThanOrEqual(720);
    await expect(page.getByRole('link', { name: 'Open FigureCollecting' })).toBeInViewport({ ratio: 1 });

    const top = await signoffShot(page, testInfo, `privacy-${theme}-top`);
    expect(shotSizeError(top, panel.png)).toBeUndefined();

    const last = page.locator('.privacy__text p').last();
    await last.scrollIntoViewIfNeeded();
    await page.locator('.privacy').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(last).toBeInViewport({ ratio: 1 });
    const end = await signoffShot(page, testInfo, `privacy-${theme}-end`);
    expect(shotSizeError(end, panel.png)).toBeUndefined();
  });
}
