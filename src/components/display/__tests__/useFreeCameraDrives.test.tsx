import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import * as depth from '../caseDepth';
import * as camera from '../caseCamera';
import { EYE_MARGIN_MM, JOG_FULL_PX, poseOf, withPose, type Pose } from '../casePose';
import { SCENE_CEILING_VIEWPORTS, projector } from '../caseBudget';
import { capSpanMm, frameSpanMm, type Box } from '../caseFraming';
import { DRAWN_CABINETS_LIMIT } from '../caseCull';
import { useFreeCamera, type FreeScene } from '../useFreeCamera';
import { LONG_WALL, freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-DEPTH-2 (Ross 11-13): the hat (the bottom-centre button's jog) and the depth rocker are two drives of one eye, held
// at once: each frame the hat walks the eye, then the depth dollies it along its horizontal heading (dollyStep, through
// the jog's own rules and the scene's GPU budget), and the pose is written once. A finger on the scene waits for both;
// the window losing focus or the page hidden stops both where they are.

vi.mock('../caseDepth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../caseDepth')>();
  return { ...real, dollyStep: vi.fn(real.dollyStep) };
});
const dollyStep = vi.mocked(depth.dollyStep);
vi.mock('../caseCamera', async (importOriginal) => {
  const real = await importOriginal<typeof import('../caseCamera')>();
  return { ...real, cssSceneTransform: vi.fn(real.cssSceneTransform) };
});
/** Every write of the scene root's transform (useFreeCamera's write). */
const writes = vi.mocked(camera.cssSceneTransform);

const DEG = Math.PI / 180;

afterEach(() => {
  vi.restoreAllMocks();
  dollyStep.mockClear();
  writes.mockClear();
});

/** The hook at `scene`, its DOM, frames by hand, and what it wrote. */
function mount(scene: FreeScene = freeSceneOf()) {
  const frames = handFrames();
  const dom = freeDom();
  const ref = { current: scene };
  let renders = 0;
  const hook = renderHook(() => useFreeCamera(ref, dom, { current: null }, () => renders++));
  const fc = () => hook.result.current;
  /** The pose drawn now (the framing's while none is held). */
  const pose = (): Pose => poseOf(hook.result.current.camera(ref.current.base));
  const run = (n: number, ms = 16, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      frames.tick(ms);
      each?.();
    }
  };
  return { ref, dom, frames, fc, pose, run, renders: () => renders, unmount: hook.unmount };
}

describe('NAV-DEPTH-2: the hat and the depth drive the eye at the same time', () => {
  it('hat and depth held 30 frames move both x and z; the hat alone moves x only, the depth alone z only', () => {
    const both = mount();
    const p0 = both.pose();
    expect(both.fc().jogStart()).toBe(true);
    expect(both.fc().depthStart(1)).toBe(true);
    both.fc().jogAim(JOG_FULL_PX, 0);
    both.run(1);
    // each frame both drives move the eye, and the pose is written once
    let before = writes.mock.calls.length;
    both.run(30, 16, () => {
      expect(writes.mock.calls.length).toBe(before + 1);
      before = writes.mock.calls.length;
    });
    const p1 = both.pose();
    expect(both.dom.rootEl.style.transform).toBe(camera.cssSceneTransform(withPose(both.ref.current.base, p1), both.ref.current.s));
    expect(p1.x).toBeGreaterThan(p0.x + 100);
    expect(p1.z).toBeLessThan(p0.z - 100);
    expect([p1.yaw, p1.pitch]).toEqual([p0.yaw, p0.pitch]);
    both.unmount();

    const hat = mount();
    hat.fc().jogStart();
    hat.fc().jogAim(JOG_FULL_PX, 0);
    hat.run(31);
    // both runs reach the wall's right end (jogOk); the hat at the nearer depth in finer steps, so closer to it (B1 pins
    // the joined hat's step)
    const right = hat.ref.current.wall.rightMm;
    expect(hat.pose().x).toBeLessThanOrEqual(right);
    expect(p1.x).toBeLessThanOrEqual(right);
    expect(p1.x).toBeGreaterThan(hat.pose().x);
    expect(hat.pose().z).toBe(p0.z);
    hat.unmount();

    const dep = mount();
    dep.fc().depthStart(1);
    dep.run(31);
    expect(dep.pose().x).toBe(p0.x);
    expect(dep.pose().z).toBeLessThan(p0.z - 100);
    expect(dep.dom.hostEl.dataset.gesture).toBe('depth');
    dep.unmount();
  });

  it('back (r < 0) retreats; inside the dead zone nothing moves; depthRate changes the reach of a running drive only', () => {
    const m = mount();
    const p0 = m.pose();
    m.fc().depthRate(1);
    m.run(5);
    expect(m.fc().live()).toBe(false);
    expect(m.fc().depthStart(0.05)).toBe(true);
    m.run(10);
    expect(m.pose()).toEqual(p0);
    expect(m.fc().live()).toBe(true);
    m.fc().depthRate(-1);
    m.run(10);
    expect(m.pose().z).toBeGreaterThan(p0.z);
    const back = m.pose().z;
    m.fc().depthRate(0.5);
    m.run(10);
    expect(m.pose().z).toBeLessThan(back);
  });

  it('depthStop leaves the hat running; jogStop leaves the depth running; the last stop holds the pose and returns it', () => {
    const m = mount();
    m.fc().jogStart();
    m.fc().depthStart(1);
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(11);
    let left: Pose | null = poseOf(m.ref.current.base);
    act(() => {
      left = m.fc().depthStop();
    });
    // another drive still moves the eye: its own stop returns the pose
    expect(left).toBeNull();
    expect(m.fc().depthStop()).toBeNull();
    expect(m.dom.hostEl.dataset.gesture).toBe('jog');
    const a = m.pose();
    m.run(10);
    expect(m.pose().x).toBeGreaterThan(a.x);
    expect(m.pose().z).toBe(a.z);

    m.fc().depthStart(1);
    m.run(1);
    act(() => {
      left = m.fc().jogStop();
    });
    expect(left).toBeNull();
    expect(m.fc().jogStop()).toBeNull();
    expect(m.dom.hostEl.dataset.gesture).toBe('depth');
    const b = m.pose();
    m.run(10);
    expect(m.pose().x).toBe(b.x);
    expect(m.pose().z).toBeLessThan(b.z);
    // the hat's thumb moving after its lift steers nothing
    m.fc().jogAim(-JOG_FULL_PX, 0);
    m.run(5);
    expect(m.pose().x).toBe(b.x);

    act(() => {
      left = m.fc().depthStop();
    });
    const c = m.pose();
    expect(left).toEqual(c);
    expect(m.fc().held()).toEqual(c);
    expect(m.fc().live()).toBe(false);
    expect(m.dom.hostEl.dataset.gesture).toBeUndefined();
    expect(m.frames.pending()).toBe(0);
    m.run(10);
    expect(m.pose()).toEqual(c);
  });

  it('a second start of a running drive is refused; a hat joining a depth drive starts from where the depth has got', () => {
    const m = mount();
    expect(m.fc().depthStart(1)).toBe(true);
    expect(m.fc().depthStart(1)).toBe(false);
    m.run(11);
    const at = m.pose();
    expect(m.fc().jogStart()).toBe(true);
    expect(m.fc().jogStart()).toBe(false);
    expect(m.dom.hostEl.dataset.gesture).toBe('jog');
    // the hat's first frame only takes the time: the depth alone moves it
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(1);
    expect(m.pose().x).toBe(at.x);
    m.run(1);
    expect(m.pose().x).toBeGreaterThan(at.x);
  });

  it('B1: a hat joined to a depth drive walks at the depth the eye is at now: after the depth closes in, as a fresh hat there (within 25 %)', () => {
    const scene = freeSceneOf({ figures: 0 });
    const m = mount(scene);
    m.fc().jogStart();
    m.fc().depthStart(1);
    m.run(121);
    const near = m.pose();
    expect(poseOf(scene.base).z - near.z).toBeGreaterThan(1000);
    m.fc().depthStop();
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(1);
    const a0 = m.pose().x;
    m.run(5);
    const joined = (m.pose().x - a0) / 5;
    m.unmount();

    const f = mount(scene);
    f.fc().hold(near);
    f.fc().jogStart();
    f.fc().jogAim(JOG_FULL_PX, 0);
    f.run(2);
    const b0 = f.pose().x;
    f.run(5);
    const fresh = (f.pose().x - b0) / 5;
    expect(fresh).toBeGreaterThan(0);
    expect(joined / fresh).toBeLessThan(1.25);
    expect(joined / fresh).toBeGreaterThan(0.8);
  });

  it('blur stops every drive and holds the pose: no drift after', () => {
    const m = mount();
    m.fc().jogStart();
    m.fc().depthStart(1);
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(11);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    const at = m.pose();
    expect(m.fc().live()).toBe(false);
    expect(m.fc().held()).toEqual(at);
    expect(m.dom.hostEl.dataset.gesture).toBeUndefined();
    m.run(30);
    expect(m.pose()).toEqual(at);
    // the first lift after the halt returns where it held (CabinetScene sets the focus from it), once; the rocker moving
    // finds nothing to steer
    let left: Pose | null = null;
    act(() => {
      left = m.fc().jogStop();
    });
    expect(left).toEqual(at);
    m.fc().depthRate(1);
    expect(m.fc().depthStop()).toBeNull();
    expect(m.fc().jogStop()).toBeNull();
    m.run(5);
    expect(m.pose()).toEqual(at);
  });

  it('B2: blur mid hat-only jog: the eye holds, and the lift returns the halted pose once (the focus follows it)', () => {
    const m = mount();
    m.fc().jogStart();
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(11);
    act(() => void window.dispatchEvent(new Event('blur')));
    const at = m.pose();
    expect(at.x).toBeGreaterThan(poseOf(m.ref.current.base).x);
    m.run(5);
    expect(m.pose()).toEqual(at);
    // the depth was not running: its stop has nothing to return
    expect(m.fc().depthStop()).toBeNull();
    let left: Pose | null = null;
    act(() => {
      left = m.fc().jogStop();
    });
    expect(left).toEqual(at);
    expect(m.fc().jogStop()).toBeNull();
  });

  it('B2: a halted depth drive\'s stop returns the pose once; a drive begun after a halt forgets it', () => {
    const m = mount();
    m.fc().depthStart(1);
    m.run(6);
    act(() => void window.dispatchEvent(new Event('blur')));
    const at = m.pose();
    expect(m.fc().jogStop()).toBeNull();
    expect(m.fc().depthStop()).toEqual(at);
    expect(m.fc().depthStop()).toBeNull();

    // halted again, then a new drive: the old halt is no lift's to return
    m.fc().depthStart(1);
    m.run(3);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(m.fc().jogStart()).toBe(true);
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(4);
    expect(m.fc().depthStop()).toBeNull();
    const now = m.pose();
    let left: Pose | null = null;
    act(() => {
      left = m.fc().jogStop();
    });
    expect(left).toEqual(now);
  });

  it('N1: visibilitychange to hidden stops every drive and holds the pose (no drift after); to visible it stops nothing', () => {
    const state = (v: 'hidden' | 'visible') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    try {
      const m = mount();
      m.fc().depthStart(-1);
      m.fc().jogStart();
      m.fc().jogAim(0, -JOG_FULL_PX);
      m.run(11);
      state('visible');
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      expect(m.fc().live()).toBe(true);
      state('hidden');
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      const at = m.pose();
      expect(m.fc().live()).toBe(false);
      expect(m.fc().held()).toEqual(at);
      m.run(30);
      expect(m.pose()).toEqual(at);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it('with no drive running, blur and a hidden page change nothing; unmounted, they are not heard (a drive the late target starts runs on)', () => {
    const hide = Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      const m = mount();
      const before = m.renders();
      act(() => {
        window.dispatchEvent(new Event('blur'));
        hide.dispatchEvent(new Event('visibilitychange'));
      });
      expect(m.renders()).toBe(before);
      expect(m.fc().held()).toBeNull();
      expect(m.fc().jogStop()).toBeNull();
      m.fc().depthStart(1);
      m.run(3);
      const fc = m.fc();
      m.unmount();
      expect(m.frames.pending()).toBe(0);
      // a withdrawn target's late start (N2, NAV-DEPTH-3) runs a drive no listener may stop
      fc.depthStart(1);
      m.run(1);
      window.dispatchEvent(new Event('blur'));
      expect(fc.live()).toBe(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(fc.live()).toBe(true);
      fc.depthStop();
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it('a press on the scene while any drive runs is ignored (no gesture of its own); a drive is refused while a finger owns the scene', () => {
    const m = mount();
    m.fc().depthStart(1);
    m.run(3);
    act(() => m.fc().press({ pointerId: 7, clientX: 400, clientY: 200, button: 0 }, { x: 400, y: 200 }));
    act(() => m.fc().drag(7, { x: 300, y: 200 }, 'x'));
    expect(m.dom.hostEl.dataset.gesture).toBe('depth');
    const a = m.pose();
    m.run(5);
    // only the depth moved it
    expect(m.pose().x).toBe(a.x);
    expect(m.fc().release(7, true)).toBeNull();
    m.fc().depthStop();

    // a finger down first owns the scene: neither drive starts
    act(() => m.fc().press({ pointerId: 8, clientX: 400, clientY: 200, button: 0 }, { x: 400, y: 200 }));
    expect(m.fc().depthStart(1)).toBe(false);
    expect(m.fc().jogStart()).toBe(false);
    m.fc().release(8, true);
    expect(m.fc().depthStart(1)).toBe(true);
  });

  it('a depth drive started while a look eases back starts from where the ease rests', () => {
    const m = mount();
    const p0 = m.pose();
    act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    // a right drag looks at once: far right, past the soft limit, then let go: it eases back
    act(() => m.fc().drag(1, { x: 860, y: 200 }, 'x'));
    act(() => {
      m.fc().release(1, true);
    });
    const rest = m.fc().held()!;
    expect(rest.yaw).not.toBe(0);
    expect(m.fc().depthStart(1)).toBe(true);
    // the ease is done at once: the eye is drawn at its rest
    expect(m.pose().yaw).toBeCloseTo(rest.yaw, 6);
    m.run(11);
    const p = m.pose();
    expect(p.yaw).toBeCloseTo(rest.yaw, 6);
    // along the turned heading: it went sideways too
    expect(p.z).toBeLessThan(p0.z);
    expect(Math.sign(p.x - p0.x)).toBe(Math.sign(Math.sin(rest.yaw)));
  });
});

describe('NAV-DEPTH-2: the depth drive keeps to the GPU budget, carrying the cost from frame to frame', () => {
  const v0s = () => dollyStep.mock.calls.map((c) => c[4]);

  it('v0 is carried while the scene and pose stand; dropped (undefined) on the next dollyStep after a resize', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    m.fc().depthStart(1);
    m.run(4);
    // the first frame only takes the time; the first dolly asks the cost itself; then the cost is carried
    expect(v0s()[0]).toBeUndefined();
    expect(v0s().slice(1).every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    expect(v0s().length).toBe(3);
    m.ref.current = freeSceneOf({ figures: 120, frame: { width: 412, height: 780 } });
    m.run(2);
    expect(v0s()[3]).toBeUndefined();
    expect(typeof v0s()[4]).toBe('number');
  });

  it('v0 is dropped after a scene change (a new render: a new budget), however alike, and after the hat moved the eye this frame', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    m.fc().depthStart(1);
    m.run(3);
    expect(typeof v0s()[1]).toBe('number');
    m.ref.current = { ...m.ref.current, budget: { ...m.ref.current.budget } };
    m.run(2);
    expect(v0s()[2]).toBeUndefined();
    expect(typeof v0s()[3]).toBe('number');
    // the hat walks the eye before the dolly: the cost carried was the old place's
    m.fc().jogStart();
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(1);
    expect(typeof v0s()[4]).toBe('number');
    const x = m.pose().x;
    m.run(3);
    expect(m.pose().x).toBeGreaterThan(x);
    expect(v0s().slice(5)).toEqual([undefined, undefined, undefined]);
  });

  it('the dolly gets the jog\'s rules: the scene\'s room and boxes, an ok, and a budget projected at the scene\'s px per mm (its unturned camera)', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    m.fc().depthStart(1);
    m.run(2);
    const [pose, r, dt, scene] = dollyStep.mock.calls[0];
    expect(r).toBe(1);
    expect(dt).toBe(16);
    expect(scene.space).toBe(m.ref.current.space);
    expect(scene.boxes).toBe(m.ref.current.boxes);
    expect(scene.ok).toBeTypeOf('function');
    const project = projector(m.ref.current.budget);
    const at: [number, number, number] = [pose.x, pose.y, pose.z - 500];
    expect(scene.vp!(at)).toBe(project(withPose(m.ref.current.base, { ...pose, x: at[0], y: at[1], z: at[2] })).vp);
  });

  it('turned, the budget is projected at the px per mm held from where the turn left yaw 0 (the camera the scene renders with)', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    const p0 = m.pose();
    act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    act(() => m.fc().drag(1, { x: 600, y: 200 }, 'x'));
    act(() => {
      m.fc().release(1, true);
    });
    m.fc().hold(m.fc().held());
    const turned = m.fc().held()!;
    expect(turned.yaw).not.toBe(0);
    const unturned = m.fc().unturned(m.ref.current.base)!;
    expect(unturned.yaw ?? 0).toBe(0);
    expect([unturned.x, unturned.z]).toEqual([p0.x, p0.z]);
    m.fc().depthStart(1);
    m.run(2);
    const [pose, , , scene] = dollyStep.mock.calls[0];
    const project = projector(m.ref.current.budget);
    const at: [number, number, number] = [pose.x + 200, pose.y, pose.z - 900];
    const camera = withPose(m.ref.current.base, { ...pose, x: at[0], y: at[1], z: at[2] });
    expect(scene.vp!(at)).toBe(project(camera, unturned).vp);
    expect(scene.vp!(at)).not.toBe(project(camera).vp);
  });

  it('held at r = 1 for 2 s over 622 figures: the cost never passes the ceiling and the eye never enters a cabinet\'s margin; the budget, not the room, stopped it', () => {
    // a screen small enough that the walk in toward the shelves would pass the ceiling (it peaks near 3.7 viewports)
    const scene = freeSceneOf({ figures: 622, viewportPx: 180_000 });
    const project = projector(scene.budget);
    const vpAt = (p: Pose) => project(withPose(scene.base, p)).vp;
    const grown = (b: Box, p: Pose) =>
      p.x > b.x0 - EYE_MARGIN_MM && p.x < b.x1 + EYE_MARGIN_MM && p.y > b.y0 - EYE_MARGIN_MM && p.y < b.y1 + EYE_MARGIN_MM && p.z > b.z0 - EYE_MARGIN_MM && p.z < b.z1 + EYE_MARGIN_MM;
    const m = mount(scene);
    expect(vpAt(m.pose())).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    m.fc().depthStart(1);
    let worst = 0;
    m.run(125, 16, () => {
      const p = m.pose();
      worst = Math.max(worst, vpAt(p));
      for (const b of scene.boxes) expect(grown(b, p)).toBe(false);
    });
    expect(worst).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    // the budget held it there: 2 mm on (DEPTH_STOP_MM is 1) passes the ceiling, and the room would let it go on
    const held = m.pose();
    expect(vpAt({ ...held, z: held.z - 2 })).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
    m.run(10);
    expect(m.pose()).toEqual(held);
    const free = depth.dolly(held, 1, 16, { space: scene.space, boxes: scene.boxes });
    expect(free.z).toBeLessThan(held.z - 1);
    let p = poseOf(scene.base);
    for (let i = 0; i < 125; i++) p = depth.dolly(p, 1, 16, { space: scene.space, boxes: scene.boxes });
    expect(p.z).toBeLessThan(m.pose().z - 300);
  });

  it('turned 25 deg and backing away 10 s on a wall longer than the case draws at once, the depth stops at the Classic cap (the jog\'s ok), where the room would let it go on', () => {
    const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
    const start: Pose = { ...poseOf(scene.base), yaw: 25 * DEG };
    const span = Math.max(capSpanMm(LONG_WALL, DRAWN_CABINETS_LIMIT), frameSpanMm(withPose(scene.base, start), scene.fronts));
    expect(span).toBeLessThan(Infinity);
    const m = mount(scene);
    m.fc().hold(start);
    m.fc().depthStart(-1);
    let worst = 0;
    m.run(625, 16, () => {
      worst = Math.max(worst, frameSpanMm(withPose(scene.base, m.pose()), scene.fronts));
      expect(worst).toBeLessThanOrEqual(span);
    });
    // it reached the cap, and the cap, not the room, held it
    expect(worst).toBeGreaterThan(span * 0.99);
    const held = m.pose();
    expect(held.z).toBeGreaterThan(start.z + 500);
    let free = start;
    for (let i = 0; i < 625; i++) free = depth.dolly(free, -1, 16, { space: scene.space, boxes: scene.boxes });
    expect(frameSpanMm(withPose(scene.base, free), scene.fronts)).toBeGreaterThan(span);
    expect(free.z).toBeGreaterThan(held.z + 50);
  });

  it('M05: the budget swapped mid-drive for a tighter one (a new render, a smaller screen): the dolly keeps to the new one, never the old projection', () => {
    const loose = freeSceneOf({ figures: 622 });
    const tight = freeSceneOf({ figures: 622, viewportPx: 180_000 });
    const project = projector(tight.budget);
    const vpAt = (p: Pose) => project(withPose(tight.base, p)).vp;
    const m = mount(loose);
    m.fc().depthStart(1);
    m.run(3);
    expect(vpAt(m.pose())).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    m.ref.current = tight;
    let worst = 0;
    m.run(125, 16, () => (worst = Math.max(worst, vpAt(m.pose()))));
    expect(worst).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    // the loose budget would have let it on past the tight ceiling
    const lone = mount(loose);
    lone.fc().depthStart(1);
    let looseWorst = 0;
    lone.run(128, 16, () => (looseWorst = Math.max(looseWorst, vpAt(lone.pose()))));
    expect(looseWorst).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
  });

  it('turned toward the wall\'s end, the depth never takes the eye farther past it than it stood (the jog\'s ok)', () => {
    const scene = freeSceneOf({ figures: 0 });
    const right = scene.wall.rightMm;
    const m = mount(scene);
    m.fc().hold({ ...poseOf(scene.base), x: right - 50, yaw: 70 * DEG });
    m.fc().depthStart(1);
    m.run(60, 16, () => expect(m.pose().x).toBeLessThanOrEqual(right));
    expect(m.pose().x).toBeGreaterThan(right - 50);
    expect(depth.dolly(m.pose(), 1, 16, { space: scene.space, boxes: scene.boxes }).x).toBeGreaterThan(right);
  });

  describe('item 7: held still against a limit, the depth asks nothing more until the pose, the rate\'s sign or the scene changes', () => {
    /** Depth at r = 1 over 622 figures on a small screen, 2 s: held at the ceiling. */
    const atCeiling = (viewportPx = 180_000) => {
      const m = mount(freeSceneOf({ figures: 622, viewportPx }));
      m.fc().depthStart(1);
      m.run(125);
      const held = m.pose();
      m.run(2);
      expect(m.pose()).toEqual(held);
      return { m, held };
    };
    const calls = () => dollyStep.mock.calls.length;

    it('held at the ceiling: no dolly (no projection) while nothing changes, a weaker push the same way included', () => {
      const { m, held } = atCeiling();
      const n = calls();
      m.run(20);
      m.fc().depthRate(0.5);
      m.run(5);
      m.fc().depthRate(0.05);
      m.run(5);
      m.fc().depthRate(1);
      m.run(5);
      expect(calls()).toBe(n);
      expect(m.pose()).toEqual(held);
    });

    it('the rate turned back: asked again at once, and the eye backs away', () => {
      const { m, held } = atCeiling();
      const n = calls();
      m.fc().depthRate(-1);
      m.run(1);
      expect(calls()).toBe(n + 1);
      m.run(5);
      expect(m.pose().z).toBeGreaterThan(held.z);
    });

    it('the hat moving the eye: asked again every frame', () => {
      const { m } = atCeiling();
      const n = calls();
      m.fc().jogStart();
      m.fc().jogAim(JOG_FULL_PX, 0);
      m.run(1);
      expect(calls()).toBe(n);
      m.run(4);
      expect(calls()).toBe(n + 4);
    });

    it('a resize or a new budget is a new scene: asked again; a tighter one never lets the cost rise, a looser one lets the eye on', () => {
      const { m, held } = atCeiling();
      const n = calls();
      // the same budget, a new render: asked again (its cost asked afresh: no v0), and held as before
      m.ref.current = { ...m.ref.current, budget: { ...m.ref.current.budget } };
      m.run(1);
      expect(calls()).toBe(n + 1);
      expect(dollyStep.mock.calls[n][4]).toBeUndefined();
      expect(m.pose()).toEqual(held);
      // a smaller screen: the eye stands over the new ceiling; frame by frame its cost never rises
      const tight = freeSceneOf({ figures: 622, viewportPx: 120_000 });
      const project = projector(tight.budget);
      const vpAt = (p: Pose) => project(withPose(tight.base, p)).vp;
      m.ref.current = tight;
      let last = vpAt(m.pose());
      expect(last).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
      const before = calls();
      m.run(30, 16, () => {
        const v = vpAt(m.pose());
        expect(v).toBeLessThanOrEqual(last);
        last = v;
      });
      expect(calls()).toBeGreaterThan(before);
      // a bigger screen: the eye goes on in
      const z = m.pose().z;
      m.ref.current = freeSceneOf({ figures: 622, viewportPx: 400_000 });
      m.run(10);
      expect(m.pose().z).toBeLessThan(z);
    });

    it('a push from the dead zone is never taken for a hold: the eye moves as soon as the rocker leaves it', () => {
      const m = mount(freeSceneOf({ figures: 622, viewportPx: 180_000 }));
      const z = m.pose().z;
      m.fc().depthStart(0.05);
      m.run(6);
      expect(m.pose().z).toBe(z);
      m.fc().depthRate(1);
      m.run(2);
      expect(m.pose().z).toBeLessThan(z);
    });

    it('a frame with no time (two frames at one instant) is never taken for a hold', () => {
      const m = mount(freeSceneOf({ figures: 0 }));
      m.fc().depthStart(1);
      m.run(2);
      const z = m.pose().z;
      m.frames.tick(0);
      expect(m.pose().z).toBe(z);
      m.run(1);
      expect(m.pose().z).toBeLessThan(z);
    });

    it('held at the Classic cap backing away: no dolly while nothing changes', () => {
      const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
      const m = mount(scene);
      m.fc().hold({ ...poseOf(scene.base), yaw: 25 * DEG });
      m.fc().depthStart(-1);
      m.run(625);
      const held = m.pose();
      m.run(1);
      const n = calls();
      m.run(10);
      expect(calls()).toBe(n);
      expect(m.pose()).toEqual(held);
    });
  });

  it('the hat alone never asks the budget (no dolly runs)', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    m.fc().jogStart();
    m.fc().jogAim(JOG_FULL_PX, JOG_FULL_PX);
    m.run(20);
    expect(dollyStep).not.toHaveBeenCalled();
  });
});

describe('NAV-DEPTH-2: turned drives', () => {
  it('turned 20 deg, the depth moves along the turned heading and keeps the turn', () => {
    const m = mount(freeSceneOf({ figures: 0 }));
    const p0 = poseOf(m.ref.current.base);
    m.fc().hold({ ...p0, yaw: 20 * DEG });
    m.fc().depthStart(1);
    m.run(6);
    const p = m.pose();
    expect(p.yaw).toBeCloseTo(20 * DEG, 6);
    const dx = p.x - p0.x;
    const dz = p.z - p0.z;
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeLessThan(0);
    expect(Math.atan2(dx, -dz)).toBeCloseTo(20 * DEG, 6);
  });
});
