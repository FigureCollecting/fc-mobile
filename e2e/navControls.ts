// NAV-FLOAT: the case's floating controls, for the e2e specs. One place names them, so a spec says "the hat" or "the Z
// rail" and never binds to their markup (they were `.tab-bar__add[data-jog]` and `.depth-rocker` in the centre cluster).
import type { Locator, Page } from '@playwright/test';

/** The right XY hat: hold and drag moves the Free camera (sideways and up or down). */
export const hat = (page: Page): Locator => page.locator('[data-nav="hat"]');
/** The left Z rail: hold and push up moves the Free camera closer, down backs it away. */
export const depth = (page: Page): Locator => page.locator('[data-nav="depth"]');
/** Every floating control: what a scene screenshot masks, so its baseline is the scene's alone. */
export const navControls = (page: Page): Locator => page.locator('[data-nav]');

export interface Point {
  x: number;
  y: number;
}

/** The centre of a control's box (CSS px in the viewport). */
export async function centreOf(control: Locator): Promise<Point> {
  const b = (await control.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The hat's hit circle: its centre and radius. */
export async function hatCircle(page: Page): Promise<Point & { r: number }> {
  const b = (await hat(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 };
}
