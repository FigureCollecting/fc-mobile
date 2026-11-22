/**
 * NAV-FLOAT (handoff FINAL 11-17): the case's two floating controls: the left Z rail (NavDepth) and the right XY hat
 * (NavHat), where the centre cluster was (the depth rocker in the tabs' Reserved slot and the tab bar's raised + as the
 * jog). Shown only while a Free camera case offers its jog (stores/jog). They sit in document.body, like the case tabs:
 * the scene never sees a pointer of theirs, so two thumbs on the two controls are never its pinch. Their wrapper has
 * no box; only the hat's circle and the rail's box, each fixed by itself, take a touch: a figure beside either is tapped.
 * They float lower-left and lower-right, above the pull-up tabs and inside the safe area, over the column the case is in
 * (`within`: beside an open Info pane the hat stays over the case). Drawn in one subdued blue, largely transparent at
 * rest (navTuning), with no backdrop-filter and no shadow: they composite over a scene near its GPU budget.
 */
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { useJogStore } from '../../stores/jog';
import { Style } from '../../styles/Style';
import { CASE_TABS_HEIGHT_PX } from './CaseTabs';
import { NavDepth } from './NavDepth';
import { NavHat } from './NavHat';
import { DEPTH_RAIL_PX, EYE_SLOT_DEG, EYE_SLOT_PX, HAT_KNOB_PX, HAT_RING_PX, NAV_BLUE, NAV_CHIP_GAP_PX, NAV_EDGE_PX, NAV_LIFT_PX, NAV_MOUSE_SCALE, NAV_OPACITY } from './navTuning';

interface FloatingNavProps {
  /** The column the case is drawn in: the controls keep inside its left and right edges. Absent: the window's. */
  within?: RefObject<HTMLElement>;
  /**
   * A card or list of the page's own lies over the case (the View card, the do-not-fit list): the controls go while it does, or
   * they would float over it (they are in document.body, above the page) and take its touches. A drive held then stops.
   */
  hidden?: boolean;
}

export function FloatingNav({ within, hidden = false }: FloatingNavProps) {
  const offered = useJogStore((s) => s.target);
  const target = hidden ? null : offered;
  const layer = useRef<HTMLDivElement>(null);
  const shown = target !== null;

  // the column's insets from the window's sides, kept as it resizes (the Info pane opening beside it) and as the window does;
  // and the hat's ring, chosen by the column's SHORTER side: a wide but short scene (the cover held sideways, the open
  // panel) keeps the compact ring, which lies over fewer of its figures. On the page's root, where the scene's own chips
  // read --hat-size too.
  useLayoutEffect(() => {
    const column = within?.current;
    const node = layer.current;
    if (!shown || !column || !node) return;
    const root = document.documentElement;
    const place = () => {
      const box = column.getBoundingClientRect();
      node.style.setProperty('--nav-left', `${Math.max(0, box.left)}px`);
      node.style.setProperty('--nav-right', `${Math.max(0, root.clientWidth - box.right)}px`);
      const ring = Math.min(box.width, box.height) >= HAT_RING_PX.wideFrom ? HAT_RING_PX.wide : HAT_RING_PX.compact;
      root.style.setProperty('--hat-ring', `${ring}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      root.style.removeProperty('--hat-ring');
    };
  }, [shown, within]);

  if (target === null) return null;
  return createPortal(
    <div class="floating-nav" ref={layer} role="region" aria-label="Camera controls">
      {target.depth && <NavDepth depth={target.depth} />}
      <NavHat jog={target} />
      <Style css={styles} />
    </div>,
    document.body,
  );
}

const hsl = (alpha: number) => `hsl(${NAV_BLUE} / ${alpha})`;
const rail = DEPTH_RAIL_PX;
/** The rail's larger target reaches this far (px) round what is drawn: at its sides, and above and below. */
const RAIL_PAD_X = (rail.hitWidth - rail.width) / 2;
const RAIL_PAD_Y = (rail.hitHeight - rail.height) / 2;
/** The eye's slot, centred on the ring at EYE_SLOT_DEG: its centre as a share of the hat's box. */
const EYE_AT = { x: 50 + 50 * Math.cos((EYE_SLOT_DEG * Math.PI) / 180), y: 50 - 50 * Math.sin((EYE_SLOT_DEG * Math.PI) / 180) };

const styles = `
  :root {
    --nav-k: 1;
    --hat-size: calc(var(--hat-ring, ${HAT_RING_PX.compact}px) * var(--nav-k));
    --hat-reach: calc((var(--hat-size) - ${HAT_KNOB_PX}px * var(--nav-k)) / 2);
    --nav-base: calc(var(--bottom-nav-height) + var(--safe-area-bottom, 0px) + ${CASE_TABS_HEIGHT_PX}px + ${NAV_LIFT_PX}px);
  }
  @media (hover: hover) and (pointer: fine) {
    :root { --nav-k: ${NAV_MOUSE_SCALE}; }
  }
  /* no box of its own: each control is fixed by itself, so nothing lies across the scene between them (a box over the
     whole scene changed what Chromium drew of the 3D scene under it: e2e/case-depth-occl) and no touch can land on it */
  .floating-nav {
    display: contents;
    --nav-fill: ${hsl(NAV_OPACITY.fill)};
    --nav-line: ${hsl(NAV_OPACITY.line)};
    --nav-knob: ${hsl(NAV_OPACITY.knob)};
    --nav-active: ${hsl(NAV_OPACITY.active)};
  }
  /* will-change: each control is a compositing layer of its own, the size of its box; without it Chromium squashed the
     hat, the rail and the pull-up tabs into one layer the width of the screen, from the rail's top down to the tab bar */
  .nav-hat {
    position: fixed;
    z-index: 98;
    will-change: transform;
    right: calc(max(var(--safe-area-right, 0px), var(--nav-right, 0px)) + ${NAV_EDGE_PX}px);
    bottom: var(--nav-base);
    width: var(--hat-size);
    height: var(--hat-size);
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--nav-fill);
    border: 1.5px solid var(--nav-line);
    color: var(--nav-knob);
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .nav-hat__arrow { position: absolute; pointer-events: none; }
  .nav-hat__arrow--0 { right: 4px; top: calc(50% - 8px); }
  .nav-hat__arrow--90 { top: 4px; left: calc(50% - 8px); }
  .nav-hat__arrow--180 { left: 4px; top: calc(50% - 8px); }
  .nav-hat__arrow--270 { bottom: 4px; left: calc(50% - 8px); }
  .nav-hat__knob {
    position: absolute;
    left: calc(50% - ${HAT_KNOB_PX / 2}px * var(--nav-k));
    top: calc(50% - ${HAT_KNOB_PX / 2}px * var(--nav-k));
    width: calc(${HAT_KNOB_PX}px * var(--nav-k));
    height: calc(${HAT_KNOB_PX}px * var(--nav-k));
    border-radius: 50%;
    background: var(--nav-knob);
    pointer-events: none;
    transform: translate(calc(var(--hat-x, 0) * var(--hat-reach)), calc(var(--hat-y, 0) * var(--hat-reach)));
  }
  .nav-hat[data-jogging] .nav-hat__knob { background: var(--nav-active); }
  .nav-hat__eye-slot {
    position: absolute;
    left: calc(${EYE_AT.x.toFixed(3)}% - ${EYE_SLOT_PX / 2}px);
    top: calc(${EYE_AT.y.toFixed(3)}% - ${EYE_SLOT_PX / 2}px);
    width: ${EYE_SLOT_PX}px;
    height: ${EYE_SLOT_PX}px;
    pointer-events: none;
  }
  .nav-depth {
    position: fixed;
    z-index: 98;
    will-change: transform;
    left: calc(max(var(--safe-area-left, 0px), var(--nav-left, 0px)) + ${NAV_EDGE_PX}px - ${RAIL_PAD_X}px * var(--nav-k));
    bottom: calc(var(--nav-base) - ${RAIL_PAD_Y}px * var(--nav-k));
    width: calc(${rail.hitWidth}px * var(--nav-k));
    height: calc(${rail.hitHeight}px * var(--nav-k));
    color: var(--nav-knob);
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .nav-depth::before {
    content: '';
    position: absolute;
    inset: calc(${RAIL_PAD_Y}px * var(--nav-k)) calc(${RAIL_PAD_X}px * var(--nav-k));
    box-sizing: border-box;
    border-radius: var(--radius-full);
    background: var(--nav-fill);
    border: 1.5px solid var(--nav-line);
  }
  .nav-depth__knob {
    position: absolute;
    left: calc(50% - ${rail.knob / 2}px * var(--nav-k));
    top: calc(50% - ${rail.knob / 2}px * var(--nav-k));
    width: calc(${rail.knob}px * var(--nav-k));
    height: calc(${rail.knob}px * var(--nav-k));
    border-radius: 50%;
    background: var(--nav-knob);
    pointer-events: none;
    transform: translateY(calc(var(--depth-k, 0) * ${rail.travel}px * var(--nav-k)));
  }
  .nav-depth[data-rocking] .nav-depth__knob { background: var(--nav-active); }
  .nav-depth__end { position: absolute; left: calc(50% - 7px); pointer-events: none; }
  .nav-depth__end--start { top: calc(${RAIL_PAD_Y}px * var(--nav-k) + 2px); }
  .nav-depth__end--end { bottom: calc(${RAIL_PAD_Y}px * var(--nav-k) + 2px); }
  /* the scene's own low chips (Reset view, the do-not-fit chip) stand inboard of the two controls while they float */
  .cabinet-scene .cabinet-scene__reset { right: calc(var(--safe-area-right, 0px) + ${NAV_EDGE_PX}px + var(--hat-size) + ${NAV_CHIP_GAP_PX}px); }
  .cabinet-scene .cabinet-scene__misfit { left: calc(var(--safe-area-left, 0px) + ${NAV_EDGE_PX}px + ${rail.width + RAIL_PAD_X}px * var(--nav-k) + ${NAV_CHIP_GAP_PX}px); }
`;
