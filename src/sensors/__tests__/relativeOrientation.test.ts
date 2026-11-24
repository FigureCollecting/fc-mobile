import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TILT,
  askTilt,
  openTilt,
  probeTilt,
  quatOfEuler,
  relativeLook,
  shapeTilt,
  smoothToward,
  toScreen,
  type Quat,
} from '../relativeOrientation';

// NAV-LOGPOSE (nav rework U8): the source the Log-Pose orb reads, relative to a neutral captured at switch-on. Its pure
// half (the quaternion maths, the shaping and the smoothing) and its device half (which API, the first-sample probe,
// iOS's permission), the latter with synthetic events, the useShakeDetect.test pattern.

const DEG = Math.PI / 180;
/** The rotation by `deg` about the unit `axis`, as [x, y, z, w]. */
const about = (axis: [number, number, number], deg: number): Quat => {
  const h = (deg * DEG) / 2;
  return [axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h), Math.cos(h)];
};
const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const ID: Quat = [0, 0, 0, 1];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('relativeLook: the turn from the neutral, in the screen frame', () => {
  it('the phone turned right about its upright axis looks right; its top tipped back looks up; no roll comes through', () => {
    // device y is the screen's up: turning right is clockwise seen from above, a negative turn about +y
    const right = relativeLook(ID, about([0, 1, 0], -10));
    expect(right.yaw).toBeCloseTo(10, 6);
    expect(right.pitch).toBeCloseTo(0, 6);
    // the top tipped back toward the face: the camera out of the back looks up (a positive turn about +x)
    const up = relativeLook(ID, about([1, 0, 0], 7));
    expect(up.pitch).toBeCloseTo(7, 6);
    expect(up.yaw).toBeCloseTo(0, 6);
    // a roll about the line of sight (z) moves neither
    const roll = relativeLook(ID, about([0, 0, 1], 30));
    expect(roll.yaw).toBeCloseTo(0, 6);
    expect(roll.pitch).toBeCloseTo(0, 6);
  });

  it('relative to the neutral, wherever that was: the same turn from a phone held tipped and turned reads the same', () => {
    const neutral = mul(about([0, 0, 1], 40), about([1, 0, 0], 60));
    const r = relativeLook(neutral, mul(neutral, about([0, 1, 0], -5)));
    expect(r.yaw).toBeCloseTo(5, 6);
    expect(r.pitch).toBeCloseTo(0, 6);
    expect(relativeLook(neutral, neutral)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('no gimbal lock: held upright (beta 90) a small turn is a small yaw, never a 180 flip', () => {
    const upright = quatOfEuler(0, 90, 0);
    const turned = quatOfEuler(-4, 90, 0);
    const r = relativeLook(upright, turned);
    expect(Math.abs(r.yaw)).toBeCloseTo(4, 4);
    expect(Math.abs(r.pitch)).toBeLessThan(1e-6);
    const nudged = relativeLook(quatOfEuler(0, 89.9, 0), quatOfEuler(0, 90.1, 0));
    expect(Math.abs(nudged.pitch)).toBeCloseTo(0.2, 4);
    expect(Math.abs(nudged.yaw)).toBeLessThan(1e-6);
  });
});

describe('quatOfEuler and toScreen: deviceorientation into the screen frame', () => {
  it('alpha, beta, gamma (Z-X\'-Y\'\') as the W3C quaternion: each axis alone is a turn about it', () => {
    const near = (a: Quat, b: Quat) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    near(quatOfEuler(0, 0, 0), ID);
    near(quatOfEuler(30, 0, 0), about([0, 0, 1], 30));
    near(quatOfEuler(0, 30, 0), about([1, 0, 0], 30));
    near(quatOfEuler(0, 0, 30), about([0, 1, 0], 30));
    near(quatOfEuler(10, 20, 30), mul(mul(about([0, 0, 1], 10), about([1, 0, 0], 20)), about([0, 1, 0], 30)));
  });

  it('held sideways (screen angle 90): turning about the screen\'s upright axis (the device\'s x) is a yaw, not a pitch', () => {
    const turn = about([1, 0, 0], -10);
    expect(relativeLook(ID, turn).pitch).toBeCloseTo(-10, 6);
    const r = relativeLook(toScreen(ID, 90), toScreen(turn, 90));
    expect(r.yaw).toBeCloseTo(10, 6);
    expect(r.pitch).toBeCloseTo(0, 6);
    // and the other way round (270): the opposite sign
    expect(relativeLook(toScreen(ID, 270), toScreen(turn, 270)).yaw).toBeCloseTo(-10, 6);
  });
});

describe('shapeTilt: the dead zone, the gain and the caps (plan section 3)', () => {
  it('inside the 1 deg dead zone: nothing; past it, 0.6 deg a degree, from its edge (no step at the edge)', () => {
    expect(shapeTilt({ yaw: TILT.deadDeg, pitch: -0.5 })).toEqual({ yaw: 0, pitch: 0 });
    const s = shapeTilt({ yaw: 5, pitch: -3 });
    expect(s.yaw).toBeCloseTo((5 - TILT.deadDeg) * TILT.gain, 9);
    expect(s.pitch).toBeCloseTo(-(3 - TILT.deadDeg) * TILT.gain, 9);
    expect(shapeTilt({ yaw: TILT.deadDeg + 1e-9, pitch: 0 }).yaw).toBeLessThan(1e-9);
  });

  it('capped at +-12 deg yaw and +-8 deg pitch, however far it is tipped', () => {
    expect(shapeTilt({ yaw: 90, pitch: -90 })).toEqual({ yaw: TILT.yawCapDeg, pitch: -TILT.pitchCapDeg });
    expect(shapeTilt({ yaw: -400, pitch: 400 })).toEqual({ yaw: -TILT.yawCapDeg, pitch: TILT.pitchCapDeg });
  });

  it('a sample that is no number (a device\'s null, NaN) moves nothing', () => {
    expect(shapeTilt({ yaw: Number.NaN, pitch: 4 })).toEqual({ yaw: 0, pitch: (4 - TILT.deadDeg) * TILT.gain });
  });
});

describe('smoothToward: exponential, tau 80 ms', () => {
  it('one tau closes 63 % of the gap; a long frame lands; a tiny gap snaps (the loop can rest)', () => {
    const a = smoothToward({ yaw: 0, pitch: 0 }, { yaw: 10, pitch: -10 }, TILT.tauMs);
    expect(a.yaw).toBeCloseTo(10 * (1 - Math.exp(-1)), 9);
    expect(a.pitch).toBeCloseTo(-10 * (1 - Math.exp(-1)), 9);
    const b = smoothToward({ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, 10_000);
    expect(b).toEqual({ yaw: 10, pitch: 0 });
    expect(smoothToward({ yaw: 9.999, pitch: 0 }, { yaw: 10, pitch: 0 }, 1)).toEqual({ yaw: 10, pitch: 0 });
    // a frame of no time (or a clock stepped back) moves nothing
    expect(smoothToward({ yaw: 1, pitch: 2 }, { yaw: 10, pitch: 0 }, -5)).toEqual({ yaw: 1, pitch: 2 });
  });
});

// --- the device half ------------------------------------------------------------------------------------------------------

function orientationEvent(alpha: number | null, beta: number | null, gamma: number | null): Event {
  const ev = new Event('deviceorientation');
  Object.defineProperties(ev, { alpha: { value: alpha }, beta: { value: beta }, gamma: { value: gamma } });
  return ev;
}

/** A Generic Sensor stand-in: it reads when the test says, and errors when it says. */
class FakeSensor extends EventTarget {
  static made: FakeSensor[] = [];
  static throws: Error | null = null;
  quaternion: number[] | null = null;
  started = 0;
  stopped = 0;
  readonly opts: unknown;
  constructor(opts: unknown) {
    super();
    if (FakeSensor.throws) throw FakeSensor.throws;
    this.opts = opts;
    FakeSensor.made.push(this);
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  read(q: Quat) {
    this.quaternion = [...q];
    this.dispatchEvent(new Event('reading'));
  }
  fail() {
    this.dispatchEvent(new Event('error'));
  }
}

function withSensor(permission: PermissionState = 'granted') {
  FakeSensor.made = [];
  FakeSensor.throws = null;
  vi.stubGlobal('RelativeOrientationSensor', FakeSensor);
  const query = vi.fn(async () => ({ state: permission }) as PermissionStatus);
  vi.stubGlobal('navigator', { ...navigator, permissions: { query } });
  return { query };
}
function withoutSensor() {
  vi.stubGlobal('RelativeOrientationSensor', undefined);
}

describe('openTilt: the latest sample cached, nothing else done in the handler', () => {
  it('the sensor at 30 Hz in the screen frame: each reading is the latest; stop stops it', () => {
    withSensor();
    const heard = vi.fn();
    const src = openTilt('sensor', heard);
    const sensor = FakeSensor.made[0];
    expect(sensor.opts).toEqual({ frequency: TILT.hz, referenceFrame: 'screen' });
    expect(sensor.started).toBe(1);
    expect(src.latest()).toBeNull();
    const q = about([0, 1, 0], 20);
    sensor.read(q);
    expect(src.latest()).toEqual(q);
    expect(heard).toHaveBeenCalledTimes(1);
    src.stop();
    expect(sensor.stopped).toBe(1);
    sensor.read(ID);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('deviceorientation: one window listener, its angles through the screen\'s angle; a null sample is none; stop removes it', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    vi.stubGlobal('screen', { orientation: { angle: 90 } });
    const heard = vi.fn();
    const src = openTilt('event', heard);
    expect(add.mock.calls.filter(([t]) => String(t) === 'deviceorientation')).toHaveLength(1);
    window.dispatchEvent(orientationEvent(null, null, null));
    expect(src.latest()).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    window.dispatchEvent(orientationEvent(10, 20, 30));
    expect(src.latest()).toEqual(toScreen(quatOfEuler(10, 20, 30), 90));
    // no alpha (no compass, no relative alpha): beta and gamma still read, alpha taken as 0
    window.dispatchEvent(orientationEvent(null, 45, 0));
    expect(src.latest()).toEqual(toScreen(quatOfEuler(0, 45, 0), 90));
    expect(heard).toHaveBeenCalledTimes(2);
    src.stop();
    expect(remove.mock.calls.filter(([t]) => String(t) === 'deviceorientation')).toHaveLength(1);
    window.dispatchEvent(orientationEvent(1, 2, 3));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('no screen.orientation (older iOS): window.orientation\'s angle, else 0', () => {
    vi.stubGlobal('screen', {});
    vi.stubGlobal('orientation', -90);
    const src = openTilt('event', () => {});
    window.dispatchEvent(orientationEvent(0, 30, 0));
    expect(src.latest()).toEqual(toScreen(quatOfEuler(0, 30, 0), 270));
    src.stop();
    vi.stubGlobal('orientation', undefined);
    const plain = openTilt('event', () => {});
    window.dispatchEvent(orientationEvent(0, 30, 0));
    expect(plain.latest()).toEqual(quatOfEuler(0, 30, 0));
    plain.stop();
  });
});

describe('probeTilt: shown as available only after a first real sample within 1 s, then sampling stops', () => {
  it('iOS (requestPermission): "ask", with no listener and no permission asked (that waits for the orb\'s click)', async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(function () {}, { requestPermission }));
    const add = vi.spyOn(window, 'addEventListener');
    await expect(probeTilt()).resolves.toBe('ask');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([t]) => String(t) === 'deviceorientation')).toHaveLength(0);
  });

  it('the sensor reads within 1 s: "sensor", and it is stopped at once', async () => {
    withSensor();
    const p = probeTilt();
    await vi.waitFor(() => expect(FakeSensor.made).toHaveLength(1));
    FakeSensor.made[0].read(about([0, 1, 0], 1));
    await expect(p).resolves.toBe('sensor');
    expect(FakeSensor.made[0].stopped).toBe(1);
  });

  it('the sensor errors (no hardware): deviceorientation is tried; a real sample there is "event", its listener removed', async () => {
    withSensor();
    const remove = vi.spyOn(window, 'removeEventListener');
    const p = probeTilt();
    await vi.waitFor(() => expect(FakeSensor.made).toHaveLength(1));
    FakeSensor.made[0].fail();
    await vi.waitFor(() => expect(FakeSensor.made[0].stopped).toBe(1));
    window.dispatchEvent(orientationEvent(null, null, null));
    window.dispatchEvent(orientationEvent(0, 80, 2));
    await expect(p).resolves.toBe('event');
    expect(remove.mock.calls.filter(([t]) => String(t) === 'deviceorientation')).toHaveLength(1);
  });

  it('the sensor\'s permission denied: it is never made; a constructor that throws is skipped too', async () => {
    withSensor('denied');
    vi.useFakeTimers();
    const p = probeTilt();
    await vi.advanceTimersByTimeAsync(TILT.firstSampleMs);
    await expect(p).resolves.toBe('none');
    expect(FakeSensor.made).toHaveLength(0);
    withSensor();
    FakeSensor.throws = new DOMException('blocked', 'SecurityError');
    const q = probeTilt();
    await vi.advanceTimersByTimeAsync(TILT.firstSampleMs);
    await expect(q).resolves.toBe('none');
  });

  it('a permissions query that throws (the name unknown) is not a denial: the sensor is tried', async () => {
    withSensor();
    vi.mocked(navigator.permissions.query).mockRejectedValue(new TypeError('unknown name'));
    const p = probeTilt();
    await vi.waitFor(() => expect(FakeSensor.made).toHaveLength(1));
    FakeSensor.made[0].read(ID);
    await expect(p).resolves.toBe('sensor');
  });

  it('nothing real within 1 s on either (a desktop: no sensor, only null events): "none", every listener gone', async () => {
    withSensor();
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const p = probeTilt();
    await vi.advanceTimersByTimeAsync(TILT.firstSampleMs);
    expect(FakeSensor.made[0].stopped).toBe(1);
    window.dispatchEvent(orientationEvent(null, null, null));
    await vi.advanceTimersByTimeAsync(TILT.firstSampleMs);
    await expect(p).resolves.toBe('none');
    const on = add.mock.calls.filter(([t]) => String(t) === 'deviceorientation').length;
    expect(on).toBe(1);
    expect(remove.mock.calls.filter(([t]) => String(t) === 'deviceorientation')).toHaveLength(on);
  });

  it('no API at all: "none" at once', async () => {
    withoutSensor();
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    await expect(probeTilt()).resolves.toBe('none');
  });
});

describe('askTilt: iOS\'s permission, asked synchronously in the click', () => {
  it('no requestPermission: null (nothing to ask)', () => {
    vi.stubGlobal('DeviceOrientationEvent', function () {});
    expect(askTilt()).toBeNull();
  });

  it('requestPermission is called before the call returns (no await before it); granted is true, anything else false', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(function () {}, { requestPermission }));
    const asked = askTilt();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledWith();
    await expect(asked).resolves.toBe(true);
    requestPermission.mockResolvedValueOnce('denied');
    await expect(askTilt()).resolves.toBe(false);
    requestPermission.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'));
    await expect(askTilt()).resolves.toBe(false);
  });
});
