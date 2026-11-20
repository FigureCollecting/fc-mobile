/**
 * NAV-FLOAT (handoff FINAL 11-17): the left Z, floating over the case (FloatingNav): the vertical depth rocker of
 * NAV-DEPTH-3 (Ross 11-13), shorter and narrower, in a larger box that takes the thumb. Spring-centred, a speed and not a
 * place: the finger's reach from where it went down, over DEPTH_FULL_PX, is r in [-1, 1] (+ closer: up), the scene's depth
 * drive (JogTarget's depth: depthStart, depthRate, depthStop). It starts once the reach leaves DEPTH_DEAD, takes the reach
 * at every move after (back inside the dead zone the drive moves nothing), and the lift, a pointercancel, the capture lost
 * or the drive's withdrawal springs it back to the centre and stops it. The press is the rail's own (pointer capture), so
 * it drives with the hat's at once, each finger its own. The horizontal slider (NAV-ROCKER b) is retired.
 */
import { useEffect, useRef } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import type { DepthDrive } from '../../stores/jog';
import { DEPTH_DEAD, DEPTH_FULL_PX } from './caseDepth';

interface Push {
  readonly id: number;
  readonly y0: number;
  readonly depth: DepthDrive;
  moved: boolean;
  on: boolean;
}

export function NavDepth({ depth }: { depth: DepthDrive }) {
  const push = useRef<Push | null>(null);

  // withdrawn mid-push (the case gone): no lift will come, so the drive it started stops here
  useEffect(
    () => () => {
      const p = push.current;
      push.current = null;
      if (p?.on) p.depth.stop();
    },
    [],
  );

  const end = (e: PointerEvent) => {
    const p = push.current;
    if (!p || p.id !== e.pointerId) return;
    push.current = null;
    // the spring back to the centre
    const node = e.currentTarget as HTMLElement;
    delete node.dataset.rocking;
    node.style.removeProperty('--depth-k');
    if (p.on) p.depth.stop();
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (push.current) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer cannot be captured */
      }
      push.current = { id: e.pointerId, y0: e.clientY, depth, moved: false, on: false };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = push.current;
      if (!p || p.id !== e.pointerId) return;
      // the finger's travel along the rail, + toward closer: up
      const travel = p.y0 - e.clientY;
      const r = Math.max(-1, Math.min(1, travel / DEPTH_FULL_PX));
      if (!p.moved) {
        if (Math.abs(travel) <= DEPTH_DEAD * DEPTH_FULL_PX) return;
        p.moved = true;
        p.on = p.depth.start(r);
        if (!p.on) return;
        (e.currentTarget as HTMLElement).dataset.rocking = '';
        hapticLight();
      } else if (p.on) p.depth.rate(r);
      else return;
      // the knob shows the reach on screen: up is -1
      (e.currentTarget as HTMLElement).style.setProperty('--depth-k', String(-r));
    },
    onPointerUp: end,
    onPointerCancel: end,
    // the capture lost mid-push (the browser or a script released it): no lift will reach the rail, so it springs back here
    onLostPointerCapture: end,
  };

  return (
    <div
      class="nav-depth"
      data-nav="depth"
      role="slider"
      aria-label="Move closer or back: hold and push up or down"
      aria-orientation="vertical"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      {...handlers}
    >
      <Chevron points="6 15 12 9 18 15" at="start" />
      <span class="nav-depth__knob" aria-hidden="true" />
      <Chevron points="6 9 12 15 18 9" at="end" />
    </div>
  );
}

/** A chevron at each end of the rail, pointing out (up is closer). */
function Chevron({ points, at }: { points: string; at: 'start' | 'end' }) {
  return (
    <svg class={`nav-depth__end nav-depth__end--${at}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
