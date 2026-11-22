import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { NavHat } from '../NavHat';
import { EYE_SLOT_DEG, HAT_KNOB_PX, HAT_RING_PX } from '../navTuning';
import { FUSED_PATH, RING_PATH } from '../navEyeShape';
import { JOG_DEAD_PX, JOG_FULL_PX, JOG_MAX_X, jogDetents, jogSpeed } from '../casePose';
import type { JogTarget } from '../../../stores/jog';

// NAV-FLOAT (handoff FINAL 11-17): the right XY hat, floating over the case. The jog the bottom-centre button used to be
// (NAV-JOG, Ross 10-28): press, hold and drag moves the camera the way the thumb goes, faster the farther (the scene's
// jogStep, untouched), and the lift, a pointercancel or the capture lost stops it. The knob shows the thumb's reach over
// the ring; a tap does nothing (Add is the header's).

type Jog = { [K in 'start' | 'aim' | 'stop']: ReturnType<typeof vi.fn> } & JogTarget;
const jogOf = (patch: Partial<JogTarget> = {}): Jog => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn(), ...patch }) as Jog;
const hat = () => document.querySelector('[data-nav="hat"]') as HTMLElement;
const down = (x: number, y: number, id = 1) => fireEvent.pointerDown(hat(), { pointerId: id, clientX: x, clientY: y, button: 0 });
const move = (x: number, y: number, id = 1) => fireEvent.pointerMove(hat(), { pointerId: id, clientX: x, clientY: y });
const lift = (x: number, y: number, id = 1) => fireEvent.pointerUp(hat(), { pointerId: id, clientX: x, clientY: y });
/** The knob's shown reach, as fractions of the ring's free radius (x right, y down); ['', ''] at rest. */
const knob = () => [hat().style.getPropertyValue('--hat-x'), hat().style.getPropertyValue('--hat-y')];

afterEach(() => cleanup());

describe('the hat: what it is', () => {
  it('a named group with a knob; with no Look on offer, no button: nothing to tap', () => {
    render(<NavHat jog={jogOf()} />);
    expect(screen.getByRole('group', { name: /move the camera/i })).toBe(hat());
    expect(hat().querySelector('.nav-hat__knob')).not.toBeNull();
    expect(hat().querySelector('button')).toBeNull();
    expect(hat().hasAttribute('data-jog')).toBe(false);
  });

  it('NAV-EYE: with Look on offer, its one button is the eye, on the upper-left shoulder, out of the way of every arrow', () => {
    render(<NavHat jog={jogOf({ look: { start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() } })} />);
    const buttons = hat().querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].dataset.nav).toBe('eye');
    expect(EYE_SLOT_DEG).toBe(135);
    // the four arrows sit on the axes: none within 30 degrees of the slot
    const ways = Array.from(hat().querySelectorAll<SVGElement>('.nav-hat__arrow')).map((a) => Number(a.dataset.deg));
    expect(ways.sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    for (const deg of ways) expect(Math.abs(deg - EYE_SLOT_DEG)).toBeGreaterThanOrEqual(30);
  });

  it('NAV-EYE shape (Ross 11-22): the hat draws one fused outline, the ring and the eye\'s bubble; with no eye, the ring alone', () => {
    const outline = () => hat().querySelectorAll<SVGPathElement>('.nav-hat__shell .nav-hat__outline');
    render(<NavHat jog={jogOf({ look: { start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() } })} />);
    expect(outline()).toHaveLength(1);
    expect(outline()[0].getAttribute('d')).toBe(FUSED_PATH);
    const shell = hat().querySelector('.nav-hat__shell')!;
    expect(shell.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(shell.getAttribute('aria-hidden')).toBe('true');
    // drawn first, under the arrows, the knob and the eye
    expect(hat().firstElementChild).toBe(shell);
    // through the sheet, never a style attribute (the CSP)
    expect(hat().querySelectorAll('[style]')).toHaveLength(0);
    cleanup();
    render(<NavHat jog={jogOf()} />);
    expect(outline()).toHaveLength(1);
    expect(outline()[0].getAttribute('d')).toBe(RING_PATH);
  });
});

describe('the hat: press, hold and drag', () => {
  it('starts once past 8 px, aims at the thumb\'s offset each move, stops on the lift', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    move(204, 497);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.aim).not.toHaveBeenCalled();
    move(230, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(30, 0);
    expect(hat().dataset.jogging).toBe('');
    move(200, 440);
    expect(t.aim).toHaveBeenLastCalledWith(0, -60);
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(200, 440);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(hat().hasAttribute('data-jogging')).toBe(false);
    expect(knob()).toEqual(['', '']);
    // another finger's moves and lifts are not the jog's
    down(200, 500, 1);
    move(260, 500, 2);
    lift(260, 500, 2);
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(200, 500, 1);
  });

  it('the knob shows the reach over the ring: the thumb\'s way, min(d, JOG_FULL_PX) / JOG_FULL_PX of the free radius', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    // half reach, straight right
    move(200 + JOG_FULL_PX / 2, 500);
    expect(knob().map(Number)).toEqual([0.5, 0]);
    // full reach, straight up
    move(200, 500 - JOG_FULL_PX);
    expect(knob().map(Number)).toEqual([0, -1]);
    // a thumb far outside the ring: the knob stays on it, the aim is the thumb's own
    move(200 + 3 * JOG_FULL_PX, 500 + 4 * JOG_FULL_PX);
    expect(t.aim).toHaveBeenLastCalledWith(3 * JOG_FULL_PX, 4 * JOG_FULL_PX);
    const [kx, ky] = knob().map(Number);
    expect(kx).toBeCloseTo(0.6, 9);
    expect(ky).toBeCloseTo(0.8, 9);
    expect(Math.hypot(kx, ky)).toBeCloseTo(1, 9);
    lift(0, 0);
    // the ring's free radius is what the knob can travel without leaving it, at both sizes
    for (const ring of Object.values(HAT_RING_PX)) expect((ring - HAT_KNOB_PX) / 2).toBeGreaterThan(0);
  });

  it('a tap, or a press that wobbles inside 8 px, starts and stops nothing', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    move(203, 504);
    lift(203, 504);
    fireEvent.click(hat());
    expect(t.start).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    expect(knob()).toEqual(['', '']);
  });

  it('a drag of exactly 8 px is no jog; a hair past it is', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    move(200 + JOG_DEAD_PX, 500);
    lift(200 + JOG_DEAD_PX, 500);
    expect(t.start).not.toHaveBeenCalled();
    down(200, 500);
    move(200 + JOG_DEAD_PX + 0.5, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(208.5, 500);
  });

  it('a drag the scene refuses (a finger already on it) neither aims nor shows; the next press asks again', () => {
    const t = jogOf();
    t.start.mockReturnValue(false);
    render(<NavHat jog={t} />);
    down(200, 500);
    move(240, 500);
    move(260, 500);
    lift(260, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    expect(hat().hasAttribute('data-jogging')).toBe(false);
    expect(knob()).toEqual(['', '']);
    t.start.mockReturnValue(true);
    down(200, 500);
    move(240, 500);
    expect(t.start).toHaveBeenCalledTimes(2);
    lift(240, 500);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('a pointercancel stops the jog where it got to, the knob back at the centre', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    move(200, 560);
    fireEvent.pointerCancel(hat(), { pointerId: 1, clientX: 200, clientY: 560 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(hat().hasAttribute('data-jogging')).toBe(false);
    expect(knob()).toEqual(['', '']);
  });

  it('another finger lifting while the jog runs is not its lift: the jog runs on until its own thumb lifts', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500, 1);
    move(240, 500, 1);
    expect(t.start).toHaveBeenCalledTimes(1);
    // a second finger pressed on the hat is not a second drive, and its moves aim nothing
    down(100, 100, 2);
    move(160, 100, 2);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(40, 0);
    fireEvent.pointerUp(hat(), { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(hat(), { pointerId: 2, clientX: 100, clientY: 100 });
    expect(t.stop).not.toHaveBeenCalled();
    expect(hat().dataset.jogging).toBe('');
    move(250, 500, 1);
    expect(t.aim).toHaveBeenLastCalledWith(50, 0);
    lift(250, 500, 1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('the jog the drag began with is the one it aims and stops, though the scene offers another meanwhile', () => {
    const t = jogOf();
    const other = jogOf();
    const { rerender } = render(<NavHat jog={t} />);
    down(200, 500);
    move(240, 500);
    rerender(<NavHat jog={other} />);
    move(250, 500);
    expect(t.aim).toHaveBeenLastCalledWith(50, 0);
    lift(250, 500);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(other.start).not.toHaveBeenCalled();
    expect(other.stop).not.toHaveBeenCalled();
    // the next press is the new one's
    down(200, 500);
    move(240, 500);
    expect(other.start).toHaveBeenCalledTimes(1);
    lift(240, 500);
  });
});

// (d) the capture lost mid-drag (the browser or a script releases it): no lift will reach the hat, so it stops there. The
// bottom-centre button had no such handler: a stolen capture left the camera moving until a blur.
describe('the hat: the capture lost mid-drag', () => {
  it('stops the drive, once, the knob back at the centre; the lift that comes later stops nothing more', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    move(240, 500);
    expect(hat().dataset.jogging).toBe('');
    fireEvent.lostPointerCapture(hat(), { pointerId: 1 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(hat().hasAttribute('data-jogging')).toBe(false);
    expect(knob()).toEqual(['', '']);
    move(260, 500);
    lift(260, 500);
    expect(t.aim).toHaveBeenCalledTimes(1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('another pointer\'s lost capture is not its own', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500, 1);
    move(240, 500, 1);
    fireEvent.lostPointerCapture(hat(), { pointerId: 2 });
    expect(t.stop).not.toHaveBeenCalled();
    lift(240, 500, 1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });
});

describe('the hat: withdrawn mid-drag (the case goes)', () => {
  it('the drive it started is stopped, once', () => {
    const t = jogOf();
    const { unmount } = render(<NavHat jog={t} />);
    down(200, 500);
    move(240, 500);
    unmount();
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('with no drive running (a press still inside the dead zone, or one the scene refused) nothing is stopped', () => {
    const t = jogOf();
    const first = render(<NavHat jog={t} />);
    down(200, 500);
    first.unmount();
    const refused = jogOf({ start: vi.fn(() => false) });
    const second = render(<NavHat jog={refused} />);
    down(200, 500);
    move(240, 500);
    second.unmount();
    expect(t.stop).not.toHaveBeenCalled();
    expect(refused.stop).not.toHaveBeenCalled();
  });
});

// NAV-2B (Ross 10-31: "more speed gradations"): a light tick (the 10 ms haptic) as the jog's speed passes each of
// jogDetents' speeds, on the way out and on the way back, once per crossing: where jogSpeed reaches the speed, never a
// threshold of the hat's own; a thumb wobbling on one ticks once.
describe('the hat\'s detents (NAV-2B)', () => {
  let ticks: number[];
  let reach = 0;
  const vibrate = vi.fn((ms: number | number[]) => (ticks.push(reach), ms === 10));
  /** The thumb `px` right of where it went down (200, 500). */
  const to = (px: number) => {
    reach = px;
    fireEvent.pointerMove(hat(), { pointerId: 1, clientX: 200 + px, clientY: 500 });
  };
  /** The first whole px out from the dead zone where the jog's speed reaches `level` (jogSpeed's, at `max`). */
  const firstAt = (level: number, max = JOG_MAX_X) => {
    let d = JOG_DEAD_PX + 1;
    while (jogSpeed(d, max) < level) d++;
    return d;
  };

  beforeEach(() => {
    ticks = [];
    vibrate.mockClear();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  });
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it('out a px at a time past full reach and back: the start\'s tick, one where jogSpeed reaches each detent, and one back past each', () => {
    render(<NavHat jog={jogOf()} />);
    down(200, 500);
    for (let px = 1; px <= JOG_FULL_PX + 6; px++) to(px);
    const out = jogDetents().map((level) => firstAt(level));
    expect(out).toEqual([45, 55, JOG_FULL_PX]);
    expect(ticks).toEqual([JOG_DEAD_PX + 1, ...out]);
    for (let px = JOG_FULL_PX + 5; px >= JOG_DEAD_PX + 1; px--) to(px);
    const back = ticks.slice(1 + out.length);
    expect(back).toHaveLength(out.length);
    // back past each, highest first, a few px inside where it ticked on the way out
    out
      .slice()
      .reverse()
      .forEach((at, i) => {
        expect(back[i], `back past the detent at ${at} px`).toBeLessThan(at);
        expect(back[i]).toBeGreaterThanOrEqual(at - 6);
      });
    expect(vibrate.mock.calls.every(([ms]) => ms === 10)).toBe(true);
    lift(209, 500);
  });

  it('a thumb wobbling 2 px either side of a detent ticks once; straight up ticks at the same distances', () => {
    render(<NavHat jog={jogOf()} />);
    down(200, 500);
    const one = firstAt(1);
    for (let px = 1; px <= one; px++) to(px);
    const after = ticks.length;
    for (let i = 0; i < 10; i++) {
      to(one - 2);
      to(one + 2);
    }
    expect(ticks).toHaveLength(after);
    lift(200 + one, 500);
    // straight up, the same distances tick
    ticks = [];
    down(200, 500);
    for (let px = 1; px <= JOG_FULL_PX; px++) fireEvent.pointerMove(hat(), { pointerId: 1, clientX: 200, clientY: 500 - (reach = px) });
    expect(ticks).toEqual([JOG_DEAD_PX + 1, ...jogDetents().map((level) => firstAt(level))]);
    lift(200, 500 - JOG_FULL_PX);
  });

  it('the jog\'s own top speed (?jogmax) sets the detents: at 1.5x the top ticks at full reach; at 1x two', () => {
    for (const max of [1.5, 1]) {
      ticks = [];
      render(<NavHat jog={jogOf({ max })} />);
      down(200, 500);
      for (let px = 1; px <= JOG_FULL_PX + 4; px++) to(px);
      const out = jogDetents(max).map((level) => firstAt(level, max));
      expect(out[out.length - 1]).toBe(JOG_FULL_PX);
      expect(ticks, `${max}x`).toEqual([JOG_DEAD_PX + 1, ...out]);
      lift(268, 500);
      cleanup();
    }
  });

  it('a jump across detents is one tick; a start already past one is the start\'s tick alone; a refused jog ticks nothing', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    down(200, 500);
    to(30);
    to(60);
    expect(ticks).toEqual([30, 60]);
    to(20);
    expect(ticks).toEqual([30, 60, 20]);
    lift(220, 500);
    // the first move lands at 60 px: the start's tick is all
    ticks = [];
    down(200, 500);
    to(60);
    expect(ticks).toEqual([60]);
    to(20);
    expect(ticks).toEqual([60, 20]);
    lift(220, 500);
    expect(t.stop).toHaveBeenCalledTimes(2);
    cleanup();
    // the scene refuses the jog (a finger on it): no tick at all, however far
    ticks = [];
    render(<NavHat jog={jogOf({ start: vi.fn(() => false) })} />);
    down(200, 500);
    for (let px = 1; px <= JOG_FULL_PX; px++) to(px);
    lift(264, 500);
    expect(ticks).toEqual([]);
  });
});
