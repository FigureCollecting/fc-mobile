import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../alphaMargin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../alphaMargin')>()),
  getAlphaMask: vi.fn(() => undefined),
}));

import { imageFraction, figureAt, tapTarget, caseTapTarget, nextPress, pressTapTarget, TAP_MOVE_PX, PRESS_CLICK_MS } from '../figureHitTest';
import type { CasePress } from '../figureHitTest';
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

  /** A 1000x1000 image drawn 100x100 (ten source pixels a screen pixel, so
   *  the mask's 256 cells are finer than a screen pixel), drawn only where
   *  `drawn(x, y)` holds, in screen px from the image's corner. */
  function fine(drawn: (x: number, y: number) => boolean): AlphaMask {
    const data = new Uint8ClampedArray(1000 * 1000 * 4);
    for (let y = 0; y < 1000; y++) for (let x = 0; x < 1000; x++) if (drawn(x / 10, y / 10)) data[(y * 1000 + x) * 4 + 3] = 255;
    return computeAlphaMask({ width: 1000, height: 1000, data })!;
  }
  function fineFigure(z = 0) {
    const f = figure('matted', rect(0, 0, 100, 100), undefined, z);
    Object.defineProperty(f.part, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(f.part, 'naturalHeight', { value: 1000, configurable: true });
    return f;
  }

  it('reads the pixel under the point: a gap in the art narrower than a pixel never swallows a tap', () => {
    // A click reports whole pixels, up to half a pixel off the finger.
    const front = fineFigure();
    const back = fineFigure(-10);
    const masks: Record<string, AlphaMask> = { [front.src]: fine((x) => x < 50 || x >= 50.8), [back.src]: OPAQUE };
    mockedGetAlphaMask.mockImplementation((src) => masks[src]);
    for (const x of [49.6, 50, 50.4, 50.8, 51.2]) expect(figureAt(pointStack(front.part, back.part), x, 50, front.button)).toBe(front.button);
  });

  it('gives a tap in a gap the pixel under the finger fits in to the figure drawn behind it', () => {
    const front = fineFigure();
    const back = fineFigure(-10);
    const masks: Record<string, AlphaMask> = { [front.src]: fine((x) => x < 50 || x >= 52), [back.src]: OPAQUE };
    mockedGetAlphaMask.mockImplementation((src) => masks[src]);
    expect(figureAt(pointStack(front.part, back.part), 51, 50, front.button)).toBe(back.button);
  });

  it('where nothing is drawn under the point, gives the tap to a figure drawn within 1.5 px of it, on every side', () => {
    const front = fineFigure();
    const sides: [string, (x: number, y: number) => boolean][] = [
      ['left', (x) => x < 48.6],
      ['right', (x) => x >= 51.4],
      ['above', (_, y) => y < 48.6],
      ['below', (_, y) => y >= 51.4],
    ];
    for (const [side, drawn] of sides) {
      mockedGetAlphaMask.mockReturnValue(fine(drawn));
      expect(figureAt(pointStack(front.part), 50, 50, front.button), side).toBe(front.button);
    }
  });

  it('opens nothing where the nearest figure art is more than 1.5 px away', () => {
    const front = fineFigure();
    mockedGetAlphaMask.mockReturnValue(fine((x, y) => x < 48.4 || x >= 51.6 || y < 48.4 || y >= 51.6));
    expect(figureAt(pointStack(front.part), 50, 50, front.button)).toBeNull();
  });

  it('prefers a figure drawn under the point to a nearer one drawn only within 1.5 px of it', () => {
    const front = fineFigure();
    const back = fineFigure(-10);
    const masks: Record<string, AlphaMask> = { [front.src]: fine((x) => x >= 51.2), [back.src]: OPAQUE };
    mockedGetAlphaMask.mockImplementation((src) => masks[src]);
    expect(figureAt(pointStack(front.part, back.part), 50, 50, front.button)).toBe(back.button);
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
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50 })).toBe(back.button);
  });

  it('gives a real tap to the figure it landed on where that figure is drawn, whatever the browser lists first', () => {
    const front = figure('matted', undefined, undefined, 0);
    const back = figure('matted', undefined, undefined, -20);
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    listing(back.part, front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50 })).toBe(front.button);
  });

  it('is null for a real tap where no figure is drawn', () => {
    const front = figure('matted');
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50 })).toBeNull();
  });

  it('resolves a real tap by its point where the pressed figure has shrunk away from it (.shelf-figure:active)', () => {
    // The press shrinks the figure 1.5 %, so a tap near its edge clicks at a
    // point outside the element it landed on.
    const front = figure('matted', rect(200, 200, 100, 100));
    const back = figure('matted', rect(150, 150, 200, 200), undefined, -10);
    listing(back.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 199, clientY: 250 })).toBeNull();
    mockedGetAlphaMask.mockImplementation((src) => (src === back.src ? OPAQUE : CLEAR));
    expect(tapTarget(front.button, { detail: 1, clientX: 199, clientY: 250 })).toBe(back.button);
  });

  it('keeps keyboard and assistive activation (no pointer: detail 0) on the figure it was sent to', () => {
    const front = figure('matted');
    listing(front.part);
    expect(tapTarget(front.button, { detail: 0, clientX: 50, clientY: 50 })).toBe(front.button);
    expect(tapTarget(front.button, { detail: 0, clientX: 0, clientY: 0 })).toBe(front.button);
  });

  it('keeps a synthetic click with no position (0, 0) on the figure it was sent to', () => {
    const front = figure('matted', rect(200, 200, 100, 100));
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 0, clientY: 0 })).toBe(front.button);
  });

  it('resolves a click at a point on either axis 0 by its point', () => {
    const front = figure('matted', rect(0, 0, 100, 100));
    listing(front.part);
    expect(tapTarget(front.button, { detail: 1, clientX: 0, clientY: 50 })).toBeNull();
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 0 })).toBeNull();
  });

  it('keeps the figure where the browser cannot list the elements at a point', () => {
    const front = figure('matted');
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    expect(tapTarget(front.button, { detail: 1, clientX: 50, clientY: 50 })).toBe(front.button);
  });
});

describe('caseTapTarget (which figure a click anywhere in the case selects)', () => {
  const realElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');

  beforeEach(() => {
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
  });

  afterEach(() => {
    if (realElementsFromPoint) Object.defineProperty(document, 'elementsFromPoint', realElementsFromPoint);
    else delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  function listing(...elements: Element[]) {
    Object.defineProperty(document, 'elementsFromPoint', { value: vi.fn(() => elements), configurable: true });
  }

  /** A case element that is not a figure, e.g. 'case__row' or 'case__plinth3d'. */
  function caseElement(className: string) {
    const el = document.createElement(className === 'case__bay' ? 'section' : 'div');
    el.className = className;
    document.body.append(el);
    return el;
  }

  it('resolves a click on a figure as tapTarget does', () => {
    const front = figure('matted');
    const back = figure('matted', undefined, undefined, -10);
    mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? CLEAR : OPAQUE));
    listing(front.part, back.part);
    expect(caseTapTarget(front.part, { detail: 1, clientX: 50, clientY: 50 })).toBe(back.button);
    expect(caseTapTarget(front.part, { detail: 0, clientX: 0, clientY: 0 })).toBe(front.button);
  });

  it('resolves by its point a click the browser sent to the shelf row (pressed on one figure, released on another)', () => {
    const seen = figure('matted', undefined, undefined, -10);
    listing(seen.part);
    expect(caseTapTarget(caseElement('case__row'), { detail: 1, clientX: 50, clientY: 50 })).toBe(seen.button);
  });

  it('resolves by its point a click the browser sent to the shelf bay (released off every figure)', () => {
    const framed = figure('framed');
    listing(framed.part);
    expect(caseTapTarget(caseElement('case__bay'), { detail: 1, clientX: 50, clientY: 50 })).toBe(framed.button);
  });

  it('is null for such a click where no figure is drawn', () => {
    const front = figure('matted');
    mockedGetAlphaMask.mockReturnValue(CLEAR);
    listing(front.part);
    expect(caseTapTarget(caseElement('case__row'), { detail: 1, clientX: 50, clientY: 50 })).toBeNull();
    listing();
    expect(caseTapTarget(caseElement('case__bay'), { detail: 1, clientX: 50, clientY: 50 })).toBeNull();
  });

  it("selects nothing on the shelf's front edge, even where a figure is drawn behind it", () => {
    for (const edge of ['case__plinth-lip3d', 'case__plinth3d']) {
      const behind = figure('framed', undefined, undefined, -10);
      const el = caseElement(edge);
      listing(el, behind.part);
      expect(caseTapTarget(el, { detail: 1, clientX: 50, clientY: 50 }), edge).toBeNull();
    }
  });

  it('selects nothing for a shelf row or bay click with no pointer position (keyboard, script)', () => {
    const seen = figure('matted');
    listing(seen.part);
    expect(caseTapTarget(caseElement('case__row'), { detail: 0, clientX: 50, clientY: 50 })).toBeNull();
    expect(caseTapTarget(caseElement('case__bay'), { detail: 1, clientX: 0, clientY: 0 })).toBeNull();
  });

  it('selects nothing for a shelf row click where the browser cannot list the elements at a point', () => {
    figure('matted');
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    expect(caseTapTarget(caseElement('case__row'), { detail: 1, clientX: 50, clientY: 50 })).toBeNull();
  });
});

describe('nextPress and pressTapTarget (a click in the case goes by where its pointer went down)', () => {
  const realElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  const realElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  let theCase: HTMLElement;

  beforeEach(() => {
    mockedGetAlphaMask.mockReturnValue(OPAQUE);
    theCase = document.body;
    landsOn(null);
  });

  afterEach(() => {
    if (realElementsFromPoint) Object.defineProperty(document, 'elementsFromPoint', realElementsFromPoint);
    else delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    if (realElementFromPoint) Object.defineProperty(document, 'elementFromPoint', realElementFromPoint);
    else delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  function listing(...elements: Element[]) {
    Object.defineProperty(document, 'elementsFromPoint', { value: vi.fn(() => elements), configurable: true });
  }

  /** The element the browser hits at any point (document.elementFromPoint). */
  function landsOn(element: Element | null) {
    const elementFromPoint = vi.fn(() => element);
    Object.defineProperty(document, 'elementFromPoint', { value: elementFromPoint, configurable: true });
    return elementFromPoint;
  }

  /** A case element that is not a figure, e.g. 'case__plinth-lip3d'. */
  function caseElement(className = 'case__plinth-lip3d') {
    const el = document.createElement('div');
    el.className = className;
    document.body.append(el);
    return el;
  }

  /** A pointer event on the case (its listener is on `theCase`), as nextPress reads it. */
  function pointer(type: string, clientX: number, clientY: number, extra: { timeStamp?: number; pointerId?: number; isPrimary?: boolean } = {}) {
    return { type, clientX, clientY, timeStamp: 1000, pointerId: 1, isPrimary: true, currentTarget: theCase, ...extra };
  }

  /** A finished press that went down at (x, y) on `chosen`, up at time 1000. */
  function press(chosen: HTMLElement | null, x = 50, y = 50, extra: Partial<CasePress> = {}): CasePress {
    return { pointerId: 1, x, y, chosen, moved: 0, endedAt: 1000, cancelled: false, ...extra };
  }

  /** A click the browser sent to `target` at (clientX, clientY), 10 ms after the press came up. */
  function click(target: Element, clientX: number, clientY: number, extra: { detail?: number; timeStamp?: number; pointerId?: number } = {}) {
    return { target, clientX, clientY, detail: 1, timeStamp: 1010, ...extra };
  }

  describe('nextPress (the press a pointer makes on the case, from its own pointer events)', () => {
    it('records where the primary pointer went down, and the figure drawn there', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      const elementFromPoint = landsOn(framed.part);
      expect(nextPress(null, pointer('pointerdown', 57.5, 99.5))).toEqual({
        pointerId: 1,
        x: 57.5,
        y: 99.5,
        chosen: framed.button,
        moved: 0,
        endedAt: null,
        cancelled: false,
      });
      expect(elementFromPoint).toHaveBeenCalledWith(57.5, 99.5);
    });

    it("chooses nothing where the pointer went down on the shelf's front edge, even over a figure", () => {
      const framed = figure('framed', rect(0, 0, 100, 100), undefined, -10);
      listing(framed.part);
      for (const edge of ['case__plinth-lip3d', 'case__plinth3d']) {
        landsOn(caseElement(edge));
        expect(nextPress(null, pointer('pointerdown', 50.5, 105.5))!.chosen, edge).toBeNull();
      }
    });

    it('resolves the drawn pixels where the pointer went down, from the element the browser hits there', () => {
      const front = figure('matted', rect(0, 0, 100, 100));
      const back = figure('matted', rect(0, 0, 100, 100), undefined, -10);
      mockedGetAlphaMask.mockImplementation((src) => (src === front.src ? CLEAR : OPAQUE));
      const elementsFromPoint = vi.fn(() => [front.part, back.part]);
      Object.defineProperty(document, 'elementsFromPoint', { value: elementsFromPoint, configurable: true });
      landsOn(front.part);
      expect(nextPress(null, pointer('pointerdown', 40.5, 40.5))!.chosen).toBe(back.button);
      expect(elementsFromPoint).toHaveBeenCalledWith(40.5, 40.5);
      landsOn(caseElement('case__row'));
      expect(nextPress(null, pointer('pointerdown', 40.5, 40.5))!.chosen).toBe(back.button);
      landsOn(caseElement('case__world'));
      expect(nextPress(null, pointer('pointerdown', 40.5, 40.5))!.chosen).toBeNull();
    });

    it('chooses nothing where the pointer went down outside the case, or on nothing at all', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      landsOn(framed.part);
      theCase = caseElement('case');
      expect(nextPress(null, pointer('pointerdown', 50, 50))!.chosen).toBeNull();
      theCase = document.body;
      landsOn(null);
      expect(nextPress(null, pointer('pointerdown', 50, 50))!.chosen).toBeNull();
    });

    it('records no press where the browser cannot hit-test a point', () => {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      expect(nextPress(null, pointer('pointerdown', 50, 50))).toBeNull();
    });

    it('starts over on every new press, and ignores a second finger going down', () => {
      const first = nextPress(null, pointer('pointerdown', 10, 10));
      expect(nextPress(first, pointer('pointerdown', 90, 90, { pointerId: 2, isPrimary: false }))).toBe(first);
      expect(nextPress(first, pointer('pointerdown', 90, 90, { pointerId: 2 }))).toMatchObject({ pointerId: 2, x: 90, y: 90 });
      expect(nextPress(null, pointer('pointerdown', 90, 90, { pointerId: 2, isPrimary: false }))).toBeNull();
    });

    it('keeps the farthest the pointer got from where it went down, and when it came up', () => {
      let p = nextPress(null, pointer('pointerdown', 10, 10));
      p = nextPress(p, pointer('pointermove', 13, 14));
      p = nextPress(p, pointer('pointermove', 11, 10));
      expect(p).toMatchObject({ x: 10, y: 10, moved: 5, endedAt: null });
      p = nextPress(p, pointer('pointerup', 10, 10, { timeStamp: 1234 }));
      expect(p).toMatchObject({ x: 10, y: 10, moved: 5, endedAt: 1234, cancelled: false });
    });

    it('counts the release point as a move too', () => {
      const p = nextPress(nextPress(null, pointer('pointerdown', 0, 0)), pointer('pointerup', 6, 8, { timeStamp: 1100 }));
      expect(p).toMatchObject({ moved: 10, endedAt: 1100 });
    });

    it('marks a press the browser cancelled (a scroll took it), without reading the cancel point', () => {
      const p = nextPress(nextPress(null, pointer('pointerdown', 50, 50)), pointer('pointercancel', 0, 0, { timeStamp: 1300 }));
      expect(p).toMatchObject({ moved: 0, endedAt: 1300, cancelled: true });
    });

    it('ignores other pointers, other events, events with no press, and events after the press ended', () => {
      const down = nextPress(null, pointer('pointerdown', 10, 10));
      expect(nextPress(down, pointer('pointermove', 90, 90, { pointerId: 2 }))).toBe(down);
      expect(nextPress(down, pointer('pointerup', 90, 90, { pointerId: 2 }))).toBe(down);
      expect(nextPress(down, pointer('pointerover', 90, 90))).toBe(down);
      expect(nextPress(null, pointer('pointerup', 90, 90))).toBeNull();
      const up = nextPress(down, pointer('pointerup', 10, 10, { timeStamp: 1100 }));
      expect(nextPress(up, pointer('pointermove', 90, 90))).toBe(up);
      expect(nextPress(up, pointer('pointercancel', 90, 90))).toBe(up);
    });
  });

  describe('pressTapTarget (which figure a click in the case selects)', () => {
    it('selects the figure its press landed on, not the one the browser moved the click to', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      const other = figure('framed', rect(200, 0, 100, 100));
      listing(other.part);
      expect(pressTapTarget(click(other.part, 250, 50), press(framed.button))).toBe(framed.button);
      expect(pressTapTarget(click(caseElement(), 51, 100), press(framed.button, 50.5, 99.5))).toBe(framed.button);
    });

    it('selects nothing where its press landed on no figure, though the browser moved the click onto one', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      expect(caseTapTarget(framed.part, click(framed.part, 50, 99))).toBe(framed.button);
      expect(pressTapTarget(click(framed.part, 50, 99), press(null, 50.5, 105.5))).toBeNull();
    });

    it('never counts a drag as a tap: a press that moved farther than TAP_MOVE_PX selects nothing', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      expect(pressTapTarget(click(framed.part, 50, 50), press(framed.button, 50, 50, { moved: TAP_MOVE_PX }))).toBe(framed.button);
      expect(pressTapTarget(click(framed.part, 50, 50), press(framed.button, 50, 50, { moved: TAP_MOVE_PX + 0.1 }))).toBeNull();
    });

    it('never counts a press the browser cancelled (a scroll) as a tap', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      expect(pressTapTarget(click(framed.part, 50, 50), press(framed.button, 50, 50, { cancelled: true }))).toBeNull();
    });

    it('keeps keyboard and assistive activation (no position) on the figure it was sent to, whatever the last press', () => {
      const framed = figure('framed', rect(0, 0, 100, 100));
      listing(framed.part);
      expect(pressTapTarget(click(framed.button, 0, 0, { detail: 0 }), press(null))).toBe(framed.button);
      expect(pressTapTarget(click(framed.button, 50, 50, { detail: 0 }), press(null))).toBe(framed.button);
      expect(pressTapTarget(click(framed.button, 0, 0), press(null))).toBe(framed.button);
    });

    it('goes by the click itself when no press of its own came before it', () => {
      const front = figure('matted', rect(0, 0, 100, 100));
      listing(front.part);
      const at = (extra: Parameters<typeof click>[3], p: CasePress | null) => pressTapTarget(click(front.part, 50, 50, extra), p);
      // Its own press: it landed on no figure.
      expect(at({}, press(null))).toBeNull();
      expect(at({ timeStamp: 1000 + PRESS_CLICK_MS }, press(null))).toBeNull();
      expect(at({ pointerId: 1 }, press(null))).toBeNull();
      // None, still down, long over, or another pointer's: the click's own target and point.
      expect(at({}, null)).toBe(front.button);
      expect(at({}, press(null, 50, 50, { endedAt: null }))).toBe(front.button);
      expect(at({ timeStamp: 1001 + PRESS_CLICK_MS }, press(null))).toBe(front.button);
      expect(at({ pointerId: 7 }, press(null))).toBe(front.button);
    });
  });
});
