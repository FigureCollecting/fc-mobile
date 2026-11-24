// NAVLOOK 1a (Ross 11-17): a finger's still hold on the scene no longer Looks (on touch, the hat's eye is Look). The
// scene's own Look is the mouse's: a right-button drag turns at once (as Shift+left does). The specs that turn the eye
// by the scene's grab-the-picture Look, to reach a limit or look straight again, drive it here with the mouse; a page
// emulating a phone takes mouse input all the same (pointerType mouse).
import type { Page } from '@playwright/test';

export interface SceneLook {
  /** Move the pointer to (x, y) in `steps` moves, `stepMs` apart, the right button held. */
  to(x: number, y: number, steps?: number, stepMs?: number): Promise<void>;
  /** Let the right button go. */
  end(): Promise<void>;
}

/** The right button down at (x, y) on the scene: its drag is a Look from the first move past the tap slop. */
export async function lookDown(page: Page, x: number, y: number): Promise<SceneLook> {
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  let at = { x, y };
  return {
    async to(x1, y1, steps = 8, stepMs = 16) {
      const from = at;
      for (let i = 1; i <= steps; i++) {
        at = { x: from.x + ((x1 - from.x) * i) / steps, y: from.y + ((y1 - from.y) * i) / steps };
        await page.mouse.move(at.x, at.y);
        await page.waitForTimeout(stepMs);
      }
    },
    async end() {
      await page.mouse.up({ button: 'right' });
    },
  };
}
