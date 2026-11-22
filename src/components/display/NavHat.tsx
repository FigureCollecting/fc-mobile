/**
 * NAV-FLOAT (handoff FINAL 11-17): the right XY hat, floating over the case (FloatingNav). It is the jog the bottom-centre
 * button was (NAV-JOG, Ross 10-28), moved, with nothing of its drive changed: a press that leaves JOG_DEAD_PX starts the
 * jog on offer (once), aims it at the thumb's offset from where it went down at every move, and the lift, a pointercancel
 * or the capture lost stops it. The press is the hat's own (pointer capture), so a thumb dragged far outside the ring
 * keeps control. The knob shows the reach over the ring; the speed is the scene's (jogStep), in the thumb's px.
 *
 * NAV-EYE (handoff B; Ross NAVLOOK 1a 2a 3b): the eye on its upper-left shoulder (NavEye) latches it Move <-> Look
 * (stores/navMode); in Look the same press drives the Look drive (the jog's `look`) instead, through the same dead zone,
 * reach and detents. The mode is read at the press: a toggle while a thumb holds the hat waits for the next press. The
 * eye pressed and slid onto the hat hands the finger over (adopt) as a temporary Look until it lifts (2a). Two short,
 * still taps on the hat toggle the mode too (3b, HAT_DOUBLE_TAP); a tap that starts a jog never counts, and a still
 * hold never toggles anything.
 */
import { useEffect, useRef } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import type { JogTarget, LookDrive } from '../../stores/jog';
import { navModeNow, setTempLook, toggleNavMode, useNavMode, type NavMode } from '../../stores/navMode';
import { JOG_DEAD_PX, JOG_FULL_PX, jogDetents, jogSpeed } from './casePose';
import { NavEye } from './NavEye';
import { HAT_DOUBLE_TAP } from './navTuning';

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
  /** When it went down (ms): a double tap's taps are short. */
  readonly t0: number;
  /** What this press drives, chosen at the press: the jog (Move) or its Look drive. */
  readonly target: LookDrive;
  /** NAV-2B: the jog's top speed, where its detents tick (Look ticks at the same). */
  readonly max: number | undefined;
  /** NAVLOOK 2a: the finger slid on from the eye: a temporary Look, ended with it. */
  readonly temp: boolean;
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

const LABEL: Record<NavMode, string> = { move: 'Move the camera: hold and drag', look: 'Look around: hold and drag' };

/** The knob's glyph, the mode's cue that is no colour: a four-way cross for Move, a turning arrow for Look. */
function Glyph({ mode }: { mode: NavMode }) {
  return (
    <svg class="nav-hat__glyph" data-glyph={mode} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {mode === 'move' ? (
        <path d="M12 4v16M4 12h16M9 7l3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3" />
      ) : (
        <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" />
      )}
    </svg>
  );
}

export function NavHat({ jog }: { jog: JogTarget }) {
  const drive = useRef<Drive | null>(null);
  const node = useRef<HTMLDivElement>(null);
  /** 3b: when the last still, short tap lifted (ms), waiting for its pair; null: none waiting. */
  const lastTap = useRef<number | null>(null);
  const latched = useNavMode((s) => s.latched);
  const temp = useNavMode((s) => s.temp);
  const look = jog.look;
  const mode: NavMode = look && (temp || latched === 'look') ? 'look' : 'move';

  // withdrawn mid-drag (the case gone): no lift will come, so the drive it started stops here, and a slide's Look ends
  useEffect(
    () => () => {
      const d = drive.current;
      drive.current = null;
      if (d?.on) d.target.stop();
      if (d?.temp) setTempLook(false);
    },
    [],
  );

  const toggle = () => {
    toggleNavMode();
    hapticLight();
  };

  const begin = (id: number, x: number, y: number, temp: boolean) => {
    // the store's mode now, not the last render's: a tap on the eye just before this press counts
    const target = look && (temp || navModeNow() === 'look') ? look : jog;
    drive.current = { id, x0: x, y0: y, t0: Date.now(), target, max: jog.max, temp, moved: false, on: false, band: 0 };
  };

  const end = (e: PointerEvent) => {
    const d = drive.current;
    if (!d || d.id !== e.pointerId) return;
    // (a lost capture that bubbled up from the eye is the eye's)
    if (e.type === 'lostpointercapture' && e.target !== e.currentTarget) return;
    drive.current = null;
    // the spring back to the centre
    const el = e.currentTarget as HTMLElement;
    delete el.dataset.jogging;
    el.style.removeProperty('--hat-x');
    el.style.removeProperty('--hat-y');
    if (d.on) d.target.stop();
    if (d.temp) setTempLook(false);
    // 3b: a short press that never left the dead zone is a tap; a second within the gap of the first's lift toggles
    const now = Date.now();
    const tap = e.type === 'pointerup' && !d.moved && !d.temp && look !== undefined && now - d.t0 <= HAT_DOUBLE_TAP.tapMs;
    if (!tap) lastTap.current = null;
    else if (lastTap.current !== null && d.t0 - lastTap.current <= HAT_DOUBLE_TAP.gapMs) {
      lastTap.current = null;
      toggle();
    } else lastTap.current = now;
  };

  /** NAVLOOK 2a: the eye's finger has slid onto the hat: it is the hat's now (its capture), a Look from where it came on. */
  const adopt = (e: PointerEvent): boolean => {
    const el = node.current;
    if (drive.current || !el) return false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured */
    }
    lastTap.current = null;
    begin(e.pointerId, e.clientX, e.clientY, true);
    setTempLook(true);
    return true;
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (drive.current) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer cannot be captured */
      }
      begin(e.pointerId, e.clientX, e.clientY, false);
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drive.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      const reach = Math.hypot(dx, dy);
      const el = e.currentTarget as HTMLElement;
      if (!d.moved) {
        if (reach <= JOG_DEAD_PX) return;
        d.moved = true;
        d.on = d.target.start();
        if (!d.on) return;
        el.dataset.jogging = '';
        hapticLight();
        // the start's tick stands for any detent its first move is already past
        d.band = detentBand(reach, 0, d.max);
      }
      if (!d.on) return;
      d.target.aim(dx, dy);
      // NAV-2B: a light tick each time the speed passes a detent, out or back (one for a move past several)
      const band = detentBand(reach, d.band, d.max);
      if (band !== d.band) {
        d.band = band;
        hapticLight();
      }
      // the knob shows the reach over the ring: the thumb's way, full at JOG_FULL_PX (a drive is always past the dead zone)
      const k = Math.min(reach, JOG_FULL_PX) / JOG_FULL_PX / reach;
      el.style.setProperty('--hat-x', String(dx * k));
      el.style.setProperty('--hat-y', String(dy * k));
    },
    onPointerUp: end,
    onPointerCancel: end,
    // the capture lost mid-drag (the browser or a script released it): no lift will reach the hat, so it stops here
    onLostPointerCapture: end,
  };

  return (
    <div ref={node} class="nav-hat" data-nav="hat" data-mode={mode} role="group" aria-label={LABEL[mode]} {...handlers}>
      {ARROWS.map(([deg, points]) => (
        <svg key={deg} class={`nav-hat__arrow nav-hat__arrow--${deg}`} data-deg={deg} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points={points} />
        </svg>
      ))}
      <span class="nav-hat__knob" aria-hidden="true">
        <Glyph mode={mode} />
      </span>
      {look && <NavEye pressed={latched === 'look'} held={temp} onToggle={toggle} onSlide={adopt} />}
    </div>
  );
}
