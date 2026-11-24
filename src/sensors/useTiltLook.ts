/**
 * NAV-LOGPOSE (handoff FINAL 11-17 section 6; plan U8): the orb's fine Look while it is ON. Position-based: the device's
 * turn from a neutral (the first sample after switch-on, a recenter, a rotation, a resume, or any refusal by the drive)
 * is shaped (dead zone, gain, caps) and smoothed into an offset the camera composes at its output (TiltDrive's set); a
 * phone held tilted holds the view turned, it never spins.
 * - Battery: nothing exists while OFF or hidden: no listener, no sensor, no frame. The handler only keeps the latest
 *   sample and asks for one frame; the frame reads it. Once the offset has landed no frame is asked until a sample comes.
 * - Off, hidden, pagehide, unmounted, a recenter, the screen rotated or the window resized (the Fold opened or closed):
 *   the offset is folded into the camera's pose (fold), so the view stays where it is drawn.
 * - No real sample within TILT.firstSampleMs of starting, or the sensor's error: `unavailable`.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { TiltDrive } from '../stores/jog';
import { TILT, openTilt, relativeLook, shapeTilt, smoothToward, type Quat, type TiltKind, type TiltSource } from './relativeOrientation';

const RAD = Math.PI / 180;
const ZERO = { yaw: 0, pitch: 0 } as const;

/** The offset (camera degrees: yaw + right, pitch + up) the orb's needle shows. */
export type TiltShown = { yaw: number; pitch: number };

export function useTiltLook(drive: TiltDrive, active: boolean, kind: TiltKind | null, show: (o: TiltShown) => void, unavailable: () => void): { recenter: () => void } {
  const recenter = useRef<() => void>(() => {});
  const out = useRef({ show, unavailable });
  out.current = { show, unavailable };

  useEffect(() => {
    if (!active || kind === null) return;
    let src: TiltSource | null = null;
    let neutral: Quat | null = null;
    let shown: TiltShown = ZERO;
    let last = 0;
    let frame: number | undefined;
    let first: ReturnType<typeof setTimeout> | undefined;

    const renew = () => {
      neutral = null;
      shown = ZERO;
      out.current.show(ZERO);
    };
    const tick = (now: number) => {
      frame = undefined;
      const q = src?.latest();
      if (!q) return;
      if (neutral === null) {
        neutral = q;
        last = now;
        return;
      }
      const target = shapeTilt(relativeLook(neutral, q));
      shown = smoothToward(shown, target, now - last);
      last = now;
      // the pose's pitch is + down; the device's look up is +
      if (!drive.set(shown.yaw * RAD, -shown.pitch * RAD)) {
        // a finger, a drive or an ease has the view, or a fold since: this orientation is the new neutral
        neutral = q;
        shown = ZERO;
        out.current.show(ZERO);
        return;
      }
      out.current.show(shown);
      if (shown.yaw !== target.yaw || shown.pitch !== target.pitch) frame = requestAnimationFrame(tick);
    };
    const heard = () => {
      clearTimeout(first);
      if (frame === undefined) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (src !== null || document.visibilityState === 'hidden') return;
      renew();
      src = openTilt(kind, heard, () => out.current.unavailable());
      first = setTimeout(() => {
        if (src?.latest() == null) out.current.unavailable();
      }, TILT.firstSampleMs);
    };
    const stop = () => {
      if (src === null) return;
      src.stop();
      src = null;
      clearTimeout(first);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      drive.fold();
      out.current.show(ZERO);
    };
    const refold = () => {
      if (src === null) return;
      drive.fold();
      renew();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? stop() : start());
    const orientation = (globalThis.screen as Screen | undefined)?.orientation as (ScreenOrientation & EventTarget) | undefined;

    recenter.current = refold;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', start);
    window.addEventListener('resize', refold);
    orientation?.addEventListener?.('change', refold);
    start();
    return () => {
      recenter.current = () => {};
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('pageshow', start);
      window.removeEventListener('resize', refold);
      orientation?.removeEventListener?.('change', refold);
      stop();
    };
  }, [active, kind, drive]);

  return { recenter: () => recenter.current() };
}
