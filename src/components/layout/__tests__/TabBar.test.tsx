import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { act, createEvent, fireEvent, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';
import { useChromeStore } from '../../../stores/chrome';
import { offerJog, useJogStore, type JogTarget } from '../../../stores/jog';
import { JOG_DEAD_PX, JOG_FULL_PX, JOG_MAX_X, jogDetents, jogSpeed } from '../../display/casePose';

beforeEach(() => useChromeStore.setState({ hidden: false }));

describe('TabBar', () => {
  it('renders the 4 tab slots and the docked Add action', () => {
    renderWithProviders(<TabBar />);
    for (const label of ['Collection', 'Search', 'Stats', 'Profile']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /add figures/i })).toBeInTheDocument();
  });

  it('navigates when a tab is pressed', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(currentPath()).toBe('/stats');
  });

  it('opens the Add sheet with the import and the barcode lookup', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    // MFC Sync has no backend (src/config/features.ts) and is off by default.
    expect(screen.queryByText(/sync from mfc/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    await user.click(screen.getByText(/look up a barcode/i));
    expect(currentPath()).toBe('/discover');
  });

  it('carries no notification badge: notifications have no backend', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('slides away when chrome is hidden', () => {
    useChromeStore.setState({ hidden: true });
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.tab-bar--hidden')).not.toBeNull();
  });
});

// NAV-JOG (Ross 10-28): where a Free camera case offers a jog, the bottom-centre button is it: press, hold and drag moves
// the camera the way the thumb goes, faster the farther (the scene's jogStep), and the lift stops it; a quick tap opens
// the menu (the Add sheet) and its close is the jog again. Nothing offered, the button is today's to the byte.
describe('TabBar: the jog (NAV-JOG)', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const offered = () => {
    const t: JogTarget = { start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() };
    act(() => {
      offerJog(t);
    });
    return t;
  };
  const jogButton = () => document.querySelector('.tab-bar__add') as HTMLElement;
  const down = (x: number, y: number, id = 1) => fireEvent.pointerDown(jogButton(), { pointerId: id, clientX: x, clientY: y, button: 0 });
  const move = (x: number, y: number, id = 1) => fireEvent.pointerMove(jogButton(), { pointerId: id, clientX: x, clientY: y });
  const lift = (x: number, y: number, id = 1) => {
    fireEvent.pointerUp(jogButton(), { pointerId: id, clientX: x, clientY: y });
    fireEvent.click(jogButton());
  };

  beforeEach(() => useJogStore.setState({ target: null }));

  it('nothing offered: the bar and its Add button are today\'s DOM, to the byte (hashed from fe967a7..4bedd00)', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(hash(container.querySelector('.tab-bar')!.outerHTML)).toBe('4e9b61312f46cbbc');
    expect(jogButton().hasAttribute('data-jog')).toBe(false);
  });

  it('offered: the button is the jog, named for both; withdrawn, it is the Add button again', () => {
    const { container } = renderWithProviders(<TabBar />);
    const before = container.querySelector('.tab-bar')!.outerHTML;
    let withdraw = () => {};
    act(() => {
      withdraw = offerJog({ start: () => true, aim: () => {}, stop: () => {} });
    });
    expect(jogButton().dataset.jog).toBe('');
    expect(jogButton().classList.contains('tab-bar__add--jog')).toBe(true);
    expect(screen.getByRole('button', { name: /move the camera/i })).toBe(jogButton());
    expect(screen.getByRole('button', { name: /add figures/i })).toBe(jogButton());
    expect(jogButton().querySelector('.tab-bar__jog-knob')).not.toBeNull();
    act(() => withdraw());
    expect(container.querySelector('.tab-bar')!.outerHTML).toBe(before);
  });

  it('press, hold and drag: the jog starts once past 8 px, aims at the thumb\'s offset each move, stops on the lift; no menu', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(204, 497);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.aim).not.toHaveBeenCalled();
    move(230, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(30, 0);
    expect(jogButton().dataset.jogging).toBe('');
    move(200, 440);
    expect(t.aim).toHaveBeenLastCalledWith(0, -60);
    expect(t.start).toHaveBeenCalledTimes(1);
    // the knob shows where the thumb holds it, never past the button's reach
    expect((jogButton().querySelector('.tab-bar__jog-knob') as HTMLElement).style.transform).toBe('translate(0px, -16px)');
    lift(200, 440);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    expect((jogButton().querySelector('.tab-bar__jog-knob') as HTMLElement).style.transform).toBe('');
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
    // another finger's moves and lifts are not the jog's
    down(200, 500, 1);
    move(260, 500, 2);
    fireEvent.pointerUp(jogButton(), { pointerId: 2, clientX: 260, clientY: 500 });
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(200, 500, 1);
  });

  it('a quick tap opens the menu (the Add sheet); a tap that wobbles inside 8 px is still a tap', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(203, 504);
    lift(203, 504);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
  });

  it('a drag the scene refuses (a finger already on it) neither aims nor opens the menu', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    (t.start as ReturnType<typeof vi.fn>).mockReturnValue(false);
    down(200, 500);
    move(240, 500);
    move(260, 500);
    lift(260, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
  });

  it('a pointercancel stops the jog where it got to; the next tap is a tap again', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(200, 560);
    fireEvent.pointerCancel(jogButton(), { pointerId: 1, clientX: 200, clientY: 560 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    down(200, 500);
    lift(200, 500);
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
  });

  it('a drag of exactly 8 px is still a tap (the menu); a hair past it is the jog', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(208, 500);
    lift(208, 500);
    expect(t.start).not.toHaveBeenCalled();
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
    down(200, 500);
    move(208.5, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(208.5, 500);
  });

  it('another finger lifting while the jog runs is not its lift: the jog runs on until its own thumb lifts', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500, 1);
    move(240, 500, 1);
    expect(t.start).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(jogButton(), { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(jogButton(), { pointerId: 2, clientX: 100, clientY: 100 });
    expect(t.stop).not.toHaveBeenCalled();
    expect(jogButton().dataset.jogging).toBe('');
    move(250, 500, 1);
    expect(t.aim).toHaveBeenLastCalledWith(50, 0);
    lift(250, 500, 1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('a touch jog raises no click of its own: a click that comes later (Enter, a switch) is the menu, not swallowed', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(260, 500);
    const up = createEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 260, clientY: 500 });
    fireEvent(jogButton(), up);
    expect(t.stop).toHaveBeenCalledTimes(1);
    // no click with the lift (a touch drag raises none); a keyboard's click a second on
    const later = createEvent.click(jogButton());
    Object.defineProperty(later, 'timeStamp', { value: up.timeStamp + 1000 });
    fireEvent(jogButton(), later);
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
  });

  it('the jog the drag began with is the one it stops, though the scene withdrew it meanwhile', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(240, 500);
    act(() => useJogStore.setState({ target: null }));
    move(250, 500);
    expect(t.aim).toHaveBeenLastCalledWith(50, 0);
    expect(jogButton().hasAttribute('data-jog')).toBe(false);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 250, clientY: 500 });
    expect(t.stop).toHaveBeenCalledTimes(1);
  });
});

// NAV-2B (Ross 10-31: "more speed gradations"): a light tick (the 10 ms haptic) as the jog's speed passes each of
// jogDetents' speeds, on the way out and on the way back, once per crossing: where jogSpeed reaches the speed, never a
// threshold of the bar's own; a thumb wobbling on one ticks once.
describe('TabBar: the jog\'s detents (NAV-2B)', () => {
  let ticks: number[];
  let reach = 0;
  const vibrate = vi.fn((ms: number | number[]) => (ticks.push(reach), ms === 10));
  const jogButton = () => document.querySelector('.tab-bar__add') as HTMLElement;
  const offered = (patch: Partial<JogTarget> = {}) => {
    const t: JogTarget = { start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn(), ...patch };
    act(() => {
      offerJog(t);
    });
    return t;
  };
  /** The thumb `px` right of where it went down (200, 500). */
  const to = (px: number) => {
    reach = px;
    fireEvent.pointerMove(jogButton(), { pointerId: 1, clientX: 200 + px, clientY: 500 });
  };
  /** The first whole px out from the dead zone where the jog's speed reaches `level` (jogSpeed's, at `max`). */
  const firstAt = (level: number, max = JOG_MAX_X) => {
    let d = JOG_DEAD_PX + 1;
    while (jogSpeed(d, max) < level) d++;
    return d;
  };

  beforeEach(() => {
    useJogStore.setState({ target: null });
    ticks = [];
    vibrate.mockClear();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  });
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
  });

  it('out a px at a time past full reach and back: the start\'s tick, one where jogSpeed reaches each detent, and one back past each', () => {
    renderWithProviders(<TabBar />);
    offered();
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
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
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 209, clientY: 500 });
  });

  it('a thumb wobbling 2 px either side of a detent ticks once; straight up ticks at the same distances', () => {
    renderWithProviders(<TabBar />);
    offered();
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
    const one = firstAt(1);
    for (let px = 1; px <= one; px++) to(px);
    const after = ticks.length;
    for (let i = 0; i < 10; i++) {
      to(one - 2);
      to(one + 2);
    }
    expect(ticks).toHaveLength(after);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 200 + one, clientY: 500 });
    // straight up, the same distances tick
    ticks = [];
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
    for (let px = 1; px <= JOG_FULL_PX; px++) fireEvent.pointerMove(jogButton(), { pointerId: 1, clientX: 200, clientY: 500 - (reach = px) });
    expect(ticks).toEqual([JOG_DEAD_PX + 1, ...jogDetents().map((level) => firstAt(level))]);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 200, clientY: 500 - JOG_FULL_PX });
  });

  it('the jog\'s own top speed (?jogmax) sets the detents: at 1.5x the top ticks at full reach; at 1x two', () => {
    renderWithProviders(<TabBar />);
    for (const max of [1.5, 1]) {
      ticks = [];
      offered({ max });
      fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
      for (let px = 1; px <= JOG_FULL_PX + 4; px++) to(px);
      const out = jogDetents(max).map((level) => firstAt(level, max));
      expect(out[out.length - 1]).toBe(JOG_FULL_PX);
      expect(ticks, `${max}x`).toEqual([JOG_DEAD_PX + 1, ...out]);
      fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 268, clientY: 500 });
    }
  });

  it('a jump across detents is one tick; a start already past one is the start\'s tick alone; a refused jog ticks nothing', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
    to(30);
    to(60);
    expect(ticks).toEqual([30, 60]);
    to(20);
    expect(ticks).toEqual([30, 60, 20]);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 220, clientY: 500 });
    // the first move lands at 60 px: the start's tick is all
    ticks = [];
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
    to(60);
    expect(ticks).toEqual([60]);
    to(20);
    expect(ticks).toEqual([60, 20]);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 220, clientY: 500 });
    expect(t.stop).toHaveBeenCalledTimes(2);
    // the scene refuses the jog (a finger on it): no tick at all, however far
    ticks = [];
    offered({ start: vi.fn(() => false) });
    fireEvent.pointerDown(jogButton(), { pointerId: 1, clientX: 200, clientY: 500, button: 0 });
    for (let px = 1; px <= JOG_FULL_PX; px++) to(px);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 264, clientY: 500 });
    expect(ticks).toEqual([]);
  });
});
