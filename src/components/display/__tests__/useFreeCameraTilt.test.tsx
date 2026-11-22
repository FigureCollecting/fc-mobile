import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { JOG_FULL_PX, SPRING_MS, poseOf, springBack, withPose, type Pose } from '../casePose';
import { lookCone, useFreeCamera, type FreeScene } from '../useFreeCamera';
import { freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-LOGPOSE (nav rework U8), the engine: the tilt's offset is composed at output only (write() and camera()), never
// written into the held pose, a gesture's start, the drives or the spring; through the cone a Look from the pose at rest
// has; and folded into the held pose (the view kept as drawn) by Off, Recenter, a hidden page, and by any other start:
// a hat Look, a jog, the depth, a finger on the scene. Reset view and Go-to (hold) drop it. After any fold the source
// takes a new neutral (its next set is refused once), so nothing jumps.

vi.mock('../../../utils/haptics', () => ({ hapticLight: vi.fn() }));

const DEG = Math.PI / 180;

afterEach(() => vi.restoreAllMocks());

function mount(scene: FreeScene = freeSceneOf()) {
  const frames = handFrames(1000, true);
  const dom = freeDom();
  const ref = { current: scene };
  const hook = renderHook(() => useFreeCamera(ref, dom, { current: null }, () => {}));
  const fc = () => hook.result.current;
  /** What the scene shows now: its data-camera (null before any write). */
  const shown = (): Pose | null => {
    const d = dom.hostEl.dataset.camera;
    if (d === undefined) return null;
    const c = JSON.parse(d) as Pose;
    return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };
  };
  /** What the render would draw (camera()). */
  const drawn = (): Pose => poseOf(fc().camera(ref.current.base));
  const run = (n: number, ms = 16, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      frames.tick(ms);
      each?.();
    }
  };
  return { ref, dom, frames, fc, shown, drawn, run };
}

/** data-camera rounds to 1e-6: equal to it. */
const same = (a: Pose | null, b: Pose) => {
  expect(a).not.toBeNull();
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch'] as const) expect(a![k]).toBeCloseTo(b[k], 5);
};
const coneAt = (scene: FreeScene, pose: Pose) => lookCone(scene, pose, pose, () => {});

describe('(c) position-based: a fixed tilt held is a fixed offset, never a spin', () => {
  it('an offset of 2.4 deg (5 deg tipped, past the dead zone, at 0.6) held 2 s: the view stands 2.4 deg right, every frame the same; the held pose untouched', () => {
    const m = mount();
    const p0 = m.drawn();
    const off = 2.4 * DEG;
    expect(m.fc().tiltSet(off, 0)).toBe(true);
    same(m.shown(), { ...p0, yaw: p0.yaw + off });
    same(m.drawn(), { ...p0, yaw: p0.yaw + off });
    // composed at output only: nothing held, nothing live, nothing asked of the frames
    expect(m.fc().held()).toBeNull();
    expect(m.fc().live()).toBe(false);
    for (let i = 0; i < 125; i++) {
      expect(m.fc().tiltSet(off, 0)).toBe(true);
      m.run(1);
      same(m.shown(), { ...p0, yaw: p0.yaw + off });
    }
    expect(m.frames.pending()).toBe(0);
  });

  it('pitch: + is down as the pose\'s; the offset follows the source, back to 0 is back to the pose', () => {
    const m = mount();
    const p0 = m.drawn();
    m.fc().tiltSet(-1 * DEG, -3 * DEG);
    same(m.shown(), { ...p0, yaw: p0.yaw - 1 * DEG, pitch: p0.pitch - 3 * DEG });
    m.fc().tiltSet(0, 0);
    same(m.shown(), p0);
  });
});

describe('(d) Off and Recenter (fold) never snap', () => {
  it('fold: data-camera is unchanged on that frame and after; the held pose is the view drawn; the next set is refused (a new neutral)', () => {
    const m = mount();
    const p0 = m.drawn();
    m.fc().tiltSet(3 * DEG, 2 * DEG);
    const before = m.shown()!;
    const left = m.fc().tiltFold();
    same(m.shown(), before);
    same(m.fc().held()!, before);
    expect(left).toEqual(m.fc().held());
    m.run(20);
    same(m.shown(), before);
    same(m.drawn(), before);
    expect(m.fc().live()).toBe(false);
    // the source's next sample is refused once (it takes that orientation as its neutral), then applies on the new pose
    expect(m.fc().tiltSet(3 * DEG, 2 * DEG)).toBe(false);
    same(m.shown(), before);
    expect(m.fc().tiltSet(1 * DEG, 0)).toBe(true);
    same(m.shown(), { ...before, yaw: before.yaw + 1 * DEG });
    expect(p0.yaw).not.toBeCloseTo(before.yaw, 3);
  });

  it('fold with no offset: nothing moves, nothing is held, null returned; the next set is still a new neutral', () => {
    const m = mount();
    expect(m.fc().tiltFold()).toBeNull();
    expect(m.fc().held()).toBeNull();
    expect(m.fc().tiltSet(1 * DEG, 0)).toBe(false);
    expect(m.fc().tiltSet(1 * DEG, 0)).toBe(true);
  });
});

describe('(e) through the cone a Look has: past the soft limit, a rubber band short of hard', () => {
  it('a pose 1 deg inside the right soft limit and a 12 deg offset: shown past soft, short of hard; the fold eases back to soft', () => {
    const m = mount();
    const p0 = m.drawn();
    const cone = coneAt(m.ref.current, p0);
    const soft = cone.right?.soft ?? cone.soft;
    const hard = cone.right?.hard ?? cone.hard;
    const near: Pose = { ...p0, yaw: soft - 1 * DEG };
    act(() => m.fc().hold(near));
    m.fc().sync();
    m.fc().tiltSet(0, 0);
    expect(m.fc().tiltSet(12 * DEG, 0)).toBe(true);
    const yaw = m.shown()!.yaw;
    expect(yaw).toBeGreaterThan(soft);
    expect(yaw).toBeLessThan(hard);
    // folded past soft: the view stays this frame, then springs to soft over SPRING_MS (one rubber band)
    m.fc().tiltFold();
    expect(m.shown()!.yaw).toBeCloseTo(yaw, 6);
    expect(m.fc().held()!.yaw).toBeCloseTo(soft, 9);
    expect(m.fc().live()).toBe(true);
    m.run(1, 50);
    expect(m.shown()!.yaw).toBeCloseTo(springBack(yaw, soft, 50), 5);
    m.run(Math.ceil(SPRING_MS / 50), 50);
    expect(m.shown()!.yaw).toBeCloseTo(soft, 6);
    expect(m.fc().live()).toBe(false);
  });

  it('reduced motion: the same fold lands on soft at once', () => {
    const m = mount({ ...freeSceneOf(), reducedMotion: true });
    const p0 = m.drawn();
    const cone = coneAt(m.ref.current, p0);
    const soft = cone.right?.soft ?? cone.soft;
    act(() => m.fc().hold({ ...p0, yaw: soft - 1 * DEG }));
    m.fc().tiltSet(0, 0);
    m.fc().tiltSet(12 * DEG, 0);
    m.fc().tiltFold();
    expect(m.shown()!.yaw).toBeCloseTo(soft, 6);
    expect(m.fc().live()).toBe(false);
  });
});

describe('(g) any other start folds the offset first: one rubber band, never two', () => {
  it('a hat Look begun over an offset past soft: no jump at its first frame; held outward it never passes hard', () => {
    const m = mount();
    const p0 = m.drawn();
    const cone = coneAt(m.ref.current, p0);
    const soft = cone.right?.soft ?? cone.soft;
    const hard = cone.right?.hard ?? cone.hard;
    act(() => m.fc().hold({ ...p0, yaw: soft - 1 * DEG }));
    m.fc().tiltSet(0, 0);
    m.fc().tiltSet(12 * DEG, 0);
    const before = m.shown()!;
    expect(m.fc().lookStart()).toBe(true);
    m.fc().lookAim(JOG_FULL_PX, 0);
    m.run(1, 1);
    // its first frame: where the view was drawn (taken over, not added to)
    expect(Math.abs(m.shown()!.yaw - before.yaw)).toBeLessThan(0.2 * DEG);
    m.run(200, 16, () => expect(m.shown()!.yaw).toBeLessThan(hard));
    // the sensor has no say while the drive runs: refused, and its offset is not composed on top
    const at = m.shown()!;
    expect(m.fc().tiltSet(12 * DEG, 8 * DEG)).toBe(false);
    same(m.shown(), at);
    act(() => void m.fc().lookStop());
    m.run(Math.ceil(SPRING_MS / 16) + 2);
    expect(m.shown()!.yaw).toBeCloseTo(soft, 6);
  });

  it('a jog, the depth and a finger on the scene each fold it: their first frame draws what was drawn', () => {
    for (const start of ['jog', 'depth', 'press'] as const) {
      const m = mount();
      const p0 = m.drawn();
      m.fc().tiltSet(0, 0);
      m.fc().tiltSet(4 * DEG, -2 * DEG);
      const before = m.shown()!;
      const expected = { ...p0, yaw: p0.yaw + 4 * DEG, pitch: p0.pitch - 2 * DEG };
      same(before, expected);
      if (start === 'jog') expect(m.fc().jogStart()).toBe(true);
      else if (start === 'depth') expect(m.fc().depthStart(0)).toBe(true);
      else act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 200 }, { x: 400, y: 200 }));
      same(m.fc().held()!, before);
      m.run(3);
      same(m.shown(), before);
      same(m.drawn(), before);
      expect(m.fc().tiltSet(4 * DEG, -2 * DEG), start).toBe(false);
    }
  });

  it('a scene Look by the mouse over an offset turns from the view drawn, not from under it', () => {
    const m = mount();
    m.fc().tiltSet(0, 0);
    m.fc().tiltSet(5 * DEG, 0);
    const before = m.shown()!;
    act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 200, button: 2 }, { x: 400, y: 200 }));
    act(() => m.fc().drag(1, { x: 401, y: 200 }, 'x'));
    m.run(1);
    expect(Math.abs(m.shown()!.yaw - before.yaw)).toBeLessThan(0.5 * DEG);
  });
});

describe('hold (Reset view, Go-to, a new wall) drops the offset', () => {
  it('the pose held is drawn as it is, with no offset; the next set is a new neutral', () => {
    const m = mount();
    const p0 = m.drawn();
    m.fc().tiltSet(0, 0);
    m.fc().tiltSet(6 * DEG, 0);
    const target: Pose = { ...p0, x: p0.x + 100 };
    act(() => m.fc().hold(target));
    m.fc().sync();
    same(m.shown(), target);
    same(m.drawn(), target);
    expect(m.fc().tiltSet(6 * DEG, 0)).toBe(false);
  });
});

describe('the cone is worked out once per pose at rest, not each sample', () => {
  it('fifty samples on one pose: one cone (one yaw-budget publish)', () => {
    const m = mount();
    m.fc().tiltSet(0, 0);
    let publishes = 0;
    const host = m.dom.hostEl;
    const desc = Object.getOwnPropertyDescriptor(DOMStringMap.prototype, 'yawBudget');
    expect(desc).toBeUndefined();
    const real = host.dataset;
    const counted = new Proxy(real, {
      set(t, k, v) {
        if (k === 'yawBudget') publishes++;
        return Reflect.set(t, k, v);
      },
    });
    Object.defineProperty(host, 'dataset', { value: counted });
    for (let i = 1; i <= 50; i++) m.fc().tiltSet((i / 10) * DEG, 0);
    expect(publishes).toBe(1);
    const p = poseOf(withPose(m.ref.current.base, m.drawn()));
    expect(p.yaw).toBeCloseTo(m.drawn().yaw, 9);
  });
});
