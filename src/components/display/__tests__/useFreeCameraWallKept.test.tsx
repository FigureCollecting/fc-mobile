import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { frontShown } from '../caseCull';
import { JOG_FULL_PX, PITCH, SPRING_MS, poseOf, withPose, type Pose } from '../casePose';
import { useFreeCamera, type FreeScene } from '../useFreeCamera';
import { freeDom, freeSceneOf, handFrames } from './freeDrivesScene';

// NAV-EMPTY (Ross 11-22: at the room's top or bottom, after a "zoom away", "everything just becomes the backcolor/empty
// room until I switch to card view and back"): the Free camera's drives (the Z rail, the hat) and its Look never take
// the wall out of a frame that shows it. On 299682e the rail carried an eye at the room's top over the cabinets to the
// back wall, and a Look up from there (or down from the room's bottom) rested on the ceiling (or the floor).

vi.mock('../../../utils/haptics', () => ({ hapticLight: vi.fn() }));

const DEG = Math.PI / 180;
const DESKTOP = { width: 1536, height: 730 };
const FOLD_OPEN = { width: 870, height: 475 };
/** Where Ross's desktop stood at the room's top (DIAG, CHECK: y = ceiling - 50, the framing's depth of the 6-cabinet wall). */
const TOP = { y: 2388.4, z: 3639.8 };

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(scene: FreeScene) {
  const frames = handFrames(1000, true);
  const dom = freeDom();
  const ref = { current: scene };
  const hook = renderHook(() => useFreeCamera(ref, dom, { current: null }, () => {}));
  const fc = () => hook.result.current;
  const pose = (): Pose => poseOf(hook.result.current.camera(ref.current.base));
  /** Some cabinet's front is in the frame at all with the eye at `p`, were it only at the frame's edge. */
  const atEdge = (p: Pose = pose()): boolean => scene.wall.cabinets.some((slot) => frontShown({ camera: withPose(scene.base, p), panPx: 0 }, slot));
  /** The frame holds the wall with the eye at `p`: some cabinet's front reaches an eighth of the frame in (WALL_KEEP_FRAME). */
  const shows = (p: Pose = pose()): boolean => {
    const { width, height } = scene.base.frame;
    const middle = { x0: width / 8, x1: (width * 7) / 8, y0: height / 8, y1: (height * 7) / 8 };
    return scene.wall.cabinets.some((slot) => frontShown({ camera: withPose(scene.base, p), panPx: 0 }, slot, middle));
  };
  const run = (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      frames.tick(16);
      each?.();
    }
  };
  const at = (p: Partial<Pose>): Pose => {
    const to = { ...poseOf(scene.base), ...p };
    fc().hold(to);
    return to;
  };
  const stop = (which: 'lookStop' | 'depthStop' | 'jogStop'): Pose | null => {
    let left: Pose | null = null;
    act(() => {
      left = fc()[which]();
    });
    return left;
  };
  return { scene, frames, fc, pose, shows, atEdge, run, at, stop, unmount: hook.unmount };
}

/** 4 s of frames: longer than any drive here takes to reach where it stops. */
const HELD = 250;

describe.each([
  ['1536x730', DESKTOP],
  ['870x475', FOLD_OPEN],
])('NAV-EMPTY at %s: the Z rail never leaves the wall behind', (_name, frame) => {
  it('from the room\'s top (y 2388.4, z 3639.8, level) pushed forward 4 s: a front shows every frame, and the eye stops at the last place one does', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at(TOP);
    expect(m.shows()).toBe(true);
    // what the rail did before: over the cabinets' tops, where the frame holds the back wall and the ceiling alone
    expect(m.shows({ ...start, z: 0 })).toBe(false);
    expect(m.fc().depthStart(1)).toBe(true);
    m.run(HELD, () => expect(m.shows()).toBe(true));
    const end = m.stop('depthStop')!;
    expect(end.z).toBeLessThan(start.z - 1000);
    expect(end.z).toBeGreaterThan(0);
    expect([end.x, end.y, end.yaw, end.pitch]).toEqual([start.x, start.y, 0, 0]);
    // the last place: a few millimetres on, no front shows
    expect(m.shows({ ...end, z: end.z - 5 })).toBe(false);
    m.unmount();
  });

  it('stopped there, the rail still backs the eye away, and forward again stops at the same place', () => {
    const m = mount(freeSceneOf({ frame }));
    m.at(TOP);
    m.fc().depthStart(1);
    m.run(HELD);
    const stopped = m.stop('depthStop')!;
    m.fc().depthStart(-1);
    m.run(60, () => expect(m.shows()).toBe(true));
    const back = m.stop('depthStop')!;
    expect(back.z).toBeGreaterThan(stopped.z + 300);
    m.fc().depthStart(1);
    m.run(HELD, () => expect(m.shows()).toBe(true));
    expect(m.stop('depthStop')!.z).toBeCloseTo(stopped.z, -1);
    m.unmount();
  });

  it('a frame that shows no front already is never trapped: the rail moves the eye both ways, and back brings the wall in', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at({ ...TOP, z: 300 });
    expect(m.atEdge()).toBe(false);
    m.fc().depthStart(1);
    m.run(30);
    const nearer = m.stop('depthStop')!;
    expect(nearer.z).toBeLessThan(start.z - 100);
    m.fc().depthStart(-1);
    m.run(HELD);
    expect(m.stop('depthStop')!.z).toBeGreaterThan(start.z + 1000);
    expect(m.shows()).toBe(true);
    m.unmount();
  });

  it('a frame with a front only at its edge (a swipe left it so) keeps that much: forward stops where the last of it would go, and back is free', () => {
    const m = mount(freeSceneOf({ frame }));
    // between where the wall leaves the frame's middle and where it leaves the frame
    let z = TOP.z;
    while (m.shows({ ...poseOf(m.scene.base), ...TOP, z })) z -= 20;
    const start = m.at({ ...TOP, z: z - 100 });
    expect([m.shows(), m.atEdge()]).toEqual([false, true]);
    m.fc().depthStart(1);
    m.run(HELD, () => expect(m.atEdge()).toBe(true));
    const end = m.stop('depthStop')!;
    expect(end.z).toBeLessThan(start.z - 50);
    expect(m.atEdge({ ...end, z: end.z - 5 })).toBe(false);
    m.fc().depthStart(-1);
    m.run(HELD);
    expect(m.stop('depthStop')!.z).toBeGreaterThan(start.z + 1000);
    expect(m.shows()).toBe(true);
    m.unmount();
  });
});

describe.each([
  ['1536x730', DESKTOP],
  ['870x475', FOLD_OPEN],
])('NAV-EMPTY at %s: the hat never leaves the wall behind', (_name, frame) => {
  it('close to the cabinets, the hat held up 4 s raises the eye only as far as a front still shows', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at({ y: 1000, z: 600 });
    expect(m.shows()).toBe(true);
    // the room's top from here looks over the cabinets
    expect(m.shows({ ...start, y: m.scene.space.y1 })).toBe(false);
    expect(m.fc().jogStart()).toBe(true);
    m.fc().jogAim(0, -JOG_FULL_PX);
    m.run(HELD, () => expect(m.shows()).toBe(true));
    const end = m.stop('jogStop')!;
    expect(end.y).toBeGreaterThan(start.y + 300);
    expect(end.y).toBeLessThan(m.scene.space.y1);
    m.unmount();
  });

  it('from a frame that shows no front the hat moves the eye freely, back down to the wall', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at({ y: m.scene.space.y1, z: 600 });
    expect(m.atEdge()).toBe(false);
    m.fc().jogStart();
    m.fc().jogAim(0, JOG_FULL_PX);
    m.run(HELD);
    const end = m.stop('jogStop')!;
    expect(end.y).toBeLessThan(start.y - 300);
    expect(m.shows()).toBe(true);
    m.unmount();
  });
});

describe.each([
  ['1536x730', DESKTOP],
  ['870x475', FOLD_OPEN],
])('NAV-EMPTY at %s: a Look never turns the wall out of the frame', (_name, frame) => {
  /** The hat's Look held `dy` for 4 s, let go, and its ease back run: the pose it rests at. */
  const lookTo = (m: ReturnType<typeof mount>, dy: number): Pose => {
    expect(m.fc().lookStart()).toBe(true);
    m.fc().lookAim(0, dy);
    m.run(HELD);
    const rest = m.stop('lookStop')!;
    m.frames.tick(SPRING_MS);
    expect(m.pose()).toEqual(rest);
    return rest;
  };

  it('at the room\'s top a Look up rests where a front still shows, short of the 30 degrees that showed the ceiling alone', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at(TOP);
    expect(m.shows({ ...start, pitch: -PITCH.upSoft })).toBe(false);
    const rest = lookTo(m, -JOG_FULL_PX);
    expect(rest.pitch).toBeLessThan(-5 * DEG);
    expect(rest.pitch).toBeGreaterThan(-PITCH.upSoft);
    expect(m.shows(rest)).toBe(true);
    // the furthest: half a degree more and none shows
    expect(m.shows({ ...rest, pitch: rest.pitch - 0.5 * DEG })).toBe(false);
    m.unmount();
  });

  it('at the room\'s bottom a Look down rests where a front still shows, short of the 45 degrees that showed the floor alone', () => {
    const m = mount(freeSceneOf({ frame }));
    const start = m.at({ y: 300, z: TOP.z });
    expect(m.shows({ ...start, pitch: PITCH.downSoft })).toBe(false);
    const rest = lookTo(m, JOG_FULL_PX);
    expect(rest.pitch).toBeGreaterThan(5 * DEG);
    expect(rest.pitch).toBeLessThan(PITCH.downSoft);
    expect(m.shows(rest)).toBe(true);
    expect(m.shows({ ...rest, pitch: rest.pitch + 0.5 * DEG })).toBe(false);
    m.unmount();
  });

  it('a scene Look (a right drag) up from the room\'s top rests where a front still shows too', () => {
    const m = mount(freeSceneOf({ frame }));
    m.at(TOP);
    act(() => m.fc().press({ pointerId: 1, clientX: 400, clientY: 100, button: 2 }, { x: 400, y: 100 }));
    act(() => m.fc().drag(1, { x: 400, y: 100 + frame.height }, 'y'));
    // held past the limit the view is in its band, short of the hard limit
    expect(m.pose().pitch).toBeGreaterThan(-PITCH.upHard);
    act(() => {
      m.fc().release(1, true);
    });
    m.frames.tick(SPRING_MS);
    expect(m.pose().pitch).toBeLessThan(-5 * DEG);
    expect(m.pose().pitch).toBeGreaterThan(-PITCH.upSoft);
    expect(m.shows()).toBe(true);
    m.unmount();
  });

  it('looking up at the limit, the rail backing away 4 s keeps a front in every frame', () => {
    const m = mount(freeSceneOf({ frame }));
    m.at(TOP);
    lookTo(m, -JOG_FULL_PX);
    m.fc().depthStart(-1);
    m.run(HELD, () => expect(m.shows()).toBe(true));
    m.unmount();
  });

  it('at the framing, where 30 degrees up still shows the wall, a Look up rests at the 30 degrees it always did', () => {
    const m = mount(freeSceneOf({ frame }));
    expect(m.shows({ ...poseOf(m.scene.base), pitch: -PITCH.upSoft })).toBe(true);
    expect(lookTo(m, -JOG_FULL_PX).pitch).toBe(-PITCH.upSoft);
    m.unmount();
  });
});
