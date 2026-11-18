import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import * as depth from '../caseDepth';
import * as camera from '../caseCamera';
import { JOG_DEAD_PX, JOG_FULL_PX, LOOK_REBASE_MS, PITCH, SPRING_MS, lookSpeed, poseOf, springBack, withPose, type Pose } from '../casePose';
import { coneOf, lookCone, useFreeCamera, type FreeScene } from '../useFreeCamera';
import { hapticLight } from '../../../utils/haptics';
import { LONG_WALL, freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-LOOKDRIVE (nav rework U4): the hat in Look mode is a drive of the same eye as its jog and the depth: held off its
// centre the eye turns at lookSpeed, through the cone a scene Look goes through (turnBy), never wound up against a limit;
// the lift eases a turn shown past its soft limit back to it. And no drive or drag begun while a look eases back makes
// the view jump.

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
vi.mock('../../../utils/haptics', () => ({ hapticLight: vi.fn() }));
const ticks = vi.mocked(hapticLight);

const DEG = Math.PI / 180;
const HALF_PX = JOG_DEAD_PX + (JOG_FULL_PX - JOG_DEAD_PX) / 2;

afterEach(() => {
  vi.restoreAllMocks();
  dollyStep.mockClear();
  writes.mockClear();
  ticks.mockClear();
});

/** The hook at `scene`, its DOM, frames by hand on the clock a lift's ease is timed from, and what it wrote. */
function mount(scene: FreeScene = freeSceneOf()) {
  const frames = handFrames(1000, true);
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
  /** The Look begun and held at (dx, dy) for `n` frames after its first. */
  const lookFor = (dx: number, dy: number, n: number, ms = 16, each?: () => void) => {
    expect(fc().lookStart()).toBe(true);
    fc().lookAim(dx, dy);
    run(1, ms);
    run(n, ms, each);
  };
  const stop = (which: 'lookStop' | 'depthStop' | 'jogStop' = 'lookStop'): Pose | null => {
    let left: Pose | null = null;
    act(() => {
      left = fc()[which]();
    });
    return left;
  };
  /** A scene Look by the mouse (a right drag looks at once), held: from the frame's middle to `x`. */
  const sceneLook = (x: number) => {
    act(() => fc().press({ pointerId: 1, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    act(() => fc().drag(1, { x, y: 200 }, 'x'));
  };
  return { ref, dom, frames, fc, pose, run, lookFor, stop, sceneLook, renders: () => renders, unmount: hook.unmount };
}

/** The cone a scene Look from `pose` has at `scene` (the one lookStart must take). */
const coneAt = (scene: FreeScene, pose: Pose) => lookCone(scene, pose, pose, () => {});

describe('(a) the hat\'s Look turns the eye at the rate the thumb holds', () => {
  it('held right at half reach for 1 s: yaw turns by lookSpeed x 1 s within 1 %; pitch and place stay; one write a frame; the lift holds it', () => {
    const m = mount();
    const p0 = m.pose();
    expect(m.fc().lookStart()).toBe(true);
    expect(m.dom.hostEl.dataset.gesture).toBe('jog-look');
    expect(m.fc().live()).toBe(true);
    m.fc().lookAim(HALF_PX, 0);
    m.run(1, 10);
    expect(m.pose()).toEqual(p0);
    let before = writes.mock.calls.length;
    m.run(100, 10, () => {
      expect(writes.mock.calls.length).toBe(before + 1);
      before = writes.mock.calls.length;
    });
    const p = m.pose();
    const want = lookSpeed(HALF_PX) * 1;
    expect(want / DEG).toBeCloseTo(11.953125, 6);
    expect(Math.abs(p.yaw - p0.yaw - want)).toBeLessThan(want * 0.01);
    expect(p.pitch).toBe(p0.pitch);
    expect([p.x, p.y, p.z]).toEqual([p0.x, p0.y, p0.z]);
    expect(JSON.parse(m.dom.hostEl.dataset.camera!).yaw).toBeCloseTo(p.yaw, 6);
    expect(m.dom.rootEl.style.transform).toBe(camera.cssSceneTransform(withPose(m.ref.current.base, p), m.ref.current.s, m.ref.current.reach));
    const renders = m.renders();
    const left = m.stop();
    expect(left).toEqual(p);
    expect(m.fc().held()).toEqual(p);
    // inside the soft limit: nothing to ease back
    expect(m.fc().live()).toBe(false);
    expect(m.frames.pending()).toBe(0);
    expect(m.dom.hostEl.dataset.gesture).toBeUndefined();
    // the stop's own render, and its write's (no cull is kept here, so every write asks for one)
    expect(m.renders()).toBe(renders + 2);
    expect(ticks).not.toHaveBeenCalled();
  });

  it('thumb up looks up (pitch -), left turns left; a diagonal turns both; in the dead zone nothing moves and nothing is written', () => {
    const m = mount();
    const p0 = m.pose();
    m.lookFor(0, -HALF_PX, 20);
    expect(m.pose().pitch).toBeLessThan(p0.pitch - 1 * DEG);
    expect(m.pose().yaw).toBe(p0.yaw);
    m.fc().lookAim(-JOG_FULL_PX, 0);
    m.run(10);
    expect(m.pose().yaw).toBeLessThan(p0.yaw - 5 * DEG);
    const a = m.pose();
    m.fc().lookAim(40, 40);
    m.run(10);
    expect(m.pose().yaw).toBeGreaterThan(a.yaw);
    expect(m.pose().pitch).toBeGreaterThan(a.pitch);
    const b = m.pose();
    const before = writes.mock.calls.length;
    m.fc().lookAim(JOG_DEAD_PX, 0);
    m.run(20);
    expect(m.pose()).toEqual(b);
    expect(writes.mock.calls.length).toBe(before);
    expect(m.fc().live()).toBe(true);
  });

  it('the scene\'s lookMax tops the speed: at 1, full reach turns at 45 deg/s', () => {
    const m = mount({ ...freeSceneOf(), lookMax: 1 });
    m.lookFor(JOG_FULL_PX, 0, 25, 10);
    expect(m.pose().yaw / DEG).toBeCloseTo(45 * 0.25, 6);
  });

  it('lookAim and lookStop with no Look running do nothing; a second start, a jog under a Look and a Look under a jog are refused', () => {
    const m = mount();
    const p0 = m.pose();
    m.fc().lookAim(JOG_FULL_PX, 0);
    m.run(5);
    expect(m.fc().live()).toBe(false);
    expect(m.stop()).toBeNull();
    expect(m.fc().lookStart()).toBe(true);
    expect(m.fc().lookStart()).toBe(false);
    expect(m.fc().jogStart()).toBe(false);
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(10);
    expect(m.pose()).toEqual(p0);
    m.stop();
    expect(m.fc().jogStart()).toBe(true);
    expect(m.fc().lookStart()).toBe(false);
    m.fc().lookAim(JOG_FULL_PX, 0);
    m.fc().jogAim(JOG_FULL_PX, 0);
    m.run(10);
    expect(m.pose().yaw).toBe(p0.yaw);
    expect(m.pose().x).toBeGreaterThan(p0.x);
    // the hat's jog running, a Look's stop stops nothing
    expect(m.stop()).toBeNull();
    expect(m.fc().live()).toBe(true);
    m.stop('jogStop');
    // a finger on the scene owns it
    act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 200 }, { x: 400, y: 200 }));
    expect(m.fc().lookStart()).toBe(false);
  });
});

describe('(b) held against a limit', () => {
  it('right for 10 s: shown stays short of hard, finite, never back toward straight; committed rests at soft; reversing moves the view within one frame', () => {
    const m = mount();
    const cone = coneAt(m.ref.current, m.pose());
    let last = 0;
    m.lookFor(JOG_FULL_PX, 0, 625, 16, () => {
      const yaw = m.pose().yaw;
      expect(Number.isFinite(yaw)).toBe(true);
      expect(yaw).toBeGreaterThanOrEqual(last);
      expect(yaw).toBeLessThan(cone.hard);
      last = yaw;
    });
    expect(last).toBeGreaterThan(cone.soft);
    // the band shows a turn asked for no further than the hard limit: soft + (hard - soft)(1 - 1/e)
    expect(last).toBeCloseTo(cone.soft + (cone.hard - cone.soft) * (1 - Math.exp(-1)), 9);
    m.fc().lookAim(-JOG_FULL_PX, 0);
    m.run(1);
    expect(m.pose().yaw).toBeLessThan(last - 0.5 * DEG);
    // and round to the other limit: 10 s there too
    let low = m.pose().yaw;
    m.run(625, 16, () => {
      const yaw = m.pose().yaw;
      expect(Number.isFinite(yaw)).toBe(true);
      expect(yaw).toBeLessThanOrEqual(low);
      expect(yaw).toBeGreaterThan(-cone.hard);
      low = yaw;
    });
    expect(low).toBeLessThan(-cone.soft);
    m.fc().lookAim(JOG_FULL_PX, 0);
    m.run(1);
    expect(m.pose().yaw).toBeGreaterThan(low + 0.5 * DEG);
  });

  it('up and down for 10 s each: the pitch stays short of its hard limits, and the first frame back moves it', () => {
    const m = mount();
    let top = 0;
    m.lookFor(0, -JOG_FULL_PX, 625, 16, () => {
      const pitch = m.pose().pitch;
      expect(pitch).toBeLessThanOrEqual(top);
      expect(pitch).toBeGreaterThan(-PITCH.upHard);
      top = pitch;
    });
    expect(top).toBeLessThan(-PITCH.upSoft);
    m.fc().lookAim(0, JOG_FULL_PX);
    m.run(1);
    expect(m.pose().pitch).toBeGreaterThan(top + 0.5 * DEG);
    let low = m.pose().pitch;
    m.run(625, 16, () => {
      const pitch = m.pose().pitch;
      expect(pitch).toBeGreaterThanOrEqual(low);
      expect(pitch).toBeLessThan(PITCH.downHard);
      low = pitch;
    });
    expect(low).toBeGreaterThan(PITCH.downSoft);
    expect(m.pose().yaw).toBe(0);
  });

  /**
   * A wall under the Classic cap, the Look held right 2 s at `inMm` in from the framing (its view at rest in the band),
   * then the depth pulled back at full rate: the cap closes in on the view as the eye backs away.
   */
  const narrowing = (inMm: number) => {
    const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
    const at = { ...poseOf(scene.base), z: poseOf(scene.base).z - inMm };
    const begun = coneAt(scene, at);
    const m = mount(scene);
    m.fc().hold(at);
    m.lookFor(JOG_FULL_PX, 0, 125);
    expect(m.pose().yaw).toBeCloseTo(begun.soft + (begun.hard - begun.soft) * (1 - Math.exp(-1)), 9);
    expect(m.fc().depthStart(-1)).toBe(true);
    /** The hard limit a Look has where the eye is now: the realism cone's there, no nearer than where the turn rests. */
    const hardHere = () => Math.max(coneOf(withPose(scene.base, { ...m.pose(), yaw: 0 }), scene.wall, scene.fronts).hard, begun.soft);
    return { m, begun, hardHere };
  };

  it('against a cone that narrows (the depth backs the eye away under the Classic cap): the view is never past the hard limit of where the eye is, and never moves against the thumb by more than that limit closed in', () => {
    for (const inMm of [400, 0, -500]) {
      const { m, begun, hardHere } = narrowing(inMm);
      let last = m.pose();
      let hard = hardHere();
      let closed = 0;
      m.run(60, 16, () => {
        const p = m.pose();
        const here = hardHere();
        expect(p.yaw).toBeLessThanOrEqual(here + 1e-12);
        expect(last.yaw - p.yaw).toBeLessThanOrEqual(hard - here + 1e-12);
        closed += hard - here;
        last = p;
        hard = here;
      });
      // the cap did close in on it, down to where the turn rests
      expect(closed).toBeGreaterThan(1 * DEG);
      expect(last.z).toBeGreaterThan(poseOf(m.ref.current.base).z - inMm + 200);
      expect(last.yaw).toBeGreaterThanOrEqual(begun.soft);
      m.stop('depthStop');
      expect(m.stop()!.yaw).toBe(begun.soft);
    }
  });

  it('no windup against a cone that narrowed: the depth let go after 3, 9, 15, 16 or 22 frames, the first frame of the thumb reversed moves the view', () => {
    for (const frames of [3, 9, 15, 16, 22]) {
      const { m, hardHere } = narrowing(400);
      m.run(frames);
      m.fc().depthRate(0);
      m.run(1);
      const rest = m.pose().yaw;
      expect(rest).toBeLessThanOrEqual(hardHere() + 1e-12);
      m.fc().lookAim(-JOG_FULL_PX, 0);
      m.run(1);
      expect(m.pose().yaw).toBeLessThan(rest - 0.5 * DEG);
    }
  });

  it('between two workings-out of the cone the view follows a cap that closes in, with no cone worked out for it (no projection, nothing published)', () => {
    const { m } = narrowing(400);
    const host = m.dom.hostEl;
    // the depth's first frame only starts its clock; the first frame the eye moves works the cone out
    m.run(1);
    host.removeAttribute('data-yaw-budget');
    m.run(1);
    expect(host.hasAttribute('data-yaw-budget')).toBe(true);
    host.removeAttribute('data-yaw-budget');
    const before = m.pose().yaw;
    m.run(5);
    // five frames on, the view has followed the cap in with no cone worked out
    expect(m.pose().yaw).toBeLessThan(before - 0.5 * DEG);
    expect(host.hasAttribute('data-yaw-budget')).toBe(false);
  });

  it('the soft limit ticks once a crossing: held past it, and wobbling within a degree of it, no second tick; back a degree inside and out again, one more', () => {
    const m = mount();
    const cone = coneAt(m.ref.current, m.pose());
    m.lookFor(JOG_FULL_PX, 0, 60);
    expect(m.pose().yaw).toBeGreaterThan(cone.soft);
    expect(ticks).toHaveBeenCalledTimes(1);
    m.run(60);
    expect(ticks).toHaveBeenCalledTimes(1);
    /** Hold the thumb at half reach, left or right, until `done`. */
    const until = (dx: number, done: () => boolean) => {
      m.fc().lookAim(dx, 0);
      for (let i = 0; i < 400 && !done(); i++) m.run(1);
      expect(done()).toBe(true);
    };
    // back to within half a degree inside the limit (a frame turns 0.19 deg), then out past it again: the same crossing
    until(-HALF_PX, () => m.pose().yaw < cone.soft - 0.5 * DEG);
    expect(m.pose().yaw).toBeGreaterThan(cone.soft - 0.8 * DEG);
    until(HALF_PX, () => m.pose().yaw > cone.soft);
    expect(ticks).toHaveBeenCalledTimes(1);
    // back more than a degree inside: the next crossing ticks
    until(-HALF_PX, () => m.pose().yaw < cone.soft - 1.2 * DEG);
    until(HALF_PX, () => m.pose().yaw > cone.soft);
    expect(ticks).toHaveBeenCalledTimes(2);
  });
});

describe('(c) let go past the soft limit, the turn eases back to it in SPRING_MS', () => {
  const pastSoft = (scene?: FreeScene) => {
    const m = mount(scene);
    const cone = coneAt(m.ref.current, m.pose());
    m.lookFor(JOG_FULL_PX, 0, 125);
    const shown = m.pose().yaw;
    expect(shown).toBeGreaterThan(cone.soft + 5 * DEG);
    return { m, cone, shown };
  };

  it('the lift returns and holds the committed pose (at soft); the view eases from where it was shown and rests there 200 ms on', () => {
    const { m, cone, shown } = pastSoft();
    const renders = m.renders();
    const left = m.stop();
    expect(left!.yaw).toBe(cone.soft);
    expect(m.fc().held()).toEqual(left);
    expect(m.dom.hostEl.dataset.gesture).toBeUndefined();
    expect(m.renders()).toBe(renders + 2);
    // no jump at the lift
    expect(m.fc().live()).toBe(true);
    expect(m.pose().yaw).toBeCloseTo(shown, 12);
    m.frames.tick(100);
    expect(m.pose().yaw).toBeCloseTo(springBack(shown, cone.soft, 100), 12);
    expect(m.pose().yaw).toBeGreaterThan(cone.soft);
    m.frames.tick(84);
    expect(m.pose().yaw).toBeGreaterThan(cone.soft);
    expect(m.fc().live()).toBe(true);
    m.frames.tick(SPRING_MS - 184);
    expect(m.pose().yaw).toBe(cone.soft);
    expect(m.fc().live()).toBe(false);
    expect(m.frames.pending()).toBe(0);
    expect(JSON.parse(m.dom.hostEl.dataset.camera!).yaw).toBeCloseTo(cone.soft, 6);
    // three frames' writes, and at its rest the ease's own render
    expect(m.renders()).toBe(renders + 2 + 3 + 1);
  });

  it('under reduced motion it is there at once', () => {
    const { m, cone } = pastSoft({ ...freeSceneOf(), reducedMotion: true });
    const left = m.stop();
    expect(left!.yaw).toBe(cone.soft);
    expect(m.pose().yaw).toBe(cone.soft);
    expect(m.fc().live()).toBe(false);
    expect(JSON.parse(m.dom.hostEl.dataset.camera!).yaw).toBeCloseTo(cone.soft, 6);
  });

  it('the pitch eases back too (let go looking up past its soft limit)', () => {
    const m = mount();
    m.lookFor(0, -JOG_FULL_PX, 125);
    expect(m.pose().pitch).toBeLessThan(-PITCH.upSoft);
    expect(m.stop()!.pitch).toBe(-PITCH.upSoft);
    expect(m.fc().live()).toBe(true);
    m.frames.tick(SPRING_MS);
    expect(m.pose().pitch).toBe(-PITCH.upSoft);
  });

  it('blur stops a Look where it is: the committed pose held, the ease back run, and the lift that comes later gets that pose once', () => {
    const { m, cone, shown } = pastSoft();
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(m.fc().held()!.yaw).toBe(cone.soft);
    expect(m.pose().yaw).toBeCloseTo(shown, 12);
    expect(m.dom.hostEl.dataset.gesture).toBeUndefined();
    // the lift mid-ease: the eye rests where the halt held it
    m.frames.tick(50);
    expect(m.stop()).toEqual(m.fc().held());
    expect(m.stop()).toBeNull();
    m.frames.tick(SPRING_MS);
    expect(m.pose().yaw).toBe(cone.soft);
    m.run(20);
    expect(m.pose().yaw).toBe(cone.soft);
  });
});

describe('(d) Look and depth together', () => {
  it('z advances along the heading the Look has turned to, frame by frame; the first stop returns nothing, the last the pose', () => {
    const m = mount();
    const p0 = m.pose();
    expect(m.fc().depthStart(0.4)).toBe(true);
    expect(m.dom.hostEl.dataset.gesture).toBe('depth');
    expect(m.fc().lookStart()).toBe(true);
    expect(m.dom.hostEl.dataset.gesture).toBe('jog-look');
    m.fc().lookAim(HALF_PX, 0);
    m.run(1);
    let prev = m.pose();
    let before = writes.mock.calls.length;
    m.run(60, 16, () => {
      const p = m.pose();
      // one write a frame, the turn and the dolly together
      expect(writes.mock.calls.length).toBe(before + 1);
      before = writes.mock.calls.length;
      expect(p.yaw).toBeGreaterThan(prev.yaw);
      // the step is along this frame's heading: (sin yaw, 0, -cos yaw)
      expect(Math.atan2(p.x - prev.x, -(p.z - prev.z))).toBeCloseTo(p.yaw, 9);
      expect(p.y).toBe(p0.y);
      prev = p;
    });
    expect(prev.yaw).toBeGreaterThan(10 * DEG);
    expect(prev.z).toBeLessThan(p0.z - 100);
    expect(prev.x).toBeGreaterThan(p0.x + 10);
    // the depth lets go first: the Look goes on turning, the eye where the dolly left it
    expect(m.stop('depthStop')).toBeNull();
    expect(m.dom.hostEl.dataset.gesture).toBe('jog-look');
    m.run(5);
    expect(m.pose().yaw).toBeGreaterThan(prev.yaw);
    expect([m.pose().x, m.pose().z]).toEqual([prev.x, prev.z]);
    const left = m.stop();
    expect(left).toEqual(m.pose());
    expect(m.fc().live()).toBe(false);
  });

  it('the Look lets go first, past its soft limit: it eases back while the depth goes on, and the depth\'s stop returns the pose', () => {
    const m = mount();
    const cone = coneAt(m.ref.current, m.pose());
    m.lookFor(JOG_FULL_PX, 0, 125);
    expect(m.fc().depthStart(0.3)).toBe(true);
    expect(m.dom.hostEl.dataset.gesture).toBe('jog-look');
    m.run(2);
    const shown = m.pose();
    expect(shown.yaw).toBeGreaterThan(cone.soft);
    expect(m.stop()).toBeNull();
    expect(m.dom.hostEl.dataset.gesture).toBe('depth');
    // no jump: the same view, then easing as the eye moves on
    expect(m.pose().yaw).toBe(shown.yaw);
    let last = shown;
    m.run(12, 16, () => {
      const p = m.pose();
      expect(p.yaw).toBeLessThan(last.yaw);
      expect(p.yaw).toBeGreaterThan(cone.soft);
      expect(p.z).not.toBe(last.z);
      last = p;
    });
    m.run(1);
    expect(m.pose().yaw).toBe(cone.soft);
    const left = m.stop('depthStop');
    expect(left).toEqual(m.pose());
    expect(left!.yaw).toBe(cone.soft);
    expect(m.fc().live()).toBe(false);
  });

  it('the cone is rebased where the depth takes the eye: on a wall under the Classic cap, the turn rests at the limit of the place it has reached, not of where it began', () => {
    const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
    const far = { ...poseOf(scene.base), z: poseOf(scene.base).z + 1500 };
    const begun = coneAt(scene, far);
    const m = mount(scene);
    m.fc().hold(far);
    m.lookFor(JOG_FULL_PX, 0, 60);
    // against the cap out there: no further than it, and no band past it
    expect(m.pose().yaw).toBe(begun.soft);
    expect(m.fc().depthStart(1)).toBe(true);
    m.run(90);
    expect(m.pose().z).toBeLessThan(far.z - 1000);
    m.stop('depthStop');
    m.run(125);
    const left = m.stop()!;
    const here = coneAt(scene, { ...left, yaw: 0 });
    expect(here.soft).toBeGreaterThan(begun.soft + 2 * DEG);
    expect(left.yaw).toBe(here.soft);
    // and the band is the new place's: held 2 s, shown stood at soft + (hard - soft)(1 - 1/e) of it
    m.frames.tick(SPRING_MS);
    m.lookFor(JOG_FULL_PX, 0, 125);
    expect(m.pose().yaw).toBeCloseTo(here.soft + (here.hard - here.soft) * (1 - Math.exp(-1)), 9);
  });

  it('while the eye moves the cone is worked out at most every LOOK_REBASE_MS, and once more when it rests; the view never jumps for it', () => {
    const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
    const m = mount(scene);
    const host = m.dom.hostEl;
    m.lookFor(JOG_FULL_PX, 0, 125);
    m.fc().depthStart(0.4);
    m.run(1);
    /** Frames run with the cone's publication watched: how many frames worked a cone out. */
    const cones = (n: number, each?: () => void) => {
      let count = 0;
      for (let i = 0; i < n; i++) {
        host.removeAttribute('data-yaw-budget');
        m.run(1);
        if (host.hasAttribute('data-yaw-budget')) count++;
        each?.();
      }
      return count;
    };
    let last = m.pose();
    const frames = 5 * Math.ceil(LOOK_REBASE_MS / 16);
    const worked = cones(frames, () => {
      const p = m.pose();
      expect(p.z).toBeLessThan(last.z);
      // held against the limit as the cap opens with the approach: the view follows it out, under a frame's turn
      expect(Math.abs(p.yaw - last.yaw)).toBeLessThan(1 * DEG);
      last = p;
    });
    // the first frame the eye moved, then one every 13 frames (208 ms)
    expect(worked).toBe(5);
    // the rocker back in its dead zone: the eye rests, and the cone is worked out for where it stands, once
    m.fc().depthRate(0);
    expect(cones(1)).toBe(1);
    expect(cones(60)).toBe(0);
    const here = coneAt(scene, { ...m.pose(), yaw: 0 });
    expect(m.pose().yaw).toBeCloseTo(here.soft + (here.hard - here.soft) * (1 - Math.exp(-1)), 9);
    m.stop('depthStop');
    expect(m.stop()!.yaw).toBe(here.soft);
  });

  it('the dolly\'s cost is trusted only at the same aim: every frame the Look turned the eye, the next dolly is handed none', () => {
    const m = mount(freeSceneOf({ figures: 120 }));
    m.fc().depthStart(1);
    m.run(4);
    // the depth alone: the cost carried from frame to frame
    expect(dollyStep.mock.calls.at(-1)![4]).toBeTypeOf('number');
    m.fc().lookStart();
    m.fc().lookAim(HALF_PX, 0);
    m.run(1);
    dollyStep.mockClear();
    m.run(6);
    expect(dollyStep.mock.calls.length).toBe(6);
    for (const call of dollyStep.mock.calls) expect(call[4]).toBeUndefined();
    // the thumb back in its dead zone: the aim stands, and the cost is carried again
    m.fc().lookAim(0, 0);
    m.run(1);
    dollyStep.mockClear();
    m.run(3);
    expect(dollyStep.mock.calls.length).toBe(3);
    for (const call of dollyStep.mock.calls) expect(call[4]).toBeTypeOf('number');
  });
});

describe('(e) a side the GPU budget tightened caps the hat\'s Look where it caps a scene Look', () => {
  /** 622 figures on a screen small enough that, 400 mm in, a turn either way passes the ceiling within ten degrees. */
  const tight = () => {
    const scene = freeSceneOf({ figures: 622, viewportPx: 120_000 });
    const at = { ...poseOf(scene.base), z: poseOf(scene.base).z - 400 };
    const m = mount(scene);
    m.fc().hold(at);
    return { m, scene, at };
  };
  const published = (m: ReturnType<typeof mount>) => {
    const { ms: _ms, ...rest } = JSON.parse(m.dom.hostEl.dataset.yawBudget!) as { ms: number; left: { fit: number | null }; right: { fit: number | null } };
    return rest;
  };

  it('the same cone (coneFrom): the budget published is a scene Look\'s, the committed yaw rests where its does, and shown never reaches the budget\'s hard limit', () => {
    const byScene = tight();
    byScene.m.sceneLook(-400);
    const sceneBudget = published(byScene.m);
    let sceneLeft: Pose | null = null;
    act(() => {
      sceneLeft = byScene.m.fc().release(1, true);
    });
    const cone = coneAt(byScene.scene, byScene.at);
    // the budget moved both sides in, each to its own fit, inside the realism cone
    expect(cone.right!.hard).toBeLessThan(cone.hard - 20 * DEG);
    expect(cone.left!.hard).toBeLessThan(cone.hard - 20 * DEG);
    expect(cone.right!.hard).not.toBe(cone.left!.hard);

    for (const [dx, side] of [[JOG_FULL_PX, cone.right!], [-JOG_FULL_PX, cone.left!]] as const) {
      const hat = tight();
      const sign = Math.sign(dx);
      let worst = 0;
      hat.m.lookFor(dx, 0, 625, 16, () => (worst = Math.max(worst, sign * hat.m.pose().yaw)));
      expect(published(hat.m)).toEqual(sceneBudget);
      expect(worst).toBeLessThan(side.hard);
      expect(worst).toBeCloseTo(side.soft + (side.hard - side.soft) * (1 - Math.exp(-1)), 9);
      const left = hat.m.stop()!;
      expect(sign * left.yaw).toBe(side.soft);
      if (sign > 0) expect(left.yaw).toBe(sceneLeft!.yaw);
    }
    // the realism cone alone would have let the same hold far past it
    const loose = mount(freeSceneOf({ figures: 622 }));
    loose.fc().hold(byScene.at);
    loose.lookFor(JOG_FULL_PX, 0, 625);
    expect(loose.pose().yaw).toBeGreaterThan(cone.right!.hard + 20 * DEG);
  });
});

describe('(g) no roll', () => {
  it('through a diagonal Look with the depth, its ease back and its rest, the pose drawn, held and published is x, y, z, yaw and pitch alone', () => {
    const m = mount();
    const keys = ['pitch', 'x', 'y', 'yaw', 'z'];
    const published = ['focalPx', 'height', 'pitch', 'width', 'x', 'y', 'yaw', 'z'];
    const check = () => {
      expect(Object.keys(m.pose()).sort()).toEqual(keys);
      expect(Object.keys(JSON.parse(m.dom.hostEl.dataset.camera!)).sort()).toEqual(published);
      expect(m.dom.rootEl.style.transform).not.toMatch(/rotateZ|rotate\(|rotate3d/);
    };
    m.fc().depthStart(0.5);
    m.lookFor(JOG_FULL_PX, -JOG_FULL_PX, 200, 16, check);
    m.stop('depthStop');
    const left = m.stop()!;
    expect(Object.keys(left).sort()).toEqual(keys);
    expect(Object.keys(m.fc().held()!).sort()).toEqual(keys);
    m.run(20, 16, check);
  });
});

describe('(h) a drive or a drag begun while a look eases back never makes the view jump', () => {
  /** A scene Look let go far past its soft limit, `ms` into its ease back: the hook, where it rests and where it is drawn. */
  const easing = (ms: number, scene?: FreeScene) => {
    const m = mount(scene);
    m.sceneLook(860);
    let rest: Pose | null = null;
    act(() => {
      rest = m.fc().release(1, true);
    });
    m.frames.tick(ms);
    const mid = m.pose();
    expect(mid.yaw).toBeLessThan(rest!.yaw - 1 * DEG);
    return { m, rest: rest!, mid };
  };

  it('the depth pushed 48 ms after the lift: the view stays where it is drawn, goes on easing as the eye moves, and rests at the soft limit', () => {
    const { m, rest, mid } = easing(48);
    const before = writes.mock.calls.length;
    expect(m.fc().depthStart(1)).toBe(true);
    // no jump, and nothing written for the start
    expect(m.pose()).toEqual(mid);
    expect(writes.mock.calls.length).toBe(before);
    let last = mid;
    m.run(9, 16, () => {
      const p = m.pose();
      // toward its rest, never past it, a little a frame
      expect(p.yaw).toBeGreaterThan(last.yaw);
      expect(p.yaw).toBeLessThan(rest.yaw);
      expect(p.yaw - last.yaw).toBeLessThan(0.45 * (rest.yaw - mid.yaw));
      last = p;
    });
    expect(m.pose().z).toBeLessThan(mid.z);
    m.run(1);
    expect(m.pose().yaw).toBe(rest.yaw);
    m.run(10);
    expect(m.pose().yaw).toBe(rest.yaw);
    // the dolly went along the heading at rest all the while
    const p = m.pose();
    expect(Math.atan2(p.x - mid.x, -(p.z - mid.z))).toBeCloseTo(rest.yaw, 6);
    expect(m.stop('depthStop')).toEqual(p);
  });

  it('the jog started mid-ease: the same; let go before the ease is over, the ease runs on to its rest where the jog left the eye', () => {
    const { m, rest, mid } = easing(48);
    expect(m.fc().jogStart()).toBe(true);
    expect(m.pose()).toEqual(mid);
    m.fc().jogAim(0, -JOG_FULL_PX);
    m.run(1);
    m.run(4);
    const p = m.pose();
    expect(p.y).toBeGreaterThan(mid.y);
    expect(p.yaw).toBeGreaterThan(mid.yaw);
    expect(p.yaw).toBeLessThan(rest.yaw);
    const left = m.stop('jogStop')!;
    expect(left.yaw).toBe(rest.yaw);
    expect(left.y).toBe(p.y);
    // no jump at the lift either
    expect(m.pose().yaw).toBeCloseTo(p.yaw, 3);
    expect(m.pose().y).toBe(p.y);
    expect(m.fc().live()).toBe(true);
    m.frames.tick(SPRING_MS);
    expect(m.pose()).toEqual(left);
    expect(m.fc().live()).toBe(false);
  });

  it('the hat\'s Look started mid-ease takes it over where it is drawn: back, it turns from there at once; held out, it goes on from there; no tick for the crossing it took over', () => {
    for (const dx of [-JOG_FULL_PX, JOG_FULL_PX]) {
      const { m, rest, mid } = easing(48);
      ticks.mockClear();
      expect(mid.yaw).toBeLessThan(rest.yaw);
      expect(m.fc().lookStart()).toBe(true);
      expect(m.pose().yaw).toBeCloseTo(mid.yaw, 12);
      m.fc().lookAim(dx, 0);
      m.run(1);
      // its first frame draws what was drawn (the ease is the Look's now: it does not run on)
      expect(m.pose().yaw).toBeCloseTo(mid.yaw, 9);
      m.run(1);
      if (dx > 0) expect(m.pose().yaw).toBeGreaterThan(mid.yaw + 0.3 * DEG);
      else expect(m.pose().yaw).toBeLessThan(mid.yaw - 0.3 * DEG);
      expect(ticks).not.toHaveBeenCalled();
      expect(m.stop()!.yaw).toBe(rest.yaw);
    }
  });

  /**
   * The hat's Look takes over a scene Look's ease deep in its band (a right drag to x = 3000 let go `ms` before), its
   * thumb held out (the side the view is on) or at its centre; then the depth moves the eye `frames` frames at `r` and
   * rests. Per frame: how far the view moved against the thumb (in, toward straight), how far the hard limit where the
   * eye is (the realism cone's, no nearer than the soft limit a turn rests at) closed in that frame, and how far the view
   * stands past it.
   */
  const takeOver = (scene: FreeScene, ms: number, out: 0 | 1, r: number, frames: number) => {
    const m = mount(scene);
    const begun = coneAt(scene, m.pose());
    m.sceneLook(3000);
    act(() => {
      m.fc().release(1, true);
    });
    m.frames.tick(ms);
    const mid = m.pose();
    const s = Math.sign(mid.yaw);
    const side = (s > 0 ? begun.right : begun.left) ?? begun;
    const hardHere = () => Math.max(coneOf(withPose(scene.base, { ...m.pose(), yaw: 0 }), scene.wall, scene.fronts).hard, side.soft);
    expect(m.fc().lookStart()).toBe(true);
    m.fc().lookAim(out * s * JOG_FULL_PX, 0);
    const rows: { against: number; closed: number; past: number }[] = [];
    let last = m.pose();
    let hard = hardHere();
    const frame = () => {
      m.run(1);
      const p = m.pose();
      const here = hardHere();
      rows.push({ against: s * (last.yaw - p.yaw), closed: hard - here, past: s * p.yaw - here });
      last = p;
      hard = here;
    };
    for (let i = 0; i < 3; i++) frame();
    expect(m.fc().depthStart(r)).toBe(true);
    for (let i = 0; i < frames; i++) frame();
    m.fc().depthRate(0);
    for (let i = 0; i < 4; i++) frame();
    return { m, s, rows, deep: (s * mid.yaw - side.soft) / (side.hard - side.soft) };
  };

  it('the hat\'s Look takes over an ease deep in its band, then the depth moves: on a wall where nothing closes in, the view never moves against the thumb, held out or at its centre, at any working-out of the cone', () => {
    for (const ms of [0, 8, 16]) {
      for (const out of [0, 1] as const) {
        // 20 frames: the 200 ms working-out while the eye moves; 2: the one once it rests
        for (const frames of [20, 2]) {
          const { rows, deep } = takeOver(freeSceneOf(), ms, out, 1, frames);
          if (ms === 0) expect(deep).toBeGreaterThan(0.9);
          for (const row of rows) {
            expect(row.closed).toBe(0);
            expect(row.past).toBeLessThan(0);
            expect(row.against).toBeLessThanOrEqual(1e-12);
          }
        }
      }
    }
  });

  it('the same on a wall under the Classic cap, the depth backing the eye away: the view is never past the hard limit where the eye is, never moves against the thumb by more than that limit closed in that frame, and the first frame back moves it', () => {
    for (const ms of [0, 8]) {
      for (const out of [0, 1] as const) {
        const scene = freeSceneOf({ wall: LONG_WALL, focus: 20 });
        const { m, s, rows, deep } = takeOver(scene, ms, out, -1, 60);
        if (ms === 0) expect(deep).toBeGreaterThan(0.9);
        let closed = 0;
        for (const row of rows) {
          expect(row.past).toBeLessThan(0);
          expect(row.against).toBeLessThanOrEqual(Math.max(0, row.closed) + 1e-12);
          closed += row.closed;
        }
        // the cap did close in, past where the view was taken over
        expect(closed).toBeGreaterThan(1 * DEG);
        const at = m.pose();
        m.fc().lookAim(-s * JOG_FULL_PX, 0);
        m.run(1);
        expect(s * (at.yaw - m.pose().yaw)).toBeGreaterThan(0.01 * DEG);
      }
    }
  });

  it('a MOVE drag begun mid-ease: the view stays where it is drawn and eases on to its rest under the drag; lifted mid-ease it still rests; cancelled, it goes back at once', () => {
    const { m, rest, mid } = easing(48);
    act(() => m.fc().press({ pointerId: 2, clientX: 400, clientY: 200 }, { x: 400, y: 200 }));
    act(() => m.fc().drag(2, { x: 400, y: 215 }, 'y'));
    expect(m.pose().yaw).toBeCloseTo(mid.yaw, 12);
    expect(m.pose().y).toBeGreaterThan(mid.y);
    m.frames.tick(32);
    const p = m.pose();
    expect(p.yaw).toBeGreaterThan(mid.yaw);
    expect(p.yaw).toBeLessThan(rest.yaw);
    // the ease over, the drag goes on: the eye where the drag has it (the held pose is not written over it), no frame asked
    m.frames.tick(SPRING_MS);
    expect(m.pose().yaw).toBe(rest.yaw);
    expect(m.pose().y).toBe(p.y);
    expect(JSON.parse(m.dom.hostEl.dataset.camera!).y).toBeCloseTo(p.y, 6);
    expect(m.frames.pending()).toBe(0);
    act(() => m.fc().drag(2, { x: 400, y: 230 }, 'y'));
    expect(m.pose().y).toBeGreaterThan(p.y);
    expect(m.pose().yaw).toBe(rest.yaw);
    act(() => void m.fc().release(2, true));
    expect(m.fc().live()).toBe(false);

    const lifted = easing(48);
    act(() => lifted.m.fc().press({ pointerId: 2, clientX: 400, clientY: 200 }, { x: 400, y: 200 }));
    act(() => lifted.m.fc().drag(2, { x: 400, y: 215 }, 'y'));
    let left: Pose | null = null;
    act(() => {
      left = lifted.m.fc().release(2, true);
    });
    expect(left!.yaw).toBe(lifted.rest.yaw);
    expect(lifted.m.pose().yaw).toBeCloseTo(lifted.mid.yaw, 12);
    expect(lifted.m.fc().live()).toBe(true);
    lifted.m.frames.tick(SPRING_MS);
    expect(lifted.m.pose()).toEqual(left);
    expect(lifted.m.fc().live()).toBe(false);

    const cancelled = easing(48);
    act(() => cancelled.m.fc().press({ pointerId: 2, clientX: 400, clientY: 200 }, { x: 400, y: 200 }));
    act(() => cancelled.m.fc().drag(2, { x: 400, y: 215 }, 'y'));
    act(() => void cancelled.m.fc().release(2, false));
    expect(cancelled.m.pose()).toEqual(cancelled.rest);
    expect(cancelled.m.fc().live()).toBe(false);
  });

  it('a scene Look begun mid-ease takes it over where it is drawn: its first move turns from there, by the finger\'s angle', () => {
    const { m, rest, mid } = easing(16);
    ticks.mockClear();
    act(() => m.fc().press({ pointerId: 3, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    // a hair of a drag (1 px: about 0.07 deg): the view is where the ease had got, not back at its rest
    act(() => m.fc().drag(3, { x: 399, y: 200 }, 'x'));
    expect(m.pose().yaw).toBeGreaterThan(mid.yaw);
    expect(m.pose().yaw).toBeLessThan(mid.yaw + 0.2 * DEG);
    expect(mid.yaw).toBeLessThan(rest.yaw - 1 * DEG);
    // one tick: the first Look move's (rulings S6); none for the crossing it took over
    expect(ticks).toHaveBeenCalledTimes(1);
    // dragged back inside the soft limit, the committed pose follows the finger again
    act(() => m.fc().drag(3, { x: 100, y: 200 }, 'x'));
    let left: Pose | null = null;
    act(() => {
      left = m.fc().release(3, true);
    });
    expect(left!.yaw).toBeGreaterThan(rest.yaw + 5 * DEG);
    expect(left!.yaw).toBeLessThan(0);
    expect(m.pose()).toEqual(left);
  });

  it('pressed mid-ease and dragged after it has come to rest, a Look starts from the rest: never back out where the press saw it', () => {
    const { m, rest } = easing(48);
    act(() => m.fc().press({ pointerId: 3, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    m.frames.tick(SPRING_MS);
    expect(m.pose().yaw).toBe(rest.yaw);
    act(() => m.fc().drag(3, { x: 400.5, y: 200 }, 'x'));
    expect(Math.abs(m.pose().yaw - rest.yaw)).toBeLessThan(0.1 * DEG);
    act(() => void m.fc().release(3, false));
  });

  it('pressed mid-ease, then Reset view (the framing held again) before the drag: the Look starts from the framing', () => {
    const { m } = easing(48);
    act(() => m.fc().press({ pointerId: 3, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    m.fc().hold(null);
    act(() => m.fc().drag(3, { x: 400.5, y: 200 }, 'x'));
    expect(Math.abs(m.pose().yaw)).toBeLessThan(0.1 * DEG);
    expect(m.pose().z).toBe(poseOf(m.ref.current.base).z);
    act(() => void m.fc().release(3, false));
  });
});
