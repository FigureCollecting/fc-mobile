// Real touch input for the e2e specs: Chromium's own touch pipeline (CDP Input.dispatchTouchEvent), so the browser
// decides, as on a phone, when a finger scrolls a scroller (and cancels the pointer) and when the page keeps it.
import type { CDPSession, Page } from '@playwright/test';

const sessions = new WeakMap<Page, CDPSession>();

async function cdp(page: Page): Promise<CDPSession> {
  let session = sessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  return session;
}

export interface TouchDrag {
  /** Move the finger to (x, y) in `steps` moves, `stepMs` apart. */
  to(x: number, y: number, steps?: number, stepMs?: number): Promise<void>;
  /** Lift the finger. */
  end(): Promise<void>;
}

/** Put one finger down at (x, y); move and lift it through the returned handle. */
export async function touchDown(page: Page, x: number, y: number): Promise<TouchDrag> {
  const session = await cdp(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  let at = { x, y };
  return {
    async to(x1, y1, steps = 8, stepMs = 16) {
      const from = at;
      for (let i = 1; i <= steps; i++) {
        at = { x: from.x + ((x1 - from.x) * i) / steps, y: from.y + ((y1 - from.y) * i) / steps };
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] });
        await page.waitForTimeout(stepMs);
      }
    },
    async end() {
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}

/** A whole one-finger swipe from (x, y) by (dx, dy). */
export async function touchSwipe(page: Page, x: number, y: number, dx: number, dy: number, steps = 8, stepMs = 16): Promise<void> {
  const finger = await touchDown(page, x, y);
  await finger.to(x + dx, y + dy, steps, stepMs);
  await finger.end();
}

/** One finger tap at (x, y). */
export async function touchTap(page: Page, x: number, y: number): Promise<void> {
  const finger = await touchDown(page, x, y);
  await finger.end();
}
