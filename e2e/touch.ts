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

export interface TouchPoint {
  x: number;
  y: number;
}

/**
 * Two fingers: the first down at a0, the second at b0, both moved together in `steps` moves to a1 and b1, and
 * lifted (a pinch, when they spread or close).
 */
export async function touchPinch(page: Page, a0: TouchPoint, b0: TouchPoint, a1: TouchPoint, b1: TouchPoint, steps = 8, stepMs = 16): Promise<void> {
  const session = await cdp(page);
  const at = (p: TouchPoint, q: TouchPoint, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a0, id: 0 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a0, id: 0 }, { ...b0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...at(a0, a1, t), id: 0 }, { ...at(b0, b1, t), id: 1 }] });
    await page.waitForTimeout(stepMs);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Two quick taps of one finger at (x, y), `gapMs` apart. */
export async function touchDoubleTap(page: Page, x: number, y: number, gapMs = 80): Promise<void> {
  await touchTap(page, x, y);
  await page.waitForTimeout(gapMs);
  await touchTap(page, x, y);
}

/** Several fingers, each down, moved and lifted on its own while the others stay down (CDP keeps every finger's place). */
export interface TouchFingers {
  /** Put finger `id` down at (x, y). */
  down(id: number, x: number, y: number): Promise<void>;
  /** Move finger `id` to (x, y) in `steps` moves, `stepMs` apart; the others stay put. */
  to(id: number, x: number, y: number, steps?: number, stepMs?: number): Promise<void>;
  /** Lift finger `id`; the others stay down. */
  up(id: number): Promise<void>;
}

export async function touchFingers(page: Page): Promise<TouchFingers> {
  const session = await cdp(page);
  const down = new Map<number, TouchPoint>();
  const points = () => [...down].map(([id, p]) => ({ ...p, id }));
  return {
    async down(id, x, y) {
      down.set(id, { x, y });
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() });
    },
    async to(id, x1, y1, steps = 8, stepMs = 16) {
      const from = down.get(id)!;
      for (let i = 1; i <= steps; i++) {
        down.set(id, { x: from.x + ((x1 - from.x) * i) / steps, y: from.y + ((y1 - from.y) * i) / steps });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() });
        await page.waitForTimeout(stepMs);
      }
    },
    async up(id) {
      // Chromium lifts the fingers a touchEnd lists (a touchMove that leaves one out lifts nothing: measured 11-15)
      const at = down.get(id)!;
      down.delete(id);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...at, id }] });
    },
  };
}
