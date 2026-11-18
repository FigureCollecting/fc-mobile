import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { FloatingNav } from '../FloatingNav';
import { DEPTH_RAIL_PX, HAT_KNOB_PX, HAT_RING_PX, NAV_BLUE, NAV_CHIP_GAP_PX, NAV_EDGE_PX, NAV_LIFT_PX, NAV_MOUSE_SCALE, NAV_OPACITY } from '../navTuning';
import { DEPTH_FULL_PX } from '../caseDepth';
import { offerJog, useJogStore, type DepthDrive, type JogTarget } from '../../../stores/jog';

// NAV-FLOAT (handoff FINAL 11-17): the two controls float over the case, in document.body: the right XY hat and the left Z
// rail, shown only while a Free camera case offers its jog. The layer takes no touch; only the hat's circle and the
// rail's box do. Idle they are largely transparent (Ross 11-17): the opacities are navTuning's named values.

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
const layer = () => document.body.querySelector(':scope > .floating-nav') as HTMLElement | null;
const hat = () => document.querySelector('[data-nav="hat"]') as HTMLElement | null;
const rail = () => document.querySelector('[data-nav="depth"]') as HTMLElement | null;
const css = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n').replace(/\/\*.*?\*\//gs, '');
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector: string) => {
  const at = css().split('}').find((r) => r.split('{')[0].trim() === selector);
  expect(at, `a rule for ${selector}`).toBeDefined();
  return at!.split('{')[1];
};

beforeEach(() => useJogStore.setState({ target: null }));
afterEach(() => cleanup());

describe('the floating controls: when they show', () => {
  it('nothing offered (the tiles, the old camera): nothing floats', () => {
    render(<FloatingNav />);
    expect(layer()).toBeNull();
    expect(document.querySelector('[data-nav]')).toBeNull();
  });

  it('a jog offered: the hat; with its depth, the Z rail left of it too; withdrawn, both go', () => {
    const { container } = render(<FloatingNav />);
    const withdraw = offer(jogOf());
    expect(hat()).not.toBeNull();
    expect(rail()).toBeNull();
    withdraw();
    expect(layer()).toBeNull();
    offer(jogOf(drive()));
    expect(Array.from(layer()!.querySelectorAll<HTMLElement>('[data-nav]')).map((n) => n.dataset.nav)).toEqual(['depth', 'hat']);
    // in document.body, like the case tabs: the scene never sees a pointer of theirs, so two thumbs never pinch
    expect(container.querySelector('.floating-nav')).toBeNull();
    // the layer itself is no control: a screenshot's mask over [data-nav] covers the two controls, not the scene
    expect(layer()!.hasAttribute('data-nav')).toBe(false);
  });

  it('a card of the page lies over the case (hidden): both go, a drive held then is stopped once; the card closed, they are back', () => {
    const d = drive();
    const t = jogOf(d) as JogTarget & { stop: ReturnType<typeof vi.fn> };
    const { rerender } = render(<FloatingNav />);
    offer(t);
    fireEvent.pointerDown(hat()!, { pointerId: 1, clientX: 400, clientY: 500, button: 0 });
    fireEvent.pointerMove(hat()!, { pointerId: 1, clientX: 440, clientY: 500 });
    fireEvent.pointerDown(rail()!, { pointerId: 2, clientX: 300, clientY: 480, button: 0 });
    fireEvent.pointerMove(rail()!, { pointerId: 2, clientX: 300, clientY: 440 });
    rerender(<FloatingNav hidden />);
    expect(layer()).toBeNull();
    expect(document.querySelector('[data-nav]')).toBeNull();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(d.stop).toHaveBeenCalledTimes(1);
    rerender(<FloatingNav hidden={false} />);
    expect(hat()).not.toBeNull();
    expect(rail()).not.toBeNull();
    expect(hat()!.hasAttribute('data-jogging')).toBe(false);
  });
});

describe('the floating controls: what takes a touch, and how they look', () => {
  beforeEach(() => {
    render(<FloatingNav />);
    offer(jogOf(drive()));
  });

  it('the layer covers the viewport and takes no touch; only the hat\'s circle and the rail\'s box do', () => {
    expect(rule('.floating-nav')).toMatch(/position:\s*fixed;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/);
    expect(rule('.nav-hat')).toMatch(/pointer-events:\s*auto;/);
    expect(rule('.nav-hat')).toMatch(/border-radius:\s*50%;/);
    expect(rule('.nav-hat')).toMatch(/touch-action:\s*none;/);
    expect(rule('.nav-depth')).toMatch(/pointer-events:\s*auto;/);
    expect(rule('.nav-depth')).toMatch(/touch-action:\s*none;/);
    // what is drawn inside them takes none of its own
    for (const part of ['.nav-hat__knob', '.nav-hat__arrow', '.nav-hat__eye-slot', '.nav-depth__knob', '.nav-depth__end']) {
      expect(rule(part), part).toMatch(/pointer-events:\s*none;/);
    }
  });

  it('subdued blue, largely transparent at rest: fill, ring and rail, knob and active are navTuning\'s opacities', () => {
    expect(NAV_OPACITY.fill).toBeLessThan(NAV_OPACITY.line);
    expect(NAV_OPACITY.line).toBeLessThan(NAV_OPACITY.knob);
    expect(NAV_OPACITY.knob).toBeLessThan(NAV_OPACITY.active);
    expect(NAV_OPACITY.fill).toBeLessThanOrEqual(0.18);
    expect(NAV_OPACITY.active).toBeLessThan(1);
    const root = rule('.floating-nav');
    expect(root).toContain(`--nav-fill: hsl(${NAV_BLUE} / ${NAV_OPACITY.fill});`);
    expect(root).toContain(`--nav-line: hsl(${NAV_BLUE} / ${NAV_OPACITY.line});`);
    expect(root).toContain(`--nav-knob: hsl(${NAV_BLUE} / ${NAV_OPACITY.knob});`);
    expect(root).toContain(`--nav-active: hsl(${NAV_BLUE} / ${NAV_OPACITY.active});`);
    expect(rule('.nav-hat')).toMatch(/background:\s*var\(--nav-fill\);/);
    expect(rule('.nav-hat')).toMatch(/border:\s*1\.5px solid var\(--nav-line\);/);
    expect(rule('.nav-hat__knob')).toMatch(/background:\s*var\(--nav-knob\);/);
    expect(rule('.nav-hat[data-jogging] .nav-hat__knob')).toMatch(/background:\s*var\(--nav-active\);/);
    expect(rule('.nav-depth::before')).toMatch(/background:\s*var\(--nav-fill\);/);
    expect(rule('.nav-depth__knob')).toMatch(/background:\s*var\(--nav-knob\);/);
    expect(rule('.nav-depth[data-rocking] .nav-depth__knob')).toMatch(/background:\s*var\(--nav-active\);/);
    // never white arrows: they are the line's blue
    expect(rule('.nav-hat')).toMatch(/color:\s*var\(--nav-knob\);/);
    expect(rule('.nav-depth')).toMatch(/color:\s*var\(--nav-knob\);/);
  });

  it('composites cheaply over the scene: no backdrop-filter and no drop shadow anywhere in its sheet', () => {
    const own = css().split('\n').filter((line) => /nav-hat|nav-depth|floating-nav/.test(line)).join('\n');
    expect(own.length).toBeGreaterThan(200);
    const sheet = css().slice(css().indexOf('.floating-nav'));
    expect(sheet).not.toMatch(/backdrop-filter/);
    expect(sheet).not.toMatch(/box-shadow|drop-shadow|filter:/);
  });

  it('sizes and anchors: the ring 104 px (120 from 600 px wide), the rail 28 x 92 in a 56 x 132 target, both 16 px above the case tabs, 20 px in from the safe area', () => {
    expect([HAT_RING_PX.compact, HAT_RING_PX.wide, HAT_RING_PX.wideFrom, HAT_KNOB_PX]).toEqual([104, 120, 600, 36]);
    expect(DEPTH_RAIL_PX).toEqual({ width: 28, height: 92, hitWidth: 56, hitHeight: 132, knob: 24, travel: 34 });
    expect([NAV_EDGE_PX, NAV_LIFT_PX, NAV_MOUSE_SCALE]).toEqual([20, 16, 0.85]);
    // the sizes are the page's while the controls float, so the scene's chips can stand clear of them
    const root = rule(':root');
    expect(root).toContain('--nav-k: 1;');
    expect(root).toContain('--hat-size: calc(104px * var(--nav-k));');
    expect(root).toContain('--nav-base: calc(var(--bottom-nav-height) + var(--safe-area-bottom, 0px) + 32px + 16px);');
    expect(css()).toMatch(/@media \(min-width: 600px\)\s*\{\s*:root\s*\{\s*--hat-size: calc\(120px \* var\(--nav-k\)\);/);
    // a mouse-only desktop: both shown, smaller
    expect(css()).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*:root\s*\{\s*--nav-k: 0\.85;/);
    expect(rule('.nav-hat')).toContain('right: calc(max(var(--safe-area-right, 0px), var(--nav-right, 0px)) + 20px);');
    expect(rule('.nav-hat')).toContain('bottom: var(--nav-base);');
    expect(rule('.nav-hat')).toContain('width: var(--hat-size);');
    // the rail's drawn box starts 20 px in and 16 px up; its larger target reaches round it
    expect(rule('.nav-depth')).toContain('left: calc(max(var(--safe-area-left, 0px), var(--nav-left, 0px)) + 20px - 14px * var(--nav-k));');
    expect(rule('.nav-depth')).toContain('bottom: calc(var(--nav-base) - 20px * var(--nav-k));');
    expect(rule('.nav-depth')).toContain('width: calc(56px * var(--nav-k));');
    expect(rule('.nav-depth')).toContain('height: calc(132px * var(--nav-k));');
    expect(rule('.nav-depth::before')).toContain('inset: calc(20px * var(--nav-k)) calc(14px * var(--nav-k));');
    // the knobs travel what the ring and the rail leave them
    expect(rule('.nav-hat__knob')).toContain('translate(calc(var(--hat-x, 0) * var(--hat-reach)), calc(var(--hat-y, 0) * var(--hat-reach)))');
    expect(root).toContain('--hat-reach: calc((var(--hat-size) - 36px * var(--nav-k)) / 2);');
    expect(rule('.nav-depth__knob')).toContain('translateY(calc(var(--depth-k, 0) * 34px * var(--nav-k)))');
  });

  it('the scene\'s own low chips stand inboard of the two controls while they float, so neither is covered', () => {
    expect(NAV_CHIP_GAP_PX).toBe(12);
    expect(rule('.cabinet-scene .cabinet-scene__reset')).toContain('right: calc(var(--safe-area-right, 0px) + 20px + var(--hat-size) + 12px);');
    expect(rule('.cabinet-scene .cabinet-scene__misfit')).toContain('left: calc(var(--safe-area-left, 0px) + 20px + 42px * var(--nav-k) + 12px);');
  });
});

describe('the floating controls: beside a pane', () => {
  function Host() {
    const within = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div ref={within} data-testid="col" />
        <FloatingNav within={within} />
      </div>
    );
  }
  let box = { left: 0, right: 870 };
  beforeEach(() => {
    box = { left: 0, right: 870 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.dataset.testid === 'col' ? { left: box.left, right: box.right, top: 0, bottom: 400, width: box.right - box.left, height: 400, x: box.left, y: 0 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(870);
  });
  afterEach(() => vi.restoreAllMocks());

  it('they keep to the column the case is in: its left and right insets are the layer\'s, re-read when the window changes', () => {
    render(<Host />);
    offer(jogOf(drive()));
    expect([layer()!.style.getPropertyValue('--nav-left'), layer()!.style.getPropertyValue('--nav-right')]).toEqual(['0px', '0px']);
    // the Info pane opens beside the case (Fold open): the hat stays over the case, not over the pane
    box = { left: 0, right: 510 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect([layer()!.style.getPropertyValue('--nav-left'), layer()!.style.getPropertyValue('--nav-right')]).toEqual(['0px', '360px']);
    // a column that runs past the window's edges insets nothing
    box = { left: -12, right: 900 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect([layer()!.style.getPropertyValue('--nav-left'), layer()!.style.getPropertyValue('--nav-right')]).toEqual(['0px', '0px']);
  });

  it('the column\'s own resize re-reads it (the pane opening changes no window); gone, nothing listens on', () => {
    const observed: Element[] = [];
    let fire = () => {};
    const disconnect = vi.fn();
    class RO {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', RO);
    const { unmount } = render(<Host />);
    const withdraw = offer(jogOf(drive()));
    expect(observed.map((el) => (el as HTMLElement).dataset.testid)).toEqual(['col']);
    box = { left: 40, right: 510 };
    act(() => fire());
    expect([layer()!.style.getPropertyValue('--nav-left'), layer()!.style.getPropertyValue('--nav-right')]).toEqual(['40px', '360px']);
    withdraw();
    expect(disconnect).toHaveBeenCalledTimes(1);
    unmount();
    vi.unstubAllGlobals();
  });

  it('no column given: the layer keeps to the window, with nothing measured', () => {
    render(<FloatingNav />);
    offer(jogOf(drive()));
    expect(layer()!.style.getPropertyValue('--nav-left')).toBe('');
  });
});

describe('the rail and the hat held together (NAV-DEPTH-2: two fingers, two drives)', () => {
  it('each keeps its own finger: the hat\'s lift stops the hat alone; the rail\'s lift stops the depth', () => {
    render(<FloatingNav />);
    const d = drive();
    const t = jogOf(d) as JogTarget & { start: ReturnType<typeof vi.fn>; aim: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    offer(t);
    fireEvent.pointerDown(hat()!, { pointerId: 1, clientX: 400, clientY: 500, button: 0 });
    fireEvent.pointerMove(hat()!, { pointerId: 1, clientX: 440, clientY: 500 });
    fireEvent.pointerDown(rail()!, { pointerId: 2, clientX: 300, clientY: 480, button: 0 });
    fireEvent.pointerMove(rail()!, { pointerId: 2, clientX: 300, clientY: 480 - DEPTH_FULL_PX });
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(40, 0);
    expect(d.start).toHaveBeenCalledWith(1);
    // the hat moves on while the rail is held
    fireEvent.pointerMove(hat()!, { pointerId: 1, clientX: 400, clientY: 460 });
    expect(t.aim).toHaveBeenLastCalledWith(0, -40);
    fireEvent.pointerUp(hat()!, { pointerId: 1, clientX: 400, clientY: 460 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(d.stop).not.toHaveBeenCalled();
    fireEvent.pointerMove(rail()!, { pointerId: 2, clientX: 300, clientY: 480 - DEPTH_FULL_PX / 2 });
    expect(d.rate).toHaveBeenLastCalledWith(0.5);
    fireEvent.pointerUp(rail()!, { pointerId: 2, clientX: 300, clientY: 480 - DEPTH_FULL_PX / 2 });
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('withdrawn while both are held (the case goes): each drive is stopped, once', () => {
    render(<FloatingNav />);
    const d = drive();
    const t = jogOf(d) as JogTarget & { stop: ReturnType<typeof vi.fn> };
    const withdraw = offer(t);
    fireEvent.pointerDown(hat()!, { pointerId: 1, clientX: 400, clientY: 500, button: 0 });
    fireEvent.pointerMove(hat()!, { pointerId: 1, clientX: 440, clientY: 500 });
    fireEvent.pointerDown(rail()!, { pointerId: 2, clientX: 300, clientY: 480, button: 0 });
    fireEvent.pointerMove(rail()!, { pointerId: 2, clientX: 300, clientY: 440 });
    withdraw();
    expect(layer()).toBeNull();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(d.stop).toHaveBeenCalledTimes(1);
  });
});
