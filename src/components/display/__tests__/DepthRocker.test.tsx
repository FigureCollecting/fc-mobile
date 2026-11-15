import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { CaseTabs } from '../CaseTabs';
import { CASE_TABS, type CaseTab } from '../casePrefs';
import { DEPTH_DEAD, DEPTH_FULL_PX } from '../caseDepth';
import { offerJog, useJogStore, type DepthDrive, type JogTarget } from '../../../stores/jog';
import { TabBar } from '../../layout/TabBar';
import { renderWithProviders } from '../../../test/testUtils';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-DEPTH-3 (Ross 11-13, NAV-ROCKER 11-14): the depth rocker in the empty slot left of the hat. Spring-centred: the
// reach of the finger from where it went down, over DEPTH_FULL_PX, is the drive's r in [-1, 1] (the scene's
// depthStart / depthRate / depthStop); the lift springs it back to the centre and stops the drive. By default a vertical
// rocker rising above the slot (up = closer); the View card's setting makes it a horizontal slider in the slot (toward
// the hat = closer). It drives with the hat at once: each holds its own finger.

type Drive = { [K in keyof DepthDrive]: ReturnType<typeof vi.fn> } & DepthDrive;
const drive = (): Drive => ({ start: vi.fn(() => true), rate: vi.fn(), stop: vi.fn() }) as Drive;
const jogOf = (depth?: DepthDrive): JogTarget => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn(), depth });
const offer = (target: JogTarget) => {
  let withdraw = () => {};
  act(() => {
    withdraw = offerJog(target);
  });
  return () => act(() => withdraw());
};

const tabs = (props: { order?: readonly CaseTab[]; rocker?: 'vertical' | 'horizontal' } = {}) =>
  render(<CaseTabs order={props.order ?? CASE_TABS} rocker={props.rocker} infoEnabled onTab={() => {}} open={null} />);
const rocker = () => document.querySelector('.depth-rocker') as HTMLElement | null;
const reserved = () => document.querySelector('[data-tab="reserved"]') as HTMLElement;
const down = (x: number, y: number, id = 1) => fireEvent.pointerDown(rocker()!, { pointerId: id, clientX: x, clientY: y, button: 0 });
const move = (x: number, y: number, id = 1) => fireEvent.pointerMove(rocker()!, { pointerId: id, clientX: x, clientY: y });
const up = (x: number, y: number, id = 1) => fireEvent.pointerUp(rocker()!, { pointerId: id, clientX: x, clientY: y });
/** The knob's shown reach (--depth-k: -1 top or left, +1 bottom or right); '' at rest. */
const knob = () => rocker()!.style.getPropertyValue('--depth-k');

beforeEach(() => useJogStore.setState({ target: null }));
afterEach(() => cleanup());

describe('the depth rocker: where it shows', () => {
  it('nothing offered, or a jog with no depth: the Reserved slot stays empty, with nothing to press or read', () => {
    tabs();
    expect(rocker()).toBeNull();
    offer(jogOf());
    expect(rocker()).toBeNull();
    expect(reserved().textContent).toBe('');
    expect(reserved().getAttribute('aria-hidden')).toBe('true');
  });

  it('a jog with a depth: the Reserved slot holds the rocker, vertical by default; withdrawn, the slot is empty again', () => {
    tabs();
    const withdraw = offer(jogOf(drive()));
    const r = screen.getByRole('slider', { name: /closer/i });
    expect(r).toBe(rocker());
    expect(reserved().contains(r)).toBe(true);
    expect(reserved().hasAttribute('aria-hidden')).toBe(false);
    expect(r.dataset.shape).toBe('vertical');
    expect(r.getAttribute('aria-orientation')).toBe('vertical');
    expect([r.getAttribute('aria-valuemin'), r.getAttribute('aria-valuemax'), r.getAttribute('aria-valuenow')]).toEqual(['-1', '1', '0']);
    withdraw();
    expect(rocker()).toBeNull();
    expect(reserved().getAttribute('aria-hidden')).toBe('true');
  });

  it('the setting\'s horizontal: a slider in the slot', () => {
    tabs({ rocker: 'horizontal' });
    offer(jogOf(drive()));
    expect(rocker()!.dataset.shape).toBe('horizontal');
    expect(rocker()!.getAttribute('aria-orientation')).toBe('horizontal');
  });
});

describe('the vertical rocker (NAV-ROCKER a): push up = closer, down = back away', () => {
  it('starts once past the dead zone at r = reach / DEPTH_FULL_PX, its rate each move after, to +-1 at most; the lift stops it at the centre', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    // (from y 0: the dead zone's edge, DEPTH_DEAD * DEPTH_FULL_PX, is that exact travel)
    down(100, 0);
    // at the dead zone's edge: nothing starts
    move(100, -DEPTH_DEAD * DEPTH_FULL_PX);
    expect(d.start).not.toHaveBeenCalled();
    expect(rocker()!.hasAttribute('data-rocking')).toBe(false);
    move(100, -DEPTH_FULL_PX / 4);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.start).toHaveBeenCalledWith(0.25);
    expect(d.rate).not.toHaveBeenCalled();
    expect(rocker()!.dataset.rocking).toBe('');
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
    expect(rocker()!.hasAttribute('data-rocking')).toBe(false);
  });

  it('back inside the dead zone it is not let go: the rate goes on (the drive moves nothing there: DEPTH_DEAD)', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(100, 400 - DEPTH_FULL_PX / 2);
    move(100, 400 - 1);
    expect(d.rate).toHaveBeenLastCalledWith(1 / DEPTH_FULL_PX);
    expect(d.stop).not.toHaveBeenCalled();
    up(100, 399);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('a press that never leaves the dead zone starts and stops nothing', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(102, 402);
    up(102, 402);
    expect(d.start).not.toHaveBeenCalled();
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('a start the scene refuses (a finger on it already): no rate, no stop, no knob, until the next press', () => {
    tabs();
    const d = drive();
    d.start.mockReturnValue(false);
    offer(jogOf(d));
    down(100, 400);
    move(100, 380);
    move(100, 370);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.rate).not.toHaveBeenCalled();
    expect(knob()).toBe('');
    expect(rocker()!.hasAttribute('data-rocking')).toBe(false);
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
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(100, 380);
    fireEvent.pointerCancel(rocker()!, { pointerId: 1, clientX: 100, clientY: 380 });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(knob()).toBe('');
  });

  it('another finger\'s press, moves and lifts are not its own', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400, 1);
    move(100, 380, 1);
    down(100, 300, 2);
    move(100, 200, 2);
    expect(d.rate).not.toHaveBeenCalled();
    up(100, 200, 2);
    fireEvent.pointerCancel(rocker()!, { pointerId: 2, clientX: 100, clientY: 200 });
    expect(d.stop).not.toHaveBeenCalled();
    move(100, 400 - DEPTH_FULL_PX, 1);
    expect(d.rate).toHaveBeenLastCalledWith(1);
    up(100, 364, 1);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('withdrawn mid-push (the case goes, Free camera turned off): the drive it started is stopped, once', () => {
    tabs();
    const d = drive();
    const withdraw = offer(jogOf(d));
    down(100, 400);
    move(100, 380);
    withdraw();
    expect(rocker()).toBeNull();
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('withdrawn with no drive running stops nothing', () => {
    tabs();
    const d = drive();
    const withdraw = offer(jogOf(d));
    down(100, 400);
    withdraw();
    expect(d.stop).not.toHaveBeenCalled();
  });
});

describe('the horizontal slider (NAV-ROCKER b): toward the hat = closer', () => {
  it('left of the hat (the default order): right is closer, left is back', () => {
    tabs({ rocker: 'horizontal' });
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(100 + DEPTH_FULL_PX / 2, 400);
    expect(d.start).toHaveBeenCalledWith(0.5);
    expect(Number(knob())).toBe(0.5);
    move(100 - DEPTH_FULL_PX, 400);
    expect(d.rate).toHaveBeenLastCalledWith(-1);
    expect(Number(knob())).toBe(-1);
    // up and down are no reach
    move(100 - DEPTH_FULL_PX, 300);
    expect(d.rate).toHaveBeenLastCalledWith(-1);
    up(100 - DEPTH_FULL_PX, 300);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('the tab sides swapped (the slot right of the hat): left is closer', () => {
    tabs({ rocker: 'horizontal', order: [...CASE_TABS].reverse() });
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(100 - DEPTH_FULL_PX / 2, 400);
    expect(d.start).toHaveBeenCalledWith(0.5);
    // the knob goes where the finger goes: left
    expect(Number(knob())).toBe(-0.5);
    move(100 + DEPTH_FULL_PX, 400);
    expect(d.rate).toHaveBeenLastCalledWith(-1);
    up(100 + DEPTH_FULL_PX, 400);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });
});

describe('the rocker and the hat held together (NAV-DEPTH-2: two fingers, two drives)', () => {
  it('each keeps its own finger: the hat\'s lift stops the hat alone; the rocker\'s lift stops the depth', () => {
    renderWithProviders(<TabBar />);
    tabs();
    const d = drive();
    const t = jogOf(d);
    offer(t);
    const hat = document.querySelector('.tab-bar__add') as HTMLElement;
    fireEvent.pointerDown(hat, { pointerId: 1, clientX: 400, clientY: 500, button: 0 });
    fireEvent.pointerMove(hat, { pointerId: 1, clientX: 440, clientY: 500 });
    down(300, 480, 2);
    move(300, 480 - DEPTH_FULL_PX, 2);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(40, 0);
    expect(d.start).toHaveBeenCalledWith(1);
    // the hat moves on while the rocker is held
    fireEvent.pointerMove(hat, { pointerId: 1, clientX: 400, clientY: 460 });
    expect(t.aim).toHaveBeenLastCalledWith(0, -40);
    fireEvent.pointerUp(hat, { pointerId: 1, clientX: 400, clientY: 460 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(d.stop).not.toHaveBeenCalled();
    move(300, 480 - DEPTH_FULL_PX / 2, 2);
    expect(d.rate).toHaveBeenLastCalledWith(0.5);
    up(300, 480 - DEPTH_FULL_PX / 2, 2);
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });
});

// chal1 S1/S2: the drive starts from rest either way, with the reach the finger has: a first push back is back, in both
// shapes and with the sides swapped; the dead zone is 3.6 px (DEPTH_DEAD of 36) wide and full reach is 36 px, in figures.
describe('the start from rest: either way, just past the dead zone', () => {
  // (from 0, 0: the travel is the exact figure, with no rounding from a subtraction)
  type Case = { shape: 'vertical' | 'horizontal'; order: readonly CaseTab[]; way: string; at: (px: number) => [number, number] };
  const swapped = [...CASE_TABS].reverse();
  const cases: Case[] = [
    { shape: 'vertical', order: CASE_TABS, way: 'up (closer)', at: (px) => [0, -px] },
    { shape: 'vertical', order: CASE_TABS, way: 'down (back)', at: (px) => [0, px] },
    { shape: 'horizontal', order: CASE_TABS, way: 'right, toward the hat (closer)', at: (px) => [px, 0] },
    { shape: 'horizontal', order: CASE_TABS, way: 'left, away from the hat (back)', at: (px) => [-px, 0] },
    { shape: 'horizontal', order: swapped, way: 'sides swapped: left, toward the hat (closer)', at: (px) => [-px, 0] },
    { shape: 'horizontal', order: swapped, way: 'sides swapped: right, away from the hat (back)', at: (px) => [px, 0] },
  ];
  for (const c of cases) {
    const sign = c.way.includes('closer') ? 1 : -1;
    it(`${c.shape}, ${c.way}: 3.6 px starts nothing, 4 px starts at r = ${sign > 0 ? '+' : '-'}4 / 36; 18 px is half reach, 36 px full`, () => {
      tabs({ rocker: c.shape, order: c.order });
      const d = drive();
      offer(jogOf(d));
      fireEvent.pointerDown(rocker()!, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      move(...c.at(3.6));
      expect(d.start).not.toHaveBeenCalled();
      move(...c.at(4));
      expect(d.start).toHaveBeenCalledTimes(1);
      expect(d.start.mock.calls[0][0]).toBeCloseTo((sign * 4) / 36, 9);
      move(...c.at(18));
      expect(d.rate.mock.calls.at(-1)![0]).toBeCloseTo(sign * 0.5, 9);
      move(...c.at(36));
      expect(d.rate).toHaveBeenLastCalledWith(sign);
      up(...c.at(36));
      expect(d.stop).toHaveBeenCalledTimes(1);
    });
  }
});

// chal1 NOTE-1 (ruled a fix for the rocker): the capture lost mid-push (the browser or a script releases it), no lift
// will reach the rocker: it springs back and the drive stops there.
describe('the capture lost mid-push', () => {
  it('springs back and stops the drive, once; the lift that comes later stops nothing more', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400);
    move(100, 380);
    expect(rocker()!.dataset.rocking).toBe('');
    fireEvent.lostPointerCapture(rocker()!, { pointerId: 1 });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(knob()).toBe('');
    expect(rocker()!.hasAttribute('data-rocking')).toBe(false);
    move(100, 360);
    up(100, 360);
    expect(d.rate).not.toHaveBeenCalled();
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it('another pointer\'s lost capture is not its own', () => {
    tabs();
    const d = drive();
    offer(jogOf(d));
    down(100, 400, 1);
    move(100, 380, 1);
    fireEvent.lostPointerCapture(rocker()!, { pointerId: 2 });
    expect(d.stop).not.toHaveBeenCalled();
    up(100, 380, 1);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });
});
