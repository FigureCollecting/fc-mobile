import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../alphaMargin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../alphaMargin')>()),
  getAlphaMask: vi.fn(() => undefined),
}));

import { imageFraction, figureAt, tapTarget } from '../figureHitTest';
import { computeAlphaMask, getAlphaMask } from '../alphaMargin';
import type { AlphaMask } from '../alphaMargin';

const mockedGetAlphaMask = vi.mocked(getAlphaMask);

/** A 10x10 mask, drawn only where `drawn(x, y)` holds. */
function mask(drawn: (x: number, y: number) => boolean): AlphaMask {
  const data = new Uint8ClampedArray(10 * 10 * 4);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (drawn(x, y)) data[(y * 10 + x) * 4 + 3] = 255;
  return computeAlphaMask({ width: 10, height: 10, data })!;
}
const OPAQUE = mask(() => true);
const CLEAR = mask(() => false);

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** A figure button like ShelfFigure renders, its drawn part at `box` on
 *  screen, `z` px deep (--fig-z: larger is nearer the viewer). */
function figure(kind: 'matted' | 'framed' | 'silhouette', box = rect(0, 0, 100, 100), src = `${kind}-${Math.random()}.png`, z = 0) {
  const button = document.createElement('button');
  button.className = kind === 'framed' ? 'shelf-figure shelf-figure--framed' : 'shelf-figure';
  button.style.setProperty('--fig-z', `${z}px`);
  let part: HTMLElement;
  if (kind === 'matted') {
    part = document.createElement('img');
    part.className = 'shelf-figure__img';
    part.setAttribute('src', src);
    Object.defineProperty(part, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(part, 'naturalHeight', { value: 100, configurable: true });
    button.append(part);
  } else if (kind === 'framed') {
    const frame = document.createElement('span');
    frame.className = 'shelf-figure__frame';
    part = document.createElement('img');
    part.className = 'shelf-figure__img shelf-figure__img--photo';
    part.setAttribute('src', src);
    frame.append(part);
    button.append(frame);
  } else {
    part = document.createElement('span');
    part.className = 'shelf-figure__silhouette';
    button.append(part);
  }
  part.getBoundingClientRect = () => box;
  button.getBoundingClientRect = () => box;
  document.body.append(button);
  return { button, part, src };
}

function pointStack(...elements: Element[]) {
  return { elementsFromPoint: vi.fn(() => elements) };
}

afterEach(() => {
  document.body.innerHTML = '';
  mockedGetAlphaMask.mockReset();
  mockedGetAlphaMask.mockReturnValue(undefined);
});

describe('imageFraction (object-fit: contain, object-position: bottom)', () => {
  it('maps a point to its fraction of an image that fills its box exactly', () => {
    expect(imageFraction(rect(10, 20, 100, 200), 50, 100, 60, 120)).toEqual({ u: 0.5, v: 0.5 });
    expect(imageFraction(rect(10, 20, 100, 200), 50, 100, 10, 20)).toEqual({ u: 0, v: 0 });
  });

  it('centres a narrower image across its box: the side bars fall outside 0..1', () => {
    // 100x200 image in a 200x200 box: drawn 100 wide, from x=50 to x=150.
    expect(imageFraction(rect(0, 0, 200, 200), 100, 200, 60, 100)).toEqual({ u: 0.1, v: 0.5 });
    expect(imageFraction(rect(0, 0, 200, 200), 100, 200, 40, 100)!.u).toBeLessThan(0);
    expect(imageFraction(rect(0, 0, 200, 200), 100, 200, 150, 100)!.u).toBe(1);
  });

  it('stands a wider image on the bottom of its box: above it falls outside 0..1', () => {
    // 100x50 image in a 100x200 box: drawn 50 tall, from y=150 to y=200.
    expect(imageFraction(rect(0, 0, 100, 200), 100, 50, 50, 160)).toEqual({ u: 0.5, v: 0.2 });
    expect(imageFraction(rect(0, 0, 100, 200), 100, 50, 50, 100)!.v).toBeLessThan(0);
  });

  it('is null for an image or a box with no size', () => {
    expect(imageFraction(rect(0, 0, 100, 100), 0, 100, 50, 50)).toBeNull();
    expect(imageFraction(rect(0, 0, 100, 100), 100, 0, 50, 50)).toBeNull();
    expect(imageFraction(rect(0, 0, 0, 0), 100, 100, 0, 0)).toBeNull();
  });
});

describe('figureAt (the nearest figure drawn under a point)', () => {
  it('passes a tap on a transparent pixel of the nearer figure to the figure drawn behind it', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? CLEAR : OPAQUE));
    expect(figureAt(pointStack(front.part, back.part), 50, 50)).toBe(back.button);
  });

  it('gives the tap to the nearer figure where it is drawn', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    expect(figureAt(pointStack(front.part, back.part), 50, 50)).toBe(front.button);
  });

  it('reads the mask at the point: the same figure takes one pixel and passes the next', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    // Front drawn only in its left half.
    const leftHalf = mask((x) => x < 5);
    mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? leftHalf : OPAQUE));
    expect(figureAt(pointStack(front.part, back.part), 20, 50)).toBe(front.button);
    expect(figureAt(pointStack(front.part, back.part), 80, 50)).toBe(back.button);
  });

  it('reads a one-pixel square around the point: a click reports whole pixels and a pressed figure shrinks a little', () => {
    // 1000x1000 image drawn 100x100: ten source pixels a screen pixel, so the
    // mask (256 cells) is finer than a screen pixel. A clear gap from x=50
    // to x=51.5 on screen is inside the slop; one from x=46 to x=55 is not.
    const narrow = figure('matted');
    const wide = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    const gapped = (from: number, to: number) => {
      const data = new Uint8ClampedArray(1000 * 1000 * 4);
      for (let y = 0; y < 1000; y++) for (let x = 0; x < 1000; x++) if (x < from || x >= to) data[(y * 1000 + x) * 4 + 3] = 255;
      return computeAlphaMask({ width: 1000, height: 1000, data })!;
    };
    for (const img of [narrow.part, wide.part, back.part]) {
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1000, configurable: true });
    }
    const masks: Record<string, AlphaMask> = { [narrow.src]: gapped(500, 515), [wide.src]: gapped(460, 550), [back.src]: OPAQUE };
    mockedGetAlphaMask.mockImplementation((src) => masks[src]);
    expect(figureAt(pointStack(narrow.part, back.part), 50.75, 50)).toBe(narrow.button);
    expect(figureAt(pointStack(wide.part, back.part), 50.5, 50)).toBe(back.button);
  });

  it('is null where no figure is drawn at all', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockReturnValue(CLEAR);
    expect(figureAt(pointStack(front.part, back.part, document.body), 50, 50)).toBeNull();
    expect(figureAt(pointStack(document.body), 50, 50)).toBeNull();
  });

  it('reads nothing in the part of an image box its contain-fit leaves empty', () => {
    // A 100x100 image in a 100x200 box sits in the bottom half.
    const front = figure('matted', rect(0, 0, 100, 200));
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    expect(figureAt(pointStack(front.part), 50, 50)).toBeNull();
    expect(figureAt(pointStack(front.part), 50, 150)).toBe(front.button);
  });

  it('counts a framed photo or a silhouette as drawn wherever the browser hit it', () => {
    const framed = figure('framed');
    const silhouette = figure('silhouette');
    mockedGetAlphaMask.mockReturnValue(CLEAR);
    expect(figureAt(pointStack(framed.part, silhouette.part), 50, 50, framed.button)).toBe(framed.button);
    expect(figureAt(pointStack(framed.part, silhouette.part), 50, 50, silhouette.button)).toBe(silhouette.button);
  });

  it('falls back to the whole box while the mask is not measured yet, cannot be read, or the image has not decoded', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockReturnValue(undefined);
    expect(figureAt(pointStack(front.part, back.part), 50, 50)).toBe(front.button);
    mockedGetAlphaMask.mockReturnValue(null);
    expect(figureAt(pointStack(front.part, back.part), 50, 50)).toBe(front.button);
    mockedGetAlphaMask.mockReturnValue(CLEAR);
    Object.defineProperty(front.part, 'naturalWidth', { value: 0, configurable: true });
    expect(figureAt(pointStack(front.part, back.part), 50, 50)).toBe(front.button);
  });

  it('treats an image without a src as unmeasured (its whole box)', () => {
    const front = figure('matted');
    front.part.removeAttribute('src');
    mockedGetAlphaMask.mockImplementation((src) => (src === '' ? undefined : CLEAR));
    expect(figureAt(pointStack(front.part), 50, 50)).toBe(front.button);
  });

  it('skips elements that are not figures and asks each figure once', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? CLEAR : OPAQUE));
    expect(figureAt(pointStack(document.body, front.part, front.button, back.part), 50, 50)).toBe(back.button);
    expect(mockedGetAlphaMask.mock.calls.filter(([src]) => src === front.src)).toHaveLength(1);
  });
});

describe('figureAt in a 3D case (the browser lists the figures at a point in page order, not depth order)', () => {
  // Chromium lists the elements of a 3D rendering context at a point last in
  // the page first, whatever their depth; its click target does honour depth.

  it('gives the tap to the figure the browser hit where it is drawn, not to the one it lists first', () => {
    const front = figure('matted', undefined, undefined, 0);
    const back = figure('matted', undefined, undefined, -20);
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    expect(figureAt(pointStack(back.part, front.part), 50, 50, front.button)).toBe(front.button);
  });

  it('gives it to a framed photo in front of another framed photo it covers', () => {
    const front = figure('framed', undefined, undefined, -5);
    const back = figure('framed', undefined, undefined, -15);
    expect(figureAt(pointStack(back.part, front.part), 50, 50, front.button)).toBe(front.button);
  });

  it('passes a transparent pixel of the figure the browser hit to the nearest figure drawn behind it', () => {
    const hit = figure('matted', undefined, undefined, 0);
    const middle = figure('matted', undefined, undefined, -10);
    const far = figure('matted', undefined, undefined, -20);
    mockedGetAlphaMask.mockImplementation((src) => (src === hit.src ? CLEAR : OPAQUE));
    expect(figureAt(pointStack(far.part, middle.part, hit.part), 50, 50, hit.button)).toBe(middle.button);
    expect(figureAt(pointStack(middle.part, far.part, hit.part), 50, 50, hit.button)).toBe(middle.button);
  });

  it('at equal depth, gives it to the figure later in the page (drawn over the other)', () => {
    const hit = figure('matted', undefined, undefined, 0);
    const first = figure('matted', undefined, undefined, -10);
    const second = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === hit.src ? CLEAR : OPAQUE));
    expect(figureAt(pointStack(first.part, second.part, hit.part), 50, 50, hit.button)).toBe(second.button);
    expect(figureAt(pointStack(second.part, first.part, hit.part), 50, 50, hit.button)).toBe(second.button);
  });

  it('reads a figure without a depth as depth 0', () => {
    const hit = figure('matted', undefined, undefined, 0);
    const flat = figure('matted');
    flat.button.style.removeProperty('--fig-z');
    const behind = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === hit.src ? CLEAR : OPAQUE));
    expect(figureAt(pointStack(behind.part, flat.part, hit.part), 50, 50, hit.button)).toBe(flat.button);
  });

  it('orders the figures by depth when the browser hit none of them', () => {
    const near = figure('matted', undefined, undefined, 0);
    const far = figure('matted', undefined, undefined, -20);
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    expect(figureAt(pointStack(far.part, near.part), 50, 50)).toBe(near.button);
  });
});

describe('tapTarget (which figure a click on a figure selects)', () => {
  const realElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');

  beforeEach(() => {
    mockedGetAlphaMask.mockReturnValue(CLEAR);
  });

  afterEach(() => {
    if (realElementsFromPoint) Object.defineProperty(document, 'elementsFromPoint', realElementsFromPoint);
    else delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  function listing(...elements: Element[]) {
    Object.defineProperty(document, 'elementsFromPoint', { value: vi.fn(() => elements), configurable: true });
  }

  it('resolves a real tap by its point', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? CLEAR : OPAQUE));
    listing(front.part, back.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50, target: front.part })).toBe(back.button);
  });

  it('gives a real tap to the figure it landed on where that figure is drawn, whatever the browser lists first', () => {
    const front = figure('matted', undefined, undefined, 0);
    const back = figure('matted', undefined, undefined, -20);
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    listing(back.part, front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50, target: front.part })).toBe(front.button);
  });

  it('is null for a real tap where no figure is drawn', () => {
    const front = figure('matted');
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50, target: front.part })).toBeNull();
  });

  it('keeps keyboard and assistive activation (no pointer) on the figure it was sent to', () => {
    const front = figure('matted');
    listing(front.part);
    expect(tapTarget(front.button, { detail: 0, clientX: 50, clientY: 50, target: front.button })).toBe(front.button);
  });

  it('keeps a click whose point lies outside the element it landed on (a synthetic click)', () => {
    const front = figure('matted', rect(200, 200, 100, 100));
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 0, clientY: 0, target: front.part })).toBe(front.button);
  });

  it('measures a click with no element target against the figure itself', () => {
    const front = figure('matted', rect(200, 200, 100, 100));
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 0, clientY: 0, target: null })).toBe(front.button);
    expect(tapTarget(front.button, { detail: 1, clientX: 250, clientY: 250, target: null })).toBeNull();
  });

  it('keeps the figure where the browser cannot list the elements at a point', () => {
    const front = figure('matted');
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50, target: front.part })).toBe(front.button);
  });
});
