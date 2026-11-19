import type { Page } from '@playwright/test';

/**
 * NAV-GRAD: the Free camera is the case's only camera, and its side arrows (Next and Previous cabinet) are the
 * keyboard's alone: unseen, and no pointer meets them until one is focused (NAV-2A). A spec that pages the wall
 * presses one as the keyboard does: focus, then Enter. (The shelf view's Shelf above and Shelf below still take a tap.)
 */
export async function stepByKey(page: Page, name: 'Next cabinet' | 'Previous cabinet'): Promise<void> {
  await page.getByRole('button', { name }).press('Enter');
}
