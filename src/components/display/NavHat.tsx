/**
 * NAV-FLOAT (handoff FINAL 11-17): the right XY hat, floating over the case (FloatingNav). It is the jog the bottom-centre
 * button was (NAV-JOG, Ross 10-28), moved, with nothing of its drive changed: a press that leaves JOG_DEAD_PX starts the
 * jog on offer (once), aims it at the thumb's offset from where it went down at every move, and the lift, a pointercancel
 * or the capture lost stops it. The press is the hat's own (pointer capture), so a thumb dragged far outside the ring
 * keeps control. The knob shows the reach over the ring; the speed is the scene's (jogStep), in the thumb's px. A tap does
 * nothing. Its upper-left shoulder is kept free for the eye (NAV-EYE).
 */
import { useEffect, useRef } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import type { JogTarget } from '../../stores/jog';
import { JOG_DEAD_PX, JOG_FULL_PX, jogDetents, jogSpeed } from './casePose';

/** NAV-2B: a detent passed on the way out ticks again on the way back once the thumb is this much (px) inside it: a wobble on it ticks once. */
const DETENT_SLACK_PX = 4;

/**
 * NAV-2B: how many of the jog's detents (jogDetents) the thumb `d` px out has passed, from `band` passed before: more once
 * jogSpeed there reaches the next; fewer only once it would not even DETENT_SLACK_PX farther out.
 */
function detentBand(d: number, band: number, max: number | undefined): number {
  const levels = jogDetents(max);
  const passed = (at: number) => levels.filter((level) => jogSpeed(at, max) >= level).length;
  const out = passed(d);
  return out >= band ? out : Math.min(band, passed(d + DETENT_SLACK_PX));
}

interface Drive {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly target: JogTarget;
  moved: boolean;
  on: boolean;
  band: number;
}

/** The four arrows, by the way each points (degrees anticlockwise from the right): on the axes, clear of the eye's shoulder. */
const ARROWS: readonly (readonly [number, string])[] = [
  [0, '9 6 15 12 9 18'],
  [90, '6 15 12 9 18 15'],
  [180, '15 6 9 12 15 18'],
  [270, '6 9 12 15 18 9'],
];

export function NavHat({ jog }: { jog: JogTarget }) {
  const drive = useRef<Drive | null>(null);

  // withdrawn mid-drag (the case gone): no lift will come, so the drive it started stops here
  useEffect(
    () => () => {
      const d = drive.current;
      drive.current = null;
      if (d?.on) d.target.stop();
    },
    [],
  );

  const end = (e: PointerEvent) => {
    const d = drive.current;
    if (!d || d.id !== e.pointerId) return;
    drive.current = null;
    // the spring back to the centre
    const node = e.currentTarget as HTMLElement;
    delete node.dataset.jogging;
    node.style.removeProperty('--hat-x');
    node.style.removeProperty('--hat-y');
    if (d.on) d.target.stop();
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (drive.current) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer cannot be captured */
      }
      drive.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, target: jog, moved: false, on: false, band: 0 };
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drive.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      const reach = Math.hypot(dx, dy);
      const node = e.currentTarget as HTMLElement;
      if (!d.moved) {
        if (reach <= JOG_DEAD_PX) return;
        d.moved = true;
        d.on = d.target.start();
        if (!d.on) return;
        node.dataset.jogging = '';
        hapticLight();
        // the start's tick stands for any detent its first move is already past
        d.band = detentBand(reach, 0, d.target.max);
      }
      if (!d.on) return;
      d.target.aim(dx, dy);
      // NAV-2B: a light tick each time the speed passes a detent, out or back (one for a move past several)
      const band = detentBand(reach, d.band, d.target.max);
      if (band !== d.band) {
        d.band = band;
        hapticLight();
      }
      // the knob shows the reach over the ring: the thumb's way, full at JOG_FULL_PX (a drive is always past the dead zone)
      const k = Math.min(reach, JOG_FULL_PX) / JOG_FULL_PX / reach;
      node.style.setProperty('--hat-x', String(dx * k));
      node.style.setProperty('--hat-y', String(dy * k));
    },
    onPointerUp: end,
    onPointerCancel: end,
    // the capture lost mid-drag (the browser or a script released it): no lift will reach the hat, so it stops here
    onLostPointerCapture: end,
  };

  return (
    <div class="nav-hat" data-nav="hat" role="group" aria-label="Move the camera: hold and drag" {...handlers}>
      {ARROWS.map(([deg, points]) => (
        <svg key={deg} class={`nav-hat__arrow nav-hat__arrow--${deg}`} data-deg={deg} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points={points} />
        </svg>
      ))}
      <span class="nav-hat__knob" aria-hidden="true" />
      <span class="nav-hat__eye-slot" data-nav-slot="eye" aria-hidden="true" />
    </div>
  );
}
