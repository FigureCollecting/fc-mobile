// Shared by the case e2e specs: when a pull-up sheet has come to rest, and whether a tap at a control's centre lands on it.
import { expect, type Locator } from '@playwright/test';

const box = async (sheet: Locator) => {
  const b = await sheet.boundingBox();
  return JSON.stringify(b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]);
};

/**
 * Wait until `sheet` has come to rest: it has moved since the tap (its spring started) and then held still for
 * three samples in a row; or it held still for ten (1.5 s) without ever moving, because it was already open.
 * Two equal samples alone are no proof: before the spring starts the sheet stands still too.
 */
export async function atRest(sheet: Locator): Promise<void> {
  const first = await box(sheet);
  let last = first;
  let moved = false;
  let still = 0;
  await expect
    .poll(
      async () => {
        const now = await box(sheet);
        if (now !== first) moved = true;
        still = now === last && now !== 'null' ? still + 1 : 0;
        last = now;
        return (moved && still >= 3) || still >= 10;
      },
      { intervals: [150], timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Whether a tap at the centre of `control` reaches it: scrolled into view inside its own scrolling `body` only
 * (never the page behind it), then the element the page finds at that point is the control or inside it.
 */
export async function takesTap(control: Locator, body: string): Promise<{ hit: boolean; at: string }> {
  await control.evaluate((el, sel) => {
    const scroller = el.closest(sel);
    if (!scroller) return;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom + 4;
    else if (r.top < s.top) scroller.scrollTop -= s.top - r.top + 4;
  }, body);
  return control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const found = y >= 0 && y < innerHeight && x >= 0 && x < innerWidth ? document.elementFromPoint(x, y) : null;
    const name = found === null ? 'nothing (off screen)' : `${found.tagName.toLowerCase()}.${(found.getAttribute('class') ?? '').split(' ').join('.')}`;
    return { hit: found !== null && el.contains(found), at: `y=${Math.round(y)} -> ${name}` };
  });
}
