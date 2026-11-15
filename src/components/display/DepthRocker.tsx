/**
 * NAV-DEPTH-3 (Ross 11-13; NAV-ROCKER 11-14): the depth rocker, in the empty slot beside the hat. Spring-centred, a
 * speed and not a place: the finger's reach from where it went down, over DEPTH_FULL_PX, is r in [-1, 1] (+ closer),
 * the scene's depth drive (JogTarget's depth: depthStart, depthRate, depthStop). It starts once the reach leaves
 * DEPTH_DEAD, takes the reach at every move after (back inside the dead zone the drive moves nothing), and the lift, a
 * pointercancel, the capture lost or the drive's withdrawal springs it back to the centre and stops it. Vertical by default, rising above
 * the slot (up = closer); horizontal, a slider in the slot (toward the hat = closer). The press is the rocker's own
 * (pointer capture), so it drives with the hat's at once, each finger its own.
 */
import { useEffect, useRef } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import type { DepthDrive } from '../../stores/jog';
import { DEPTH_DEAD, DEPTH_FULL_PX } from './caseDepth';
import type { DepthRockerShape } from './casePrefs';
import { Style } from '../../styles/Style';

interface DepthRockerProps {
  depth: DepthDrive;
  shape: DepthRockerShape;
  /** Horizontal: which way the hat is from the slot (1: to its right, the default order's; -1: the sides swapped). */
  toward: 1 | -1;
}

interface Push {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly depth: DepthDrive;
  moved: boolean;
  on: boolean;
}

export function DepthRocker({ depth, shape, toward }: DepthRockerProps) {
  const push = useRef<Push | null>(null);
  const vertical = shape === 'vertical';

  // withdrawn mid-push (the case gone, the Free camera off): no lift will come, so the drive it started stops here
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
      push.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, depth, moved: false, on: false };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = push.current;
      if (!p || p.id !== e.pointerId) return;
      // the finger's travel along the rocker, + toward closer: up, or toward the hat
      const travel = vertical ? p.y0 - e.clientY : toward * (e.clientX - p.x0);
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
      // the knob shows the reach on screen: up is -1, left is -1
      (e.currentTarget as HTMLElement).style.setProperty('--depth-k', String(vertical ? -r : toward * r));
    },
    onPointerUp: end,
    onPointerCancel: end,
    // the capture lost mid-push (the browser or a script released it): no lift will reach the rocker, so it springs back here
    onLostPointerCapture: end,
  };

  // a chevron at each end, pointing out (up is closer; across, the end toward the hat is)
  const [first, last]: [Way, Way] = vertical ? ['up', 'down'] : ['left', 'right'];
  return (
    <div
      class={`depth-rocker depth-rocker--${shape}`}
      role="slider"
      aria-label={vertical ? 'Move closer or back: hold and push up or down' : 'Move closer or back: hold and slide toward the move button or away'}
      aria-orientation={shape}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      data-shape={shape}
      {...handlers}
    >
      <Chevron way={first} at="start" />
      <span class="depth-rocker__knob" aria-hidden="true" />
      <Chevron way={last} at="end" />
      <Style css={styles} />
    </div>
  );
}

type Way = 'up' | 'down' | 'left' | 'right';

const CHEVRON: Record<Way, string> = { up: '6 15 12 9 18 15', down: '6 9 12 15 18 9', left: '15 6 9 12 15 18', right: '9 6 15 12 9 18' };

function Chevron({ way, at }: { way: Way; at: 'start' | 'end' }) {
  return (
    <svg class={`depth-rocker__end depth-rocker__end--${at}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points={CHEVRON[way]} />
    </svg>
  );
}

/** How far (px) the knob travels each way at full reach: vertically the finger's own; in the slot, what its width leaves. */
const KNOB_TRAVEL_V = DEPTH_FULL_PX;
const KNOB_TRAVEL_H = 24;

const styles = `
  .depth-rocker {
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    position: absolute;
    bottom: 0;
    border-radius: var(--radius-full);
    background: var(--brand-500);
    color: rgba(255, 255, 255, 0.85);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
  }
  .depth-rocker[data-rocking] { background: var(--brand-600); }
  .depth-rocker--vertical { left: calc(50% - 22px); width: 44px; height: ${44 + 2 * KNOB_TRAVEL_V}px; }
  .depth-rocker--horizontal { left: 0; right: 0; height: 44px; }
  .depth-rocker__knob {
    position: absolute;
    left: calc(50% - 11px);
    top: calc(50% - 11px);
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.92);
    pointer-events: none;
  }
  .depth-rocker--vertical .depth-rocker__knob { transform: translateY(calc(var(--depth-k, 0) * ${KNOB_TRAVEL_V}px)); }
  .depth-rocker--horizontal .depth-rocker__knob { transform: translateX(calc(var(--depth-k, 0) * ${KNOB_TRAVEL_H}px)); }
  .depth-rocker__end { position: absolute; pointer-events: none; }
  .depth-rocker--vertical .depth-rocker__end { left: calc(50% - 8px); }
  .depth-rocker--vertical .depth-rocker__end--start { top: 4px; }
  .depth-rocker--vertical .depth-rocker__end--end { bottom: 4px; }
  .depth-rocker--horizontal .depth-rocker__end { top: calc(50% - 8px); }
  .depth-rocker--horizontal .depth-rocker__end--start { left: 2px; }
  .depth-rocker--horizontal .depth-rocker__end--end { right: 2px; }
`;
