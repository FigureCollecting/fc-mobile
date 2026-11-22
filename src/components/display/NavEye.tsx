/**
 * NAV-EYE (handoff FINAL 11-17 B, ref 02): the eye fused to the hat's upper-left, inboard shoulder. One tap (EYE_TAP:
 * little travel, quickly lifted) latches the hat Move <-> Look; Enter or Space on it does too. Its hit circle is its own
 * and lies over the hat's ring where they overlap: its press never reaches the hat under it. NAVLOOK 2a: pressed and
 * slid off it onto the hat, the hat takes the finger (`onSlide`) as a temporary Look until it lifts. A press that slides
 * anywhere else, or is held, is nothing.
 */
import { useRef } from 'preact/hooks';
import { EYE_TAP } from './navTuning';

interface Press {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly t0: number;
  travel: number;
}

interface NavEyeProps {
  /** Look is latched. */
  pressed: boolean;
  /** A temporary Look (the slide) has the hat. */
  held: boolean;
  /** The tap: Move <-> Look. */
  onToggle(): void;
  /** The finger has slid onto the hat, clear of the eye: the hat takes it (true) or is busy with another (false). */
  onSlide(e: PointerEvent): boolean;
}

/** Is (x, y) on the hat's disc and clear of the eye's own hit circle: where a slide from the eye becomes the hat's. */
function onHat(eye: HTMLElement, x: number, y: number): boolean {
  const h = eye.parentElement!.getBoundingClientRect();
  const e = eye.getBoundingClientRect();
  const inHat = Math.hypot(x - (h.left + h.width / 2), y - (h.top + h.height / 2)) <= h.width / 2;
  const inEye = Math.hypot(x - (e.left + e.width / 2), y - (e.top + e.height / 2)) <= e.width / 2;
  return inHat && !inEye;
}

export function NavEye({ pressed, held, onToggle, onSlide }: NavEyeProps) {
  const press = useRef<Press | null>(null);

  const mine = (e: PointerEvent) => {
    // the eye's pointers are its own: none reaches the hat it sits on
    e.stopPropagation();
    const p = press.current;
    return p !== null && p.id === e.pointerId ? p : null;
  };
  // a pointercancel or the capture lost (the browser's, or the hat's when it took the slide): no tap
  const drop = (e: PointerEvent) => {
    if (mine(e)) press.current = null;
  };

  return (
    <button
      type="button"
      class="nav-eye"
      data-nav="eye"
      aria-label="Look mode"
      aria-pressed={pressed ? 'true' : 'false'}
      data-held={held ? '' : undefined}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (press.current) return;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer cannot be captured */
        }
        press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Date.now(), travel: 0 };
      }}
      onPointerMove={(e) => {
        const p = mine(e);
        if (!p) return;
        p.travel = Math.max(p.travel, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
        if (onHat(e.currentTarget as HTMLElement, e.clientX, e.clientY) && onSlide(e)) press.current = null;
      }}
      onPointerUp={(e) => {
        const p = mine(e);
        if (!p) return;
        press.current = null;
        if (p.travel <= EYE_TAP.slopPx && Date.now() - p.t0 <= EYE_TAP.ms) onToggle();
      }}
      onPointerCancel={drop}
      onLostPointerCapture={drop}
      // a pointer's tap toggled at its lift; a keyboard's Enter or Space is a click with no pointer (detail 0)
      onClick={(e) => {
        e.stopPropagation();
        if (e.detail === 0) onToggle();
      }}
    >
      <svg class="nav-eye__glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}
