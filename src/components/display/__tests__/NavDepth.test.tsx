import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { NavDepth } from '../NavDepth';
import { DEPTH_DEAD, DEPTH_FULL_PX } from '../caseDepth';
import type { DepthDrive } from '../../../stores/jog';

// NAV-FLOAT (handoff FINAL 11-17): the left Z, floating over the case: the vertical depth rocker of NAV-DEPTH-3 (Ross
// 11-13), shorter and narrower. Spring-centred: the reach of the finger from where it went down, over DEPTH_FULL_PX, is
// the drive's r in [-1, 1] (the scene's depthStart / depthRate / depthStop; up = closer); the lift, a pointercancel or
// the capture lost springs it back to the centre and stops the drive. The horizontal slider is retired.

type Drive = { [K in keyof DepthDrive]: ReturnType<typeof vi.fn> } & DepthDrive;
const drive = (): Drive => ({ start: vi.fn(() => true), rate: vi.fn(), stop: vi.fn() }) as Drive;
const rail = () => document.querySelector('[data-nav="depth"]') as HTMLElement;
const down = (x: number, y: number, id = 1) => fireEvent.pointerDown(rail(), { pointerId: id, clientX: x, clientY: y, button: 0 });
const move = (x: number, y: number, id = 1) => fireEvent.pointerMove(rail(), { pointerId: id, clientX: x, clientY: y });
const up = (x: number, y: number, id = 1) => fireEvent.pointerUp(rail(), { pointerId: id, clientX: x, clientY: y });
/** The knob's shown reach (--depth-k: -1 top, +1 bottom); '' at rest. */
const knob = () => rail().style.getPropertyValue('--depth-k');

afterEach(() => cleanup());

describe('the Z rail: what it is', () => {
  it('a vertical slider named for what it does, at rest in the middle; no shape to choose', () => {
    render(<NavDepth depth={drive()} />);
    const r = screen.getByRole('slider', { name: /closer/i });
    expect(r).toBe(rail());
    expect(r.getAttribute('aria-label')).toBe('Move closer or back: hold and push up or down');
    expect(r.getAttribute('aria-orientation')).toBe('vertical');
    expect([r.getAttribute('aria-valuemin'), r.getAttribute('aria-valuemax'), r.getAttribute('aria-valuenow')]).toEqual(['-1', '1', '0']);
    expect(r.hasAttribute('data-shape')).toBe(false);
    expect(r.querySelector('.nav-depth__knob')).not.toBeNull();
  });
});

describe('the Z rail: push up = closer, down = back away', () => {
  it('starts once past the dead zone at r = reach / DEPTH_FULL_PX, its rate each move after, to +-1 at most; the lift stops it at the centre', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    // (from y 0: the dead zone's edge, DEPTH_DEAD * DEPTH_FULL_PX, is that exact travel)
    down(100, 0);
    // at the dead zone's edge: nothing starts
    move(100, -DEPTH_DEAD * DEPTH_FULL_PX);
    expect(d.start).not.toHaveBeenCalled();
    expect(rail().hasAttribute('data-rocking')).toBe(false);
    move(100, -DEPTH_FULL_PX / 4);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.start).toHaveBeenCalledWith(0.25);
    expect(d.rate).not.toHaveBeenCalled();
    expect(rail().dataset.rocking).toBe('');
    expect(Number(knob())).toBeCloseTo(-0.25, 9);
    move(100, -DEPTH_FULL_PX / 2);
    expect(d.rate).toHaveBeenLastCalledWith(0.5);
    // past full reach: full
    move(100, -DEPTH_FULL_PX * 3);
    expect(d.rate).toHaveBeenLastCalledWith(1);
    expect(Number(knob())).toBe(-1);
    // down past the centre: back away
    move(100, DEPTH_FULL_PX / 2);
    expect(d.rate).toHaveBeenLastCalledWith(-0.5);
    move(100, DEPTH_FULL_PX * 2);
    expect(d.rate).toHaveBeenLastCalledWith(-1);
    expect(Number(knob())).toBe(1);
    // a sideways wobble is no reach
    move(160, DEPTH_FULL_PX * 2);
    expect(d.rate).toHaveBeenLastCalledWith(-1);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.stop).not.toHaveBeenCalled();
    up(160, DEPTH_FULL_PX * 2);
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(knob()).toBe('');
    expect(rail().hasAttribute('data-rocking')).toBe(false);
  });

  it('back inside the dead zone it is not let go: the rate goes on (the drive moves nothing there: DEPTH_DEAD)', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400);
    move(100, 400 - DEPTH_FULL_PX / 2);
    move(100, 400 - 1);
    expect(d.rate).toHaveBeenLastCalledWith(1 / DEPTH_FULL_PX);
    expect(d.stop).not.toHaveBeenCalled();
    up(100, 399);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('a press that never leaves the dead zone starts and stops nothing', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400);
    move(102, 402);
    up(102, 402);
    expect(d.start).not.toHaveBeenCalled();
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('a start the scene refuses (a finger on it already): no rate, no stop, no knob, until the next press', () => {
    const d = drive();
    d.start.mockReturnValue(false);
    render(<NavDepth depth={d} />);
    down(100, 400);
    move(100, 380);
    move(100, 370);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.rate).not.toHaveBeenCalled();
    expect(knob()).toBe('');
    expect(rail().hasAttribute('data-rocking')).toBe(false);
    up(100, 370);
    expect(d.stop).not.toHaveBeenCalled();
    // the next press asks again
    d.start.mockReturnValue(true);
    down(100, 400);
    move(100, 380);
    expect(d.start).toHaveBeenCalledTimes(2);
    up(100, 380);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('a pointercancel (the browser took the finger) stops it at the centre', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400);
    move(100, 380);
    fireEvent.pointerCancel(rail(), { pointerId: 1, clientX: 100, clientY: 380 });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(knob()).toBe('');
  });

  it('another finger\'s press, moves and lifts are not its own', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400, 1);
    move(100, 380, 1);
    down(100, 300, 2);
    move(100, 200, 2);
    expect(d.rate).not.toHaveBeenCalled();
    up(100, 200, 2);
    fireEvent.pointerCancel(rail(), { pointerId: 2, clientX: 100, clientY: 200 });
    expect(d.stop).not.toHaveBeenCalled();
    move(100, 400 - DEPTH_FULL_PX, 1);
    expect(d.rate).toHaveBeenLastCalledWith(1);
    up(100, 364, 1);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('withdrawn mid-push (the case goes): the drive it started is stopped, once', () => {
    const d = drive();
    const { unmount } = render(<NavDepth depth={d} />);
    down(100, 400);
    move(100, 380);
    unmount();
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('withdrawn with no drive running stops nothing', () => {
    const d = drive();
    const { unmount } = render(<NavDepth depth={d} />);
    down(100, 400);
    unmount();
    expect(d.stop).not.toHaveBeenCalled();
  });
});

// chal1 S1/S2 (NAV-DEPTH-3): the drive starts from rest either way, with the reach the finger has: a first push back is
// back; the dead zone is 3.6 px (DEPTH_DEAD of 36) wide and full reach is 36 px, in figures.
describe('the start from rest: either way, just past the dead zone', () => {
  // (from 0, 0: the travel is the exact figure, with no rounding from a subtraction)
  for (const [way, sign] of [['up (closer)', 1], ['down (back)', -1]] as const) {
    it(`${way}: 3.6 px starts nothing, 4 px starts at r = ${sign > 0 ? '+' : '-'}4 / 36; 18 px is half reach, 36 px full`, () => {
      const d = drive();
      render(<NavDepth depth={d} />);
      const at = (px: number): [number, number] => [0, -sign * px];
      down(0, 0);
      move(...at(3.6));
      expect(d.start).not.toHaveBeenCalled();
      move(...at(4));
      expect(d.start).toHaveBeenCalledTimes(1);
      expect(d.start.mock.calls[0][0]).toBeCloseTo((sign * 4) / 36, 9);
      move(...at(18));
      expect(d.rate.mock.calls.at(-1)![0]).toBeCloseTo(sign * 0.5, 9);
      move(...at(36));
      expect(d.rate).toHaveBeenLastCalledWith(sign);
      up(...at(36));
      expect(d.stop).toHaveBeenCalledTimes(1);
    });
  }
});

// chal1 NOTE-1 (NAV-DEPTH-3): the capture lost mid-push (the browser or a script releases it), no lift will reach the
// rail: it springs back and the drive stops there.
describe('the capture lost mid-push', () => {
  it('springs back and stops the drive, once; the lift that comes later stops nothing more', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400);
    move(100, 380);
    expect(rail().dataset.rocking).toBe('');
    fireEvent.lostPointerCapture(rail(), { pointerId: 1 });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(knob()).toBe('');
    expect(rail().hasAttribute('data-rocking')).toBe(false);
    move(100, 360);
    up(100, 360);
    expect(d.rate).not.toHaveBeenCalled();
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('another pointer\'s lost capture is not its own', () => {
    const d = drive();
    render(<NavDepth depth={d} />);
    down(100, 400, 1);
    move(100, 380, 1);
    fireEvent.lostPointerCapture(rail(), { pointerId: 2 });
    expect(d.stop).not.toHaveBeenCalled();
    up(100, 380, 1);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });
});
