/**
 * NAV-LOGPOSE (handoff FINAL 11-17, section 6; plan U8): the source the Log-Pose orb's fine Look reads. Relative only:
 * the device's turn from a neutral taken at switch-on, in the screen's frame, as a yaw (turned right +) and a pitch
 * (looked up +), roll dropped. No compass and no location: a relative orientation is all it asks for.
 * - Which API: the Generic Sensor RelativeOrientationSensor (screen frame, 30 Hz) where its permission is not denied;
 *   else deviceorientation (iOS asks permission for it, inside the orb's click: askTilt); else none.
 * - Available only once a first real sample arrives within 1 s (probeTilt): a desktop's API with no hardware is none.
 * - The handlers only keep the latest sample; the orb's frame reads it (useTiltLook). Quaternions throughout, so a phone
 *   held upright (beta 90) has no gimbal lock.
 */

/** A unit quaternion [x, y, z, w] (the Generic Sensor's order): the device's frame turned into the world's. */
export type Quat = readonly [number, number, number, number];

/**
 * Plan section 3 (starting values, to tune on the Fold): 1 deg of the device is 0.6 deg of the camera past a 1 deg dead
 * zone, capped at 12 deg of yaw and 8 of pitch; smoothed exponentially (tau, ms); the sensor's rate; the first sample's
 * wait. The camera's own cone still bounds the sum.
 */
export const TILT = { gain: 0.6, deadDeg: 1, yawCapDeg: 12, pitchCapDeg: 8, tauMs: 80, hz: 30, firstSampleMs: 1000 } as const;

const RAD = Math.PI / 180;

const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** deviceorientation's alpha, beta, gamma (deg; Z-X'-Y'' intrinsic) as a quaternion (the W3C's getQuaternion). */
export function quatOfEuler(alpha: number, beta: number, gamma: number): Quat {
  const [z, x, y] = [alpha, beta, gamma].map((d) => (d * RAD) / 2);
  const [cX, cY, cZ] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  const [sX, sY, sZ] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  return [sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ, cX * cY * cZ - sX * sY * sZ];
}

/** A device-frame quaternion in the screen's frame, the screen turned `angleDeg` (screen.orientation.angle) from upright. */
export function toScreen(q: Quat, angleDeg: number): Quat {
  const h = (-angleDeg * RAD) / 2;
  return mul(q, [0, 0, Math.sin(h), Math.cos(h)]);
}

/**
 * The turn from `neutral` to `now` (deg): where the line out of the back of the screen points now, in the neutral's
 * frame. Yaw + is turned right, pitch + is looking up; a roll about that line moves neither.
 */
export function relativeLook(neutral: Quat, now: Quat): { yaw: number; pitch: number } {
  const r = mul(conj(neutral), now);
  // r applied to (0, 0, -1): minus the rotation matrix's third column
  const [x, y, z, w] = r;
  const vx = -2 * (x * z + w * y);
  const vy = -2 * (y * z - w * x);
  const vz = -(1 - 2 * (x * x + y * y));
  const deg = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v / RAD);
  return { yaw: deg(Math.atan2(vx, -vz)), pitch: deg(Math.atan2(vy, Math.hypot(vx, vz))) };
}

/** The device's turn (deg) as the camera's offset (deg): the dead zone taken off its edge, the gain, the caps. */
export function shapeTilt(look: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
  const shape = (d: number, cap: number) => {
    if (!Number.isFinite(d)) return 0;
    const past = Math.max(0, Math.abs(d) - TILT.deadDeg) * TILT.gain;
    return past === 0 ? 0 : Math.sign(d) * Math.min(cap, past);
  };
  return { yaw: shape(look.yaw, TILT.yawCapDeg), pitch: shape(look.pitch, TILT.pitchCapDeg) };
}

/** The offset shown moved toward the one asked for over `dtMs` (exponential, TILT.tauMs); within 0.01 deg it lands. */
export function smoothToward(from: { yaw: number; pitch: number }, to: { yaw: number; pitch: number }, dtMs: number): { yaw: number; pitch: number } {
  if (!(dtMs > 0)) return from;
  const k = 1 - Math.exp(-dtMs / TILT.tauMs);
  const step = (a: number, b: number) => (Math.abs(b - a) < 0.01 ? b : a + (b - a) * k);
  return { yaw: step(from.yaw, to.yaw), pitch: step(from.pitch, to.pitch) };
}

export type TiltKind = 'sensor' | 'event';

/** A running source: its latest sample (null before one) and its stop. */
export interface TiltSource {
  readonly kind: TiltKind;
  latest(): Quat | null;
  stop(): void;
}

/** The Generic Sensor this needs (not in TypeScript's DOM library). */
interface OrientationSensor extends EventTarget {
  readonly quaternion: readonly number[] | null;
  start(): void;
  stop(): void;
}
type OrientationSensorCtor = new (opts: { frequency: number; referenceFrame: 'screen' | 'device' }) => OrientationSensor;
/** iOS 13+ asks before deviceorientation reaches a page. */
type PermissionAsker = { requestPermission?: () => Promise<string> };

const sensorCtor = (): OrientationSensorCtor | undefined => (globalThis as { RelativeOrientationSensor?: OrientationSensorCtor }).RelativeOrientationSensor;
const eventCtor = (): PermissionAsker | undefined => (globalThis as { DeviceOrientationEvent?: PermissionAsker }).DeviceOrientationEvent;

/** The screen's turn from upright (deg): screen.orientation, else the old window.orientation (iOS), else 0. */
function screenAngle(): number {
  const angle = (globalThis.screen as Screen | undefined)?.orientation?.angle;
  if (typeof angle === 'number') return angle;
  const old = (globalThis as { orientation?: number }).orientation;
  return typeof old === 'number' ? (old + 360) % 360 : 0;
}

/**
 * Start the `kind` source; `heard` is told of each real sample (it should only ask for a frame), `failed` of the
 * sensor's error (no hardware, a permission refused). The sensor's constructor may throw (a policy blocks it).
 */
export function openTilt(kind: TiltKind, heard: () => void, failed?: () => void): TiltSource {
  let latest: Quat | null = null;
  if (kind === 'sensor') {
    const sensor = new (sensorCtor()!)({ frequency: TILT.hz, referenceFrame: 'screen' });
    const onReading = () => {
      const q = sensor.quaternion;
      if (!q || q.length !== 4) return;
      latest = [q[0], q[1], q[2], q[3]];
      heard();
    };
    const onError = () => failed?.();
    sensor.addEventListener('reading', onReading);
    sensor.addEventListener('error', onError);
    sensor.start();
    return {
      kind,
      latest: () => latest,
      stop: () => {
        sensor.removeEventListener('reading', onReading);
        sensor.removeEventListener('error', onError);
        sensor.stop();
      },
    };
  }
  const onEvent = (e: Event) => {
    const { alpha, beta, gamma } = e as DeviceOrientationEvent;
    if (beta === null || gamma === null || beta === undefined || gamma === undefined) return;
    latest = toScreen(quatOfEuler(alpha ?? 0, beta, gamma), screenAngle());
    heard();
  };
  window.addEventListener('deviceorientation', onEvent);
  return { kind, latest: () => latest, stop: () => window.removeEventListener('deviceorientation', onEvent) };
}

/** Whether the sensor's permissions are not denied (a query that cannot answer is no denial). */
async function sensorAllowed(): Promise<boolean> {
  try {
    // (the Generic Sensor's names, not in TypeScript's PermissionName)
    const names = ['accelerometer', 'gyroscope'] as unknown as PermissionName[];
    const states = await Promise.all(names.map((name) => navigator.permissions.query({ name })));
    return states.every((s) => s.state !== 'denied');
  } catch {
    return true;
  }
}

/** Open `kind` until its first real sample or `ms`, then stop it: whether one came. */
function firstSample(kind: TiltKind, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let src: TiltSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      src?.stop();
      src = null;
      resolve(ok);
    };
    try {
      src = openTilt(kind, () => done(true), () => done(false));
    } catch {
      resolve(false);
      return;
    }
    timer = setTimeout(() => done(false), ms);
  });
}

export type TiltProbe = TiltKind | 'ask' | 'none';

/**
 * Which source this device can give the orb: iOS's permissioned deviceorientation ('ask': nothing opened until the orb's
 * click), else the first of the sensor and deviceorientation to give a real sample within `ms` each, else none.
 * Whatever it opened is stopped before it resolves.
 */
export async function probeTilt(ms: number = TILT.firstSampleMs): Promise<TiltProbe> {
  const event = eventCtor();
  if (typeof event?.requestPermission === 'function') return 'ask';
  if (sensorCtor() && (await sensorAllowed()) && (await firstSample('sensor', ms))) return 'sensor';
  if (event && (await firstSample('event', ms))) return 'event';
  return 'none';
}

/**
 * iOS: ask for deviceorientation. Called synchronously in the orb's click (the permission needs the click's activation:
 * nothing is awaited before it). null: nothing to ask; else whether it was granted.
 */
export function askTilt(): Promise<boolean> | null {
  const ask = eventCtor()?.requestPermission;
  if (typeof ask !== 'function') return null;
  return ask.call(eventCtor()).then(
    (state) => state === 'granted',
    () => false,
  );
}
