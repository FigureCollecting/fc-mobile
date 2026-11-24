import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useTiltLook } from '../useTiltLook';
import { TILT, quatOfEuler, relativeLook, shapeTilt, toScreen } from '../relativeOrientation';
import type { TiltDrive } from '../../stores/jog';
import { handFrames } from '../../components/display/__tests__/freeDrivesScene';

// NAV-LOGPOSE (nav rework U8): the orb's sampling, on only while it is ON and the page is shown. The handler caches the
// latest sample; a frame reads it, through the neutral taken at the first sample, shaped and smoothed, into the camera's
// tilt drive. Synthetic deviceorientation events (the useShakeDetect.test pattern).

const DEG = Math.PI / 180;

function orientation(alpha: number, beta: number, gamma: number): Event {
  const ev = new Event('deviceorientation');
  Object.defineProperties(ev, { alpha: { value: alpha }, beta: { value: beta }, gamma: { value: gamma } });
  return ev;
}
/** The phone upright (beta 90), turned `yaw` deg to the right about its upright axis. */
const turned = (yaw: number) => orientation(-yaw, 90, 0);

let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('screen', { orientation: Object.assign(new EventTarget(), { angle: 0 }) });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(active = true, kind: 'event' | 'sensor' = 'event') {
  const frames = handFrames(1000, true);
  const set = vi.fn((_y: number, _p: number) => true);
  const drive = { set, fold: vi.fn<() => void>() } satisfies TiltDrive;
  const show = vi.fn();
  const unavailable = vi.fn();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const listeners = () =>
    add.mock.calls.filter(([t]) => String(t) === 'deviceorientation').length - remove.mock.calls.filter(([t]) => String(t) === 'deviceorientation').length;
  const hook = renderHook((p: { active: boolean }) => useTiltLook(drive, p.active, kind, show, unavailable), { initialProps: { active } });
  return { frames, drive, set, show, unavailable, listeners, hook };
}

describe('sampling exists only while ON', () => {
  it('OFF: no listener and no frame; ON: one listener; OFF again: it goes, and the offset is folded', () => {
    const m = mount(false);
    expect(m.listeners()).toBe(0);
    expect(m.frames.pending()).toBe(0);
    m.hook.rerender({ active: true });
    expect(m.listeners()).toBe(1);
    m.hook.rerender({ active: false });
    expect(m.listeners()).toBe(0);
    expect(m.drive.fold).toHaveBeenCalledTimes(1);
    expect(m.frames.pending()).toBe(0);
  });

  it('the handler only caches: a burst of events asks for one frame, and the frame reads the latest', () => {
    const m = mount();
    act(() => {
      window.dispatchEvent(turned(0));
    });
    m.frames.tick(16);
    for (const y of [1, 2, 3, 6]) window.dispatchEvent(turned(y));
    expect(m.frames.pending()).toBe(1);
    expect(m.set).not.toHaveBeenCalled();
    m.frames.tick(16);
    expect(m.set).toHaveBeenCalledTimes(1);
    const want = shapeTilt({ yaw: 6, pitch: 0 }).yaw;
    // smoothed: on its way to the 6 deg sample's offset, not past it
    const y = m.set.mock.calls[0][0] / DEG;
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(want);
  });
});

describe('(c) a fixed tilt held is a fixed offset: no spin, and the frames stop once it has landed', () => {
  it('5 deg held 2 s: the offset settles on (5 - 1) x 0.6 = 2.4 deg and stays; no frame is asked once it has', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    m.frames.tick(16);
    // the neutral: no offset sent for it
    expect(m.set).not.toHaveBeenCalled();
    let last = 0;
    for (let t = 0; t < 2000; t += 33) {
      window.dispatchEvent(turned(5));
      m.frames.tick(33);
      last = m.set.mock.calls.at(-1)![0];
    }
    expect(last / DEG).toBeCloseTo(2.4, 6);
    const late = m.set.mock.calls.slice(-20).map((c) => c[0]);
    expect(new Set(late).size).toBe(1);
    // the needle shows the same offset
    expect(m.show.mock.calls.at(-1)![0].yaw).toBeCloseTo(2.4, 6);
    // no busy loop: with no new sample and the offset landed, nothing more is asked
    expect(m.frames.pending()).toBe(0);
  });

  it('looking up is the pose\'s pitch -: the top tipped back 4 deg sends -(4 - 1) x 0.6', () => {
    const m = mount();
    window.dispatchEvent(orientation(0, 90, 0));
    m.frames.tick(16);
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(orientation(0, 94, 0));
      m.frames.tick(33);
    }
    const [yaw, pitch] = m.set.mock.calls.at(-1)!;
    const up = relativeLook(toScreen(quatOfEuler(0, 90, 0), 0), toScreen(quatOfEuler(0, 94, 0), 0)).pitch;
    expect(up).toBeCloseTo(4, 6);
    expect(yaw).toBeCloseTo(0, 9);
    expect(pitch / DEG).toBeCloseTo(-shapeTilt({ yaw: 0, pitch: up }).pitch, 6);
  });
});

describe('the drive refuses (a finger, a drive, an ease, a fold): the source takes a new neutral, so nothing jumps after', () => {
  it('refused while the hat runs: when it lets go, the phone still tipped 8 deg sends no offset until it moves again', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    m.frames.tick(16);
    m.set.mockReturnValue(false);
    window.dispatchEvent(turned(8));
    m.frames.tick(16);
    expect(m.show.mock.calls.at(-1)![0]).toEqual({ yaw: 0, pitch: 0 });
    m.set.mockReturnValue(true);
    m.set.mockClear();
    window.dispatchEvent(turned(8));
    m.frames.tick(16);
    expect(m.set.mock.calls.every(([y, p]) => y === 0 && p === 0)).toBe(true);
    window.dispatchEvent(turned(10));
    m.frames.tick(500);
    m.frames.tick(16);
    expect(m.set.mock.calls.at(-1)![0] / DEG).toBeCloseTo(shapeTilt({ yaw: 2, pitch: 0 }).yaw, 6);
    expect(m.frames.pending()).toBe(0);
  });
});

describe('Recenter, rotation and a fold of the phone: fold, then a new neutral', () => {
  it('recenter folds the offset and the next sample is the neutral', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    m.frames.tick(16);
    window.dispatchEvent(turned(6));
    m.frames.tick(500);
    act(() => m.hook.result.current.recenter());
    expect(m.drive.fold).toHaveBeenCalledTimes(1);
    expect(m.show.mock.calls.at(-1)![0]).toEqual({ yaw: 0, pitch: 0 });
    m.set.mockClear();
    window.dispatchEvent(turned(6));
    m.frames.tick(16);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('the screen rotating, or the window resizing (the Fold opened), folds and re-neutralizes', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    m.frames.tick(16);
    (screen.orientation as unknown as EventTarget).dispatchEvent(new Event('change'));
    expect(m.drive.fold).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(m.drive.fold).toHaveBeenCalledTimes(2);
  });
});

describe('(f) hidden: no listener, no sensor; shown again: no jump', () => {
  it('visibilitychange to hidden removes the listener and folds; visible again re-adds it and takes a new neutral', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    m.frames.tick(16);
    window.dispatchEvent(turned(4));
    m.frames.tick(500);
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(m.listeners()).toBe(0);
    expect(m.drive.fold).toHaveBeenCalledTimes(1);
    expect(m.frames.pending()).toBe(0);
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(m.listeners()).toBe(1);
    m.set.mockClear();
    // the phone now tipped 9 deg: that is the new neutral, nothing sent for it
    window.dispatchEvent(turned(9));
    m.frames.tick(16);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('pagehide stops it too; pageshow (back from the cache) starts it again', () => {
    const m = mount();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(m.listeners()).toBe(0);
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(m.listeners()).toBe(1);
  });

  it('the sensor kind: hidden calls its stop', () => {
    const made: { stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'RelativeOrientationSensor',
      class extends EventTarget {
        quaternion = null;
        start = vi.fn();
        stop = vi.fn();
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    const m = mount(true, 'sensor');
    expect(made[0].start).toHaveBeenCalledTimes(1);
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(made[0].stop).toHaveBeenCalledTimes(1);
    m.hook.unmount();
    expect(made).toHaveLength(1);
  });

  it('switched ON while the page is hidden: nothing starts until it is shown', () => {
    visibility = 'hidden';
    const m = mount();
    expect(m.listeners()).toBe(0);
  });
});

describe('no real sample within 1 s of ON: unavailable', () => {
  it('the source is stopped and the orb told; a sample in time keeps it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mount();
    vi.advanceTimersByTime(TILT.firstSampleMs);
    expect(m.unavailable).toHaveBeenCalledTimes(1);
    m.hook.unmount();
    const k = mount();
    window.dispatchEvent(turned(0));
    vi.advanceTimersByTime(TILT.firstSampleMs * 2);
    expect(k.unavailable).not.toHaveBeenCalled();
  });

  it('the sensor\'s error (permission revoked, hardware gone) is unavailable too', () => {
    let fail: () => void = () => {};
    vi.stubGlobal(
      'RelativeOrientationSensor',
      class extends EventTarget {
        quaternion = null;
        start() {
          fail = () => this.dispatchEvent(new Event('error'));
        }
        stop() {}
      },
    );
    const m = mount(true, 'sensor');
    fail();
    expect(m.unavailable).toHaveBeenCalledTimes(1);
  });
});

describe('unmounted (the case gone, a card over it): stops and folds; the frame asked is dropped', () => {
  it('no listener left, one fold, no frame pending', () => {
    const m = mount();
    window.dispatchEvent(turned(0));
    expect(m.frames.pending()).toBe(1);
    m.hook.unmount();
    expect(m.listeners()).toBe(0);
    expect(m.drive.fold).toHaveBeenCalledTimes(1);
    expect(m.frames.pending()).toBe(0);
  });
});
