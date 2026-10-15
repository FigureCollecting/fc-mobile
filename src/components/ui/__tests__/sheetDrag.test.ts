import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachSheetDrag, releaseVelocity, restFor, rubberBand, RUBBER, SLOP_PX, type SheetDriver } from '../sheetDrag';

/** A driver that records what the controller asks of it; `y` is where the card stands. */
function fakeDriver(start = 0) {
  const calls: string[] = [];
  const driver: SheetDriver & { y: number; calls: string[] } = {
    y: start,
    calls,
    get() {
      return this.y;
    },
    set(y) {
      calls.push(`set ${Math.round(y)}`);
      this.y = y;
    },
    settle(y) {
      calls.push(`settle ${Math.round(y)}`);
      this.y = y;
    },
    stop() {
      calls.push('stop');
    },
  };
  return driver;
}

function pointer(type: string, init: { clientY: number; pointerId?: number; pointerType?: string; button?: number }) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', button: 0, ...init });
}

/** jsdom has no Touch constructor: a plain event carrying the one field the controller reads. */
function touch(type: string, ys: number[], cancelable = true) {
  const e = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(e, 'touches', { value: ys.map((clientY) => ({ clientY })) });
  return e;
}

describe('restFor', () => {
  const detents = [20, 300];
  it('a slow release rests on the nearest detent', () => {
    expect(restFor(140, 0, detents, 600)).toBe(0);
    expect(restFor(170, 0, detents, 600)).toBe(1);
  });
  it('projects the release velocity ahead: a flick goes on to the next detent', () => {
    expect(restFor(260, -1500, detents, 600)).toBe(0);
    expect(restFor(60, 1500, detents, 600)).toBe(1);
  });
  it('closes only past the midpoint to off screen, and never where it may not close', () => {
    expect(restFor(440, 0, detents, 600)).toBe(1);
    expect(restFor(460, 0, detents, 600)).toBe('close');
    expect(restFor(320, 1500, detents, 600)).toBe('close');
    expect(restFor(900, 3000, detents, null)).toBe(1);
  });
  it('exactly halfway between the lowest detent and off screen, it stays', () => {
    expect(restFor(450, 0, detents, 600)).toBe(1);
  });
  it('with no detent at all it closes', () => {
    expect(restFor(10, 0, [], 600)).toBe('close');
  });
  it('a tie keeps the higher detent', () => {
    expect(restFor(160, 0, detents, null)).toBe(0);
  });
});

describe('rubberBand', () => {
  it('moves freely at or below the top detent, and a quarter as far past it', () => {
    expect(rubberBand(50, 20)).toBe(50);
    expect(rubberBand(20.5, 20)).toBe(20.5);
    expect(rubberBand(20, 20)).toBe(20);
    expect(rubberBand(-20, 20)).toBe(20 - 40 * RUBBER);
  });
});

describe('releaseVelocity', () => {
  it('px per second over the last 100 ms of samples', () => {
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 900, y: 0 }, { t: 950, y: 10 }, { t: 1000, y: 30 }])).toBeCloseTo(300);
  });
  it('is 0 with fewer than two recent samples or none spread in time', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 5, y: 9 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 500, y: 40 }])).toBe(0);
    expect(releaseVelocity([{ t: 5, y: 0 }, { t: 5, y: 40 }])).toBe(0);
  });
});

describe('attachSheetDrag', () => {
  let sheet: HTMLElement;
  let handle: HTMLElement;
  let content: HTMLElement;
  let button: HTMLElement;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  let onSettle: ReturnType<typeof vi.fn<(index: number) => void>>;
  let detach: () => void;
  let driver: ReturnType<typeof fakeDriver>;
  let settleTo: (index: number) => void;
  let detents: number[];

  function attach(closeY: number | null = 600) {
    const c = attachSheetDrag(sheet, content, driver, { detents: () => detents, closeY: () => closeY, onSettle, onClose });
    detach = c.detach;
    settleTo = c.settleTo;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sheet = document.createElement('div');
    handle = document.createElement('div');
    content = document.createElement('div');
    button = document.createElement('button');
    content.appendChild(button);
    sheet.append(handle, content);
    document.body.appendChild(sheet);
    driver = fakeDriver(300);
    detents = [20, 300];
    onClose = vi.fn<() => void>();
    onSettle = vi.fn<(index: number) => void>();
    attach();
  });

  afterEach(() => {
    detach();
    sheet.remove();
    vi.useRealTimers();
  });

  describe('the handle (any part of the card outside its contents)', () => {
    it('follows the finger once it moves past the slop, stopping any settle first', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 400 - (SLOP_PX - 1) }));
      expect(driver.calls).toEqual([]);
      window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 340 }));
      expect(driver.calls).toEqual(['stop', 'set 300', 'set 250']);
    });

    it('on release settles on the nearest detent and says which', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 200 }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(pointer('pointerup', { clientY: 200 }));
      expect(driver.calls.at(-1)).toBe('settle 20');
      expect(onSettle).toHaveBeenCalledWith(0);
    });

    it('a pointercancel releases it like a lift', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 380 }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(pointer('pointercancel', { clientY: 380 }));
      expect(driver.calls.at(-1)).toBe('settle 300');
    });

    it('dragged far down, it closes', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 100 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 110 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 300 }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(pointer('pointerup', { clientY: 300 }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(driver.calls.some((c) => c.startsWith('settle'))).toBe(false);
    });

    it('resists past the top detent', () => {
      driver.y = 20;
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 350 }));
      expect(driver.y).toBe(20 - 40 * RUBBER);
    });

    it('a move of just the slop is a drag', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 400 - SLOP_PX }));
      expect(driver.calls).toEqual(['stop', 'set 300']);
    });

    it('a tap (no move past the slop) moves nothing and settles nothing', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointerup', { clientY: 401 }));
      expect(driver.calls).toEqual([]);
      expect(onSettle).not.toHaveBeenCalled();
    });

    it('ignores a mouse button other than the main one, another pointer, and a finger on the contents', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400, pointerType: 'mouse', button: 2 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 300, pointerType: 'mouse' }));
      button.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 300 }));
      expect(driver.calls).toEqual([]);
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400, pointerId: 7 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 300, pointerId: 8 }));
      window.dispatchEvent(pointer('pointerup', { clientY: 300, pointerId: 8 }));
      expect(driver.calls).toEqual([]);
    });

    it('a mouse drag on the handle works too', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400, pointerType: 'mouse' }));
      window.dispatchEvent(pointer('pointermove', { clientY: 380, pointerType: 'mouse' }));
      window.dispatchEvent(pointer('pointermove', { clientY: 370, pointerType: 'mouse' }));
      expect(driver.y).toBe(290);
    });
  });

  describe('a drag is no tap (the browser still sends a click for a touch that moved less than its own tap slop)', () => {
    /** A click on `el` as the browser sends it after a lift; whether it reached `el`'s own listener. */
    function click(el: HTMLElement) {
      const reached = vi.fn();
      el.addEventListener('click', reached);
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      el.removeEventListener('click', reached);
      return { reached: reached.mock.calls.length > 0, prevented: e.defaultPrevented };
    }

    function dragHandle() {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 412 }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(pointer('pointerup', { clientY: 412 }));
    }

    it('the click that follows a drag on the handle never reaches the handle', () => {
      dragHandle();
      expect(click(handle)).toEqual({ reached: false, prevented: true });
    });

    it('the click that follows a card drag from the contents never reaches what the finger was on', () => {
      button.dispatchEvent(pointer('pointerdown', { clientY: 100 }));
      button.dispatchEvent(touch('touchstart', [100]));
      button.dispatchEvent(touch('touchmove', [108]));
      vi.advanceTimersByTime(200);
      button.dispatchEvent(touch('touchend', []));
      expect(click(button).reached).toBe(false);
    });

    it('only that one click: the next tap goes through', () => {
      dragHandle();
      click(handle);
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointerup', { clientY: 400 }));
      expect(click(handle)).toEqual({ reached: true, prevented: false });
    });

    it('a drag the browser sent no click for (past its slop) leaves the next tap alone', () => {
      dragHandle();
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointerup', { clientY: 400 }));
      expect(click(handle).reached).toBe(true);
    });

    it('a tap (no drag) is a click', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
      window.dispatchEvent(pointer('pointerup', { clientY: 401 }));
      expect(click(handle).reached).toBe(true);
    });

    it('a drag that closes the card still swallows its click, though the card lets go of the finger as it leaves', () => {
      handle.dispatchEvent(pointer('pointerdown', { clientY: 100 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 110 }));
      window.dispatchEvent(pointer('pointermove', { clientY: 300 }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(pointer('pointerup', { clientY: 300 }));
      expect(onClose).toHaveBeenCalledTimes(1);
      detach();
      detach = () => {};
      expect(click(handle).reached).toBe(false);
    });
  });

  describe('the contents', () => {
    it('at their top, a finger pulling down moves the card with it and keeps the browser from scrolling', () => {
      content.scrollTop = 0;
      button.dispatchEvent(touch('touchstart', [100]));
      const move = touch('touchmove', [104]);
      button.dispatchEvent(move);
      expect(move.defaultPrevented).toBe(true);
      button.dispatchEvent(touch('touchmove', [130]));
      expect(driver.calls).toEqual(['stop', 'set 304', 'set 330']);
      vi.advanceTimersByTime(200);
      button.dispatchEvent(touch('touchend', []));
      expect(driver.calls.at(-1)).toBe('settle 300');
      expect(onSettle).toHaveBeenCalledWith(1);
    });

    it('scrolled down, a finger pulling down scrolls them home first, then takes the card from there at finger speed', () => {
      content.scrollTop = 30;
      button.dispatchEvent(touch('touchstart', [100]));
      const scrolling = touch('touchmove', [110]);
      button.dispatchEvent(scrolling);
      expect(scrolling.defaultPrevented).toBe(false);
      expect(driver.calls).toEqual([]);
      // the browser scrolled them home meanwhile; its moves can no longer be cancelled
      content.scrollTop = 0;
      button.dispatchEvent(touch('touchmove', [140], false));
      button.dispatchEvent(touch('touchmove', [160], false));
      expect(driver.calls).toEqual(['stop', 'set 330', 'set 350']);
    });

    it('with the card below its top detent, a finger pushing up raises the card first', () => {
      button.dispatchEvent(touch('touchstart', [300]));
      button.dispatchEvent(touch('touchmove', [290]));
      expect(driver.y).toBe(290);
    });

    it('with the card at its top detent, a finger pushing up scrolls the contents, and a turn downward mid-scroll is still a scroll until they are home', () => {
      driver.y = 20;
      content.scrollTop = 50;
      button.dispatchEvent(touch('touchstart', [300]));
      button.dispatchEvent(touch('touchmove', [290]));
      button.dispatchEvent(touch('touchmove', [295]));
      expect(driver.calls).toEqual([]);
      button.dispatchEvent(touch('touchend', []));
      expect(driver.calls).toEqual([]);
    });

    it('below its top detent, a finger that started by scrolling the contents down keeps scrolling when it turns up', () => {
      content.scrollTop = 50;
      button.dispatchEvent(touch('touchstart', [300]));
      button.dispatchEvent(touch('touchmove', [310]));
      button.dispatchEvent(touch('touchmove', [290]));
      expect(driver.calls).toEqual([]);
    });

    it('a move that does not move does nothing; neither does a second finger', () => {
      button.dispatchEvent(touch('touchstart', [300]));
      button.dispatchEvent(touch('touchmove', [300]));
      expect(driver.calls).toEqual([]);
      button.dispatchEvent(touch('touchstart', [300, 320]));
      button.dispatchEvent(touch('touchmove', [340, 360]));
      button.dispatchEvent(touch('touchend', []));
      expect(driver.calls).toEqual([]);
    });

    it('a first move that does not move leaves the finger undecided: pushing up next still raises the card', () => {
      button.dispatchEvent(touch('touchstart', [300]));
      button.dispatchEvent(touch('touchmove', [300]));
      button.dispatchEvent(touch('touchmove', [290]));
      expect(driver.y).toBe(290);
    });

    it('a move with no finger down first does nothing', () => {
      button.dispatchEvent(touch('touchmove', [340]));
      expect(driver.calls).toEqual([]);
    });

    it('a touchcancel releases a card it holds', () => {
      button.dispatchEvent(touch('touchstart', [100]));
      button.dispatchEvent(touch('touchmove', [120]));
      vi.advanceTimersByTime(200);
      button.dispatchEvent(touch('touchcancel', []));
      expect(driver.calls.at(-1)).toBe('settle 300');
    });
  });

  it('settleTo settles on a detent by index and says so', () => {
    settleTo(0);
    expect(driver.calls).toEqual(['settle 20']);
    expect(onSettle).toHaveBeenCalledWith(0);
  });

  it('settleTo past the last detent takes the last', () => {
    settleTo(5);
    expect(driver.calls).toEqual(['settle 300']);
  });

  it('a resize puts the card back on its detent, measured anew', () => {
    settleTo(1);
    detents = [10, 250];
    window.dispatchEvent(new Event('resize'));
    expect(driver.calls.slice(-2)).toEqual(['stop', 'set 250']);
  });

  it('a resize that leaves its detent where it was does nothing, so an opening settle runs on', () => {
    settleTo(1);
    window.dispatchEvent(new Event('resize'));
    expect(driver.calls).toEqual(['settle 300']);
  });

  it("a change in the card's own size (its contents) puts it back on its detent too", () => {
    detach();
    const observed: Array<() => void> = [];
    const RO = vi.fn(function (this: unknown, cb: () => void) {
      observed.push(cb);
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', RO);
    const c = attachSheetDrag(sheet, content, driver, { detents: () => detents, closeY: () => null, onSettle, onClose });
    detach = c.detach;
    c.settleTo(1);
    detents = [20, 340];
    observed[0]();
    expect(driver.calls.slice(-2)).toEqual(['stop', 'set 340']);
    c.detach();
    detach = () => {};
    vi.unstubAllGlobals();
  });

  it('a resize mid-drag leaves the finger in charge', () => {
    settleTo(1);
    detents = [10, 250];
    handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
    window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
    const before = driver.calls.length;
    window.dispatchEvent(new Event('resize'));
    expect(driver.calls.length).toBe(before);
  });

  it('detach removes every listener', () => {
    detach();
    handle.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
    window.dispatchEvent(pointer('pointermove', { clientY: 300 }));
    button.dispatchEvent(touch('touchstart', [100]));
    button.dispatchEvent(touch('touchmove', [150]));
    window.dispatchEvent(new Event('resize'));
    expect(driver.calls).toEqual([]);
    detach = () => {};
  });

  it('without a contents element, a finger anywhere on the card is the handle', () => {
    detach();
    const c = attachSheetDrag(sheet, null, driver, { detents: () => detents, closeY: () => null, onSettle, onClose });
    detach = c.detach;
    button.dispatchEvent(pointer('pointerdown', { clientY: 400 }));
    window.dispatchEvent(pointer('pointermove', { clientY: 390 }));
    window.dispatchEvent(pointer('pointermove', { clientY: 380 }));
    expect(driver.y).toBe(290);
  });
});
