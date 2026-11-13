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
    expect(hat.pose().x).toBeCloseTo(p1.x, 6);
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
    // the thumbs lifting later find nothing to stop, and the rocker moving finds nothing to steer
    expect(m.fc().jogStop()).toBeNull();
    m.fc().depthRate(1);
    expect(m.fc().depthStop()).toBeNull();
    m.run(5);
    expect(m.pose()).toEqual(at);
  });

  it('visibilitychange stops every drive and holds the pose: no drift after', () => {
    const m = mount();
    m.fc().depthStart(-1);
    m.fc().jogStart();
    m.fc().jogAim(0, -JOG_FULL_PX);
    m.run(11);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const at = m.pose();
    expect(m.fc().live()).toBe(false);
    expect(m.fc().held()).toEqual(at);
    m.run(30);
    expect(m.pose()).toEqual(at);
  });

  it('with no drive running, blur and visibilitychange change nothing; unmounted, they are not heard', () => {
    const m = mount();
    const before = m.renders();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(m.renders()).toBe(before);
    expect(m.fc().held()).toBeNull();
    m.fc().depthStart(1);
    m.run(3);
    const fc = m.fc();
    m.unmount();
    expect(m.frames.pending()).toBe(0);
    window.dispatchEvent(new Event('blur'));
    expect(fc.held()).toBeNull();
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

  it('backing away on a wall longer than the case draws at once, the depth keeps to the Classic cap (the jog\'s ok), as the hat does', () => {
    const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
    const span = Math.max(capSpanMm(LONG_WALL, DRAWN_CABINETS_LIMIT), frameSpanMm(scene.base, scene.fronts));
    expect(span).toBeLessThan(Infinity);
    const m = mount(scene);
    m.fc().depthStart(-1);
    m.run(125, 16, () => expect(frameSpanMm(withPose(scene.base, m.pose()), scene.fronts)).toBeLessThanOrEqual(span));
    const held = m.pose();
    expect(held.z).toBeGreaterThan(poseOf(scene.base).z);
    // the cap held it: the room alone would let it back on
    const free = depth.dolly(held, -1, 16, { space: scene.space, boxes: scene.boxes });
    expect(free.z).toBeGreaterThan(held.z + 1);
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
