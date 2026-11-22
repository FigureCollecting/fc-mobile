import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { NavHat } from '../NavHat';
import { EYE_HIT_PX, EYE_SLOT_DEG, EYE_TAP, HAT_DOUBLE_TAP } from '../navTuning';
import { EYE as SHAPE } from '../navEyeShape';
import { JOG_DEAD_PX } from '../casePose';
import { useNavMode } from '../../../stores/navMode';
import type { JogTarget, LookDrive } from '../../../stores/jog';
import { hapticLight } from '../../../utils/haptics';

vi.mock('../../../utils/haptics', () => ({ hapticLight: vi.fn() }));

// NAV-EYE (handoff FINAL 11-17 B; Ross NAVLOOK 1a 2a 3b): the eye fused to the hat's upper-left shoulder. One tap
// latches the hat Move <-> Look (the hat then drives the Look drive, by rate); the mode is read when the hat is pressed,
// so a toggle while a thumb holds it waits for the next press. 2a: the eye pressed and slid onto the hat is a Look for
// as long as that finger stays down; the lift goes back to the latched mode. 3b: two short, still taps on the hat
// toggle it too. A stationary hold on the hat never does.

type Fn = ReturnType<typeof vi.fn>;
type Look = { [K in 'start' | 'aim' | 'stop']: Fn } & LookDrive;
type Jog = { [K in 'start' | 'aim' | 'stop']: Fn } & JogTarget & { look: Look };
const lookOf = (): Look => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() }) as Look;
const jogOf = (patch: Partial<JogTarget> = {}): Jog => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn(), look: lookOf(), ...patch }) as Jog;

const hat = () => document.querySelector('[data-nav="hat"]') as HTMLElement;
const eye = () => document.querySelector('[data-nav="eye"]') as HTMLButtonElement;
type P = { x: number; y: number };
const ev = (p: P, id: number) => ({ pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const hatDown = (p: P, id = 1) => fireEvent.pointerDown(hat(), ev(p, id));
const hatMove = (p: P, id = 1) => fireEvent.pointerMove(hat(), ev(p, id));
const hatUp = (p: P, id = 1) => fireEvent.pointerUp(hat(), ev(p, id));
const eyeDown = (p: P, id = 2) => fireEvent.pointerDown(eye(), ev(p, id));
const eyeMove = (p: P, id = 2) => fireEvent.pointerMove(eye(), ev(p, id));
const eyeUp = (p: P, id = 2) => fireEvent.pointerUp(eye(), ev(p, id));
const wait = (ms: number) => vi.advanceTimersByTime(ms);
const latched = () => useNavMode.getState().latched;

// jsdom lays nothing out: the hat's box is placed here as the page would place it (a 104 px ring, its centre at
// (152, 452)), and the eye's hit circle (its bubble, at least EYE_HIT_PX across) outside the ring at 135 degrees
const HAT = { x: 152, y: 452, r: 52 };
/** The hat's box is 100 units across (navEyeShape): px per unit here. */
const UNIT = (HAT.r * 2) / 100;
const EYE_AT = Math.hypot(SHAPE.x - 50, SHAPE.y - 50) * UNIT;
const EYE = { x: HAT.x + EYE_AT * Math.cos((EYE_SLOT_DEG * Math.PI) / 180), y: HAT.y - EYE_AT * Math.sin((EYE_SLOT_DEG * Math.PI) / 180) };
const EYE_PX = 2 * SHAPE.r * UNIT;
const rect = (cx: number, cy: number, size: number) => ({ left: cx - size / 2, top: cy - size / 2, right: cx + size / 2, bottom: cy + size / 2, width: size, height: size, x: cx - size / 2, y: cy - size / 2, toJSON: () => ({}) }) as DOMRect;
function place() {
  expect(EYE_PX).toBeGreaterThanOrEqual(EYE_HIT_PX);
  hat().getBoundingClientRect = () => rect(HAT.x, HAT.y, HAT.r * 2);
  eye().getBoundingClientRect = () => rect(EYE.x, EYE.y, EYE_PX);
}
const C = { x: HAT.x, y: HAT.y };

beforeEach(() => {
  vi.useFakeTimers();
  useNavMode.setState({ latched: 'move', temp: false });
  vi.mocked(hapticLight).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the eye: what it is', () => {
  it('a button named "Look mode" on the hat, pressed while Look is latched; the hat says which it drives', () => {
    render(<NavHat jog={jogOf()} />);
    const b = screen.getByRole('button', { name: 'Look mode' });
    expect(b).toBe(eye());
    expect(hat().contains(b)).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(hat().dataset.mode).toBe('move');
    expect(hat().getAttribute('aria-label')).toMatch(/move the camera/i);
    expect(hat().querySelector('[data-glyph="move"]')).not.toBeNull();
    expect(hat().querySelector('[data-glyph="look"]')).toBeNull();
  });

  it('no Look offered: no eye, and the hat drives the jog whatever was latched', () => {
    useNavMode.setState({ latched: 'look' });
    const t = jogOf({ look: undefined });
    render(<NavHat jog={t} />);
    expect(eye()).toBeNull();
    hatDown(C);
    hatMove({ x: C.x + 30, y: C.y });
    expect(t.start).toHaveBeenCalledTimes(1);
    hatUp({ x: C.x + 30, y: C.y });
    expect(t.stop).toHaveBeenCalledTimes(1);
  });
});

describe('NAV-EYE (a): one tap on the eye latches Look', () => {
  it('a tap sets aria-pressed, the teal cue, the rotate glyph, the Look label and a light haptic; the next hat drag turns (the Look drive), not moves', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    eyeDown(EYE);
    wait(120);
    eyeUp({ x: EYE.x + 3, y: EYE.y - 2 });
    expect(eye().getAttribute('aria-pressed')).toBe('true');
    expect(latched()).toBe('look');
    expect(hat().dataset.mode).toBe('look');
    expect(hat().getAttribute('aria-label')).toMatch(/look around/i);
    expect(hat().querySelector('[data-glyph="look"]')).not.toBeNull();
    expect(hapticLight).toHaveBeenCalledTimes(1);
    hatDown(C);
    hatMove({ x: C.x + 30, y: C.y });
    hatMove({ x: C.x + 30, y: C.y - 20 });
    expect(t.look.start).toHaveBeenCalledTimes(1);
    expect(t.look.aim).toHaveBeenLastCalledWith(30, -20);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.aim).not.toHaveBeenCalled();
    hatUp({ x: C.x + 30, y: C.y - 20 });
    expect(t.look.stop).toHaveBeenCalledTimes(1);
    expect(t.stop).not.toHaveBeenCalled();
    // a second tap: Move again
    eyeDown(EYE);
    eyeUp(EYE);
    expect(eye().getAttribute('aria-pressed')).toBe('false');
    hatDown(C);
    hatMove({ x: C.x + 30, y: C.y });
    expect(t.start).toHaveBeenCalledTimes(1);
    hatUp({ x: C.x + 30, y: C.y });
  });

  it(`a press that travels more than ${EYE_TAP.slopPx} px or lasts more than ${EYE_TAP.ms} ms is no tap`, () => {
    render(<NavHat jog={jogOf()} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x - EYE_TAP.slopPx - 1, y: EYE.y });
    eyeUp(EYE);
    expect(latched()).toBe('move');
    eyeDown(EYE);
    wait(EYE_TAP.ms + 1);
    eyeUp(EYE);
    expect(latched()).toBe('move');
    expect(hapticLight).not.toHaveBeenCalled();
    // and exactly at the bounds it is one
    eyeDown(EYE);
    eyeMove({ x: EYE.x - EYE_TAP.slopPx, y: EYE.y });
    wait(EYE_TAP.ms);
    eyeUp({ x: EYE.x - EYE_TAP.slopPx, y: EYE.y });
    expect(latched()).toBe('look');
  });

  it('a pointercancel or a lost capture is no tap; another finger\'s lift is not this press\'s', () => {
    render(<NavHat jog={jogOf()} />);
    eyeDown(EYE);
    fireEvent.pointerCancel(eye(), ev(EYE, 2));
    expect(latched()).toBe('move');
    eyeDown(EYE);
    fireEvent.lostPointerCapture(eye(), ev(EYE, 2));
    eyeUp(EYE);
    expect(latched()).toBe('move');
    eyeDown(EYE, 2);
    eyeUp(EYE, 3);
    expect(latched()).toBe('move');
    eyeUp(EYE, 2);
    expect(latched()).toBe('look');
  });

  it('a second finger on the eye while one presses it is not a press of its own; another finger\'s moves are not this press\'s travel', () => {
    render(<NavHat jog={jogOf()} />);
    place();
    eyeDown(EYE, 2);
    eyeDown({ x: EYE.x + 4, y: EYE.y }, 3);
    eyeMove({ x: EYE.x - 40, y: EYE.y }, 3);
    eyeUp({ x: EYE.x - 40, y: EYE.y }, 3);
    expect(latched()).toBe('move');
    eyeUp(EYE, 2);
    expect(latched(), 'the first finger\'s tap').toBe('look');
  });

  it('a keyboard\'s click (Enter, Space: detail 0) toggles; a pointer\'s click after its tap does not toggle twice', () => {
    render(<NavHat jog={jogOf()} />);
    fireEvent.click(eye(), { detail: 0 });
    expect(latched()).toBe('look');
    eyeDown(EYE);
    eyeUp(EYE);
    fireEvent.click(eye(), { detail: 1 });
    expect(latched()).toBe('move');
  });

  it('the eye\'s press is its own: the hat under it starts nothing', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x + 5, y: EYE.y });
    eyeUp({ x: EYE.x + 5, y: EYE.y });
    expect(t.start).not.toHaveBeenCalled();
    expect(t.look.start).not.toHaveBeenCalled();
  });
});

describe('NAV-EYE (b): no stationary-hold trigger on the hat', () => {
  it('a 600 ms still press on the hat centre toggles nothing and starts nothing', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    hatDown(C);
    wait(600);
    hatMove({ x: C.x + 2, y: C.y + 1 });
    hatUp({ x: C.x + 2, y: C.y + 1 });
    expect(latched()).toBe('move');
    expect(t.start).not.toHaveBeenCalled();
    expect(t.look.start).not.toHaveBeenCalled();
    expect(hapticLight).not.toHaveBeenCalled();
  });
});

describe('NAV-EYE (d): the mode is read at the press', () => {
  it('an eye tap while a thumb holds the hat leaves the running drive as it is; the next press drives the other', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    hatDown(C, 1);
    hatMove({ x: C.x + 30, y: C.y }, 1);
    expect(t.start).toHaveBeenCalledTimes(1);
    eyeDown(EYE, 2);
    eyeUp(EYE, 2);
    expect(latched()).toBe('look');
    // the drive held is still the jog, and the hat still shows Move until it lets go
    hatMove({ x: C.x + 40, y: C.y }, 1);
    expect(t.aim).toHaveBeenLastCalledWith(40, 0);
    expect(t.look.start).not.toHaveBeenCalled();
    expect(t.look.aim).not.toHaveBeenCalled();
    hatUp({ x: C.x + 40, y: C.y }, 1);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.look.stop).not.toHaveBeenCalled();
    hatDown(C, 3);
    hatMove({ x: C.x, y: C.y + 30 }, 3);
    expect(t.look.start).toHaveBeenCalledTimes(1);
    expect(t.look.aim).toHaveBeenLastCalledWith(0, 30);
    hatUp({ x: C.x, y: C.y + 30 }, 3);
    expect(t.look.stop).toHaveBeenCalledTimes(1);
  });
});

describe('NAVLOOK 2a: the eye pressed and slid onto the hat is a Look while held', () => {
  it('off the eye onto the hat: the hat takes the finger, anchored where it came on; it Looks; the lift goes back to Move', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    place();
    eyeDown(EYE);
    // still inside the eye's hit circle: nothing yet
    eyeMove({ x: EYE.x + 10, y: EYE.y + 10 });
    expect(hat().dataset.mode).toBe('move');
    // onto the hat, clear of the eye: the temporary Look begins, anchored here
    const on = { x: EYE.x + 30, y: EYE.y + 30 };
    eyeMove(on);
    expect(hat().dataset.mode).toBe('look');
    expect(useNavMode.getState().temp).toBe(true);
    expect(eye().getAttribute('aria-pressed'), 'the latched mode is still Move').toBe('false');
    expect(t.look.start).not.toHaveBeenCalled();
    // the hat now has the finger (its capture): its moves drive the Look from the anchor
    hatMove({ x: on.x + 4, y: on.y }, 2);
    expect(t.look.start).not.toHaveBeenCalled();
    hatMove({ x: on.x + 30, y: on.y - 10 }, 2);
    expect(t.look.start).toHaveBeenCalledTimes(1);
    expect(t.look.aim).toHaveBeenLastCalledWith(30, -10);
    expect(t.start).not.toHaveBeenCalled();
    // the eye's lost capture (the hat took it) ends nothing, nor does one that bubbles up from any other part of the hat
    fireEvent.lostPointerCapture(eye(), ev(on, 2));
    fireEvent.lostPointerCapture(hat().querySelector('.nav-hat__knob')!, ev(on, 2));
    hatMove({ x: on.x + 36, y: on.y - 10 }, 2);
    expect(t.look.aim).toHaveBeenLastCalledWith(36, -10);
    expect(t.look.stop).not.toHaveBeenCalled();
    hatUp({ x: on.x + 36, y: on.y - 10 }, 2);
    expect(t.look.stop).toHaveBeenCalledTimes(1);
    expect(hat().dataset.mode).toBe('move');
    expect(useNavMode.getState().temp).toBe(false);
    expect(latched()).toBe('move');
    // the next plain press is a Move
    hatDown(C);
    hatMove({ x: C.x + 30, y: C.y });
    expect(t.start).toHaveBeenCalledTimes(1);
    hatUp({ x: C.x + 30, y: C.y });
  });

  it('a pointercancel on the hat ends the temporary Look too; with Look latched the slide Looks and the lift keeps Look', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x + 30, y: EYE.y + 30 });
    hatMove({ x: EYE.x + 60, y: EYE.y + 30 }, 2);
    fireEvent.pointerCancel(hat(), ev({ x: EYE.x + 60, y: EYE.y + 30 }, 2));
    expect(t.look.stop).toHaveBeenCalledTimes(1);
    expect(useNavMode.getState().temp).toBe(false);
    useNavMode.setState({ latched: 'look' });
    eyeDown(EYE);
    eyeMove({ x: EYE.x + 30, y: EYE.y + 30 });
    hatUp({ x: EYE.x + 30, y: EYE.y + 30 }, 2);
    expect(latched()).toBe('look');
    expect(hat().dataset.mode).toBe('look');
  });

  it('slid away from the hat, or released on the eye after a slide, it is nothing: no Look, no toggle', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x - 40, y: EYE.y - 40 });
    eyeMove({ x: EYE.x - 80, y: EYE.y });
    eyeUp({ x: EYE.x - 80, y: EYE.y });
    expect(latched()).toBe('move');
    expect(useNavMode.getState().temp).toBe(false);
    expect(t.look.start).not.toHaveBeenCalled();
    eyeDown(EYE);
    eyeMove({ x: EYE.x - 20, y: EYE.y });
    eyeUp(EYE);
    expect(latched()).toBe('move');
  });

  it('a hat already held by another thumb does not take the slide', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    place();
    hatDown(C, 1);
    hatMove({ x: C.x + 30, y: C.y }, 1);
    eyeDown(EYE, 2);
    eyeMove({ x: EYE.x + 30, y: EYE.y + 30 }, 2);
    expect(useNavMode.getState().temp).toBe(false);
    expect(hat().dataset.mode).toBe('move');
    eyeUp({ x: EYE.x + 30, y: EYE.y + 30 }, 2);
    hatUp({ x: C.x + 30, y: C.y }, 1);
    expect(t.look.start).not.toHaveBeenCalled();
  });

  it('withdrawn mid-slide (the case gone): the Look it began stops and the mode goes back', () => {
    const t = jogOf();
    const { unmount } = render(<NavHat jog={t} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x + 30, y: EYE.y + 30 });
    hatMove({ x: EYE.x + 60, y: EYE.y + 30 }, 2);
    expect(t.look.start).toHaveBeenCalledTimes(1);
    unmount();
    expect(t.look.stop).toHaveBeenCalledTimes(1);
    expect(useNavMode.getState().temp).toBe(false);
  });
});

describe('NAVLOOK 3b: a double tap on the hat toggles Move <-> Look', () => {
  const tap = (p: P = C, ms = 60, id = 1) => {
    hatDown(p, id);
    wait(ms);
    hatUp(p, id);
  };

  it('two short, still taps toggle, with the haptic; two more toggle back', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    tap();
    expect(latched()).toBe('move');
    wait(120);
    tap({ x: C.x + 3, y: C.y + 2 });
    expect(latched()).toBe('look');
    expect(eye().getAttribute('aria-pressed')).toBe('true');
    expect(hapticLight).toHaveBeenCalledTimes(1);
    wait(400);
    tap();
    wait(100);
    tap();
    expect(latched()).toBe('move');
    expect(t.start).not.toHaveBeenCalled();
    expect(t.look.start).not.toHaveBeenCalled();
  });

  // chal1 SHOULD-2 (the challenger's probe): a slide's press is never half of a pair
  it('a slide adopted and lifted still, then one quick hat tap: no toggle', () => {
    render(<NavHat jog={jogOf()} />);
    place();
    eyeDown(EYE);
    eyeMove({ x: EYE.x + 30, y: EYE.y + 30 });
    expect(useNavMode.getState().temp).toBe(true);
    hatUp({ x: EYE.x + 30, y: EYE.y + 30 }, 2);
    wait(60);
    tap();
    expect(latched()).toBe('move');
    expect(useNavMode.getState().temp).toBe(false);
  });

  it('a third quick tap starts a new pair: it never toggles straight back', () => {
    render(<NavHat jog={jogOf()} />);
    tap();
    wait(80);
    tap();
    wait(80);
    tap();
    expect(latched()).toBe('look');
  });

  it(`taps more than ${HAT_DOUBLE_TAP.gapMs} ms apart do not toggle; at ${HAT_DOUBLE_TAP.gapMs} they do`, () => {
    render(<NavHat jog={jogOf()} />);
    tap();
    wait(HAT_DOUBLE_TAP.gapMs + 1);
    tap();
    expect(latched()).toBe('move');
    wait(HAT_DOUBLE_TAP.gapMs);
    tap();
    expect(latched()).toBe('look');
  });

  it(`a tap held more than ${HAT_DOUBLE_TAP.tapMs} ms is no tap (either of the two)`, () => {
    render(<NavHat jog={jogOf()} />);
    tap(C, HAT_DOUBLE_TAP.tapMs + 1);
    wait(50);
    tap();
    expect(latched()).toBe('move');
    wait(50);
    tap(C, HAT_DOUBLE_TAP.tapMs + 1);
    expect(latched()).toBe('move');
  });

  it('two taps with more than 10 px of travel (a steering correction) do not toggle: each started a jog', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    for (let i = 0; i < 2; i++) {
      hatDown(C);
      hatMove({ x: C.x + 11, y: C.y });
      wait(40);
      hatUp({ x: C.x + 11, y: C.y });
      wait(60);
    }
    expect(latched()).toBe('move');
    expect(t.start).toHaveBeenCalledTimes(2);
  });

  it('a tap that starts a jog never counts: a jog flick then one tap does not toggle; nor a tap then a flick', () => {
    const t = jogOf();
    render(<NavHat jog={t} />);
    hatDown(C);
    hatMove({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    wait(30);
    hatUp({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    wait(60);
    tap();
    expect(latched()).toBe('move');
    wait(400);
    tap();
    wait(60);
    hatDown(C);
    hatMove({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    hatUp({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    expect(latched()).toBe('move');
    // a refused jog (the scene busy) is still a press that moved: not a tap
    const busy = jogOf({ start: vi.fn(() => false) });
    cleanup();
    render(<NavHat jog={busy} />);
    hatDown(C);
    hatMove({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    hatUp({ x: C.x + JOG_DEAD_PX + 2, y: C.y });
    wait(50);
    tap();
    expect(latched()).toBe('move');
  });

  it('a pointercancel between them breaks the pair; with no Look offered a double tap does nothing', () => {
    render(<NavHat jog={jogOf()} />);
    tap();
    hatDown(C);
    fireEvent.pointerCancel(hat(), ev(C, 1));
    tap();
    expect(latched()).toBe('move');
    cleanup();
    render(<NavHat jog={jogOf({ look: undefined })} />);
    tap();
    wait(50);
    tap();
    expect(latched()).toBe('move');
  });
});
