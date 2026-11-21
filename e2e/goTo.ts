import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * NAV-SCOPE (Ross 11-18): the case has one view, the wall's; the camera the one-shelf view stood (a hand from a shelf,
 * level with it) is now where Go to stands it. A spec that needs that camera goes to the first figure the case stands
 * (the first cabinet's topmost: the one-shelf view opened on that cabinet's top step), from its card: the card opened
 * by the figure's own click (on a dense wall at the wall's framing a figure is a few px wide, too small to tap), Go to
 * pressed, the card closed (the viewer closes itself on a cover panel; the pane beside the case on a wide one closes by
 * its X), and the camera left at rest off the wall's framing.
 */
export async function goToFirstFigure(page: Page): Promise<void> {
  const host = page.locator('.cabinet-scene');
  const order = JSON.parse((await host.getAttribute('data-order'))!) as string[][];
  const id = order.flat()[0];
  expect(id, 'a figure on the wall to go to').toBeTruthy();
  const opened = await host.getAttribute('data-camera');
  await host.locator(`button.cab-figure[data-figure-id="${id}"]`).first().dispatchEvent('click');
  const goTo = page.getByRole('button', { name: 'Go to' }).first();
  await goTo.scrollIntoViewIfNeeded();
  await goTo.click();
  const pane = page.locator('.detail-pane');
  if (await pane.count()) await pane.getByRole('button', { name: /close detail/i }).click();
  await expect(page.locator('.figure-viewer-sheet, .detail-pane')).toHaveCount(0);
  await expect.poll(async () => host.getAttribute('data-camera'), { message: 'Go to moved the camera' }).not.toBe(opened);
  await page.waitForTimeout(300);
}
