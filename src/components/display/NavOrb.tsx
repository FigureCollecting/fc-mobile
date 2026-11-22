/**
 * NAV-LOGPOSE (handoff FINAL 11-17 section 6; plan U8): the Log-Pose orb, small and detached above the left Z rail, the
 * switch for the optional fine Look by the device's tilt (useTiltLook). OFF every session (stores/tilt is never stored).
 * - A tap turns it ON or OFF; on iOS the first ON asks the motion permission inside that tap (askTilt), before anything
 *   is awaited. Recenter: a 500 ms hold, R, or the context menu (a mouse's right click), while ON.
 * - Shown only where a sensor gave a real sample (probeTilt, once a session); hidden where none did; shown disabled, with
 *   the reason, once the permission was refused or the sensor went silent: never a misleading ON.
 * - Drawn as Ross's reference (ross-1122/logpose-orb.png): a dark translucent dial with a thin teal outer ring, four
 *   small cardinal ticks, and a two-tone needle wholly inside it (a muted red half and a pale grey half, resting on the
 *   diagonal) on a teal pivot; no gold. OFF the ring is quiet; ON it is brighter and heavier with a soft glow, and the
 *   needle follows the offset (the CSSOM, never a style attribute). Its round target is larger than what is drawn; it is
 *   placed by FloatingNav's variables.
 */
import { useEffect, useRef } from 'preact/hooks';
import { Style } from '../../styles/Style';
import { hapticLight } from '../../utils/haptics';
import type { TiltDrive } from '../../stores/jog';
import { useTiltStore } from '../../stores/tilt';
import { askTilt, probeTilt } from '../../sensors/relativeOrientation';
import { useTiltLook, type TiltShown } from '../../sensors/useTiltLook';
import { DEPTH_RAIL_PX, NAV_EDGE_PX, NAV_OPACITY, ORB_GLOBE, ORB_NEEDLE, ORB_PALE, ORB_PX, ORB_RED, ORB_TEAL } from './navTuning';

/** A hold this long on the orb recenters it (plan section 3). */
export const ORB_RECENTER_MS = 500;

const LABEL = { off: 'Tilt to look: off', on: 'Tilt to look: on', denied: "Tilt to look isn't available on this device" } as const;
const REASON = 'Motion access was refused or the motion sensor stopped. On iPhone it is asked again once this site\'s data is cleared.';

export function NavOrb({ tilt }: { tilt: TiltDrive }) {
  const support = useTiltStore((s) => s.support);
  const on = useTiltStore((s) => s.on);
  const node = useRef<HTMLButtonElement>(null);
  const hold = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const swallow = useRef(false);

  useEffect(() => {
    if (useTiltStore.getState().support !== 'unknown') return;
    useTiltStore.setState({ support: 'probing' });
    void probeTilt().then((found) => useTiltStore.setState({ support: found }));
  }, []);

  const kind = support === 'sensor' || support === 'event' ? support : null;
  const show = (o: TiltShown) => {
    node.current?.style.setProperty('--orb-turn', String(o.yaw * ORB_NEEDLE.turnPerDeg));
    node.current?.style.setProperty('--orb-lift', String(-o.pitch * ORB_NEEDLE.liftPxPerDeg));
  };
  const { recenter } = useTiltLook(tilt, on, kind, show, () => useTiltStore.setState({ support: 'denied', on: false }));

  // a hold under way when the orb goes: its timer goes with it
  useEffect(() => () => clearTimeout(hold.current?.timer), []);

  if (support === 'unknown' || support === 'probing' || support === 'none') return null;
  const denied = support === 'denied';

  const toggle = () => {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    const st = useTiltStore.getState();
    if (st.support === 'denied') return;
    if (st.on) {
      useTiltStore.setState({ on: false });
      hapticLight();
      return;
    }
    if (st.support === 'ask') {
      // inside the click's own task, before any await: iOS grants only to a user activation
      const asked = askTilt();
      if (asked === null) useTiltStore.setState({ support: 'event', on: true });
      else void asked.then((ok) => useTiltStore.setState(ok ? { support: 'event', on: true } : { support: 'denied', on: false }));
      return;
    }
    useTiltStore.setState({ on: true });
    hapticLight();
  };
  const endHold = (e: PointerEvent) => {
    const h = hold.current;
    if (!h || h.id !== e.pointerId) return;
    clearTimeout(h.timer);
    hold.current = null;
  };

  return (
    <button
      ref={node}
      type="button"
      class="nav-orb"
      data-nav="orb"
      role="switch"
      aria-checked={on}
      aria-disabled={denied || undefined}
      aria-label={denied ? LABEL.denied : on ? LABEL.on : LABEL.off}
      aria-keyshortcuts="R"
      title={denied ? REASON : 'Tap: tilt to look on or off. Hold (or R): recenter.'}
      onClick={toggle}
      onPointerDown={(e) => {
        if (hold.current) return;
        hold.current = {
          id: e.pointerId,
          timer: setTimeout(() => {
            if (!useTiltStore.getState().on) return;
            swallow.current = true;
            recenter();
            hapticLight();
          }, ORB_RECENTER_MS),
        };
      }}
      onPointerUp={endHold}
      onPointerCancel={(e) => {
        endHold(e);
        swallow.current = false;
      }}
      onKeyDown={(e) => {
        if ((e.key === 'r' || e.key === 'R') && useTiltStore.getState().on) recenter();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (useTiltStore.getState().on) recenter();
      }}
    >
      <svg viewBox="0 0 34 34" aria-hidden="true">
        <circle class="nav-orb__glow" cx="17" cy="17" r="15.4" />
        <circle class="nav-orb__globe" cx="17" cy="17" r="15.4" />
        <circle class="nav-orb__bezel" cx="17" cy="17" r="12.6" />
        <circle class="nav-orb__ring" cx="17" cy="17" r="15.4" />
        <g class="nav-orb__ticks">
          <line x1="17" y1="5.6" x2="17" y2="8.4" />
          <line x1="17" y1="25.6" x2="17" y2="28.4" />
          <line x1="5.6" y1="17" x2="8.4" y2="17" />
          <line x1="25.6" y1="17" x2="28.4" y2="17" />
        </g>
        <g class="nav-orb__needle">
          <polygon class="nav-orb__north" points="17,6.6 18.9,17 15.1,17" />
          <polygon class="nav-orb__south" points="17,27.4 18.9,17 15.1,17" />
          <circle class="nav-orb__hub" cx="17" cy="17" r="2.1" />
        </g>
        <line class="nav-orb__off" x1="8" y1="26" x2="26" y2="8" />
      </svg>
      <Style css={styles} />
    </button>
  );
}

const rail = DEPTH_RAIL_PX;
const orb = ORB_PX;
/** The orb's round target, centred over the rail's drawn centre, its drawn bottom `gap` above the rail's drawn top. */
const LEFT = (rail.width - orb.hit) / 2;
const BOTTOM = rail.height + orb.gap - (orb.hit - orb.size) / 2;

const styles = `
  .nav-orb {
    position: fixed;
    z-index: 99;
    will-change: transform;
    left: calc(max(var(--safe-area-left, 0px), var(--nav-left, 0px)) + ${NAV_EDGE_PX}px + ${LEFT}px * var(--nav-k));
    bottom: calc(var(--nav-base) + ${BOTTOM}px * var(--nav-k));
    width: calc(${orb.hit}px * var(--nav-k));
    height: calc(${orb.hit}px * var(--nav-k));
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    display: grid;
    place-items: center;
    color: var(--nav-knob);
    pointer-events: auto;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  .nav-orb svg { width: calc(${orb.size}px * var(--nav-k)); height: calc(${orb.size}px * var(--nav-k)); overflow: hidden; }
  .nav-orb__glow { display: none; fill: none; stroke: hsl(${ORB_TEAL} / ${NAV_OPACITY.fill}); stroke-width: 2.4; }
  .nav-orb__globe { fill: hsl(${ORB_GLOBE} / ${NAV_OPACITY.knob}); }
  .nav-orb__bezel { fill: none; stroke: hsl(${ORB_GLOBE} / ${NAV_OPACITY.active}); stroke-width: 1.4; }
  .nav-orb__ring { fill: none; stroke: hsl(${ORB_TEAL} / ${NAV_OPACITY.line}); stroke-width: 1; }
  .nav-orb__ticks { stroke: hsl(${ORB_PALE} / ${NAV_OPACITY.knob}); stroke-width: 1.2; stroke-linecap: round; }
  .nav-orb__needle {
    transform-box: view-box;
    transform-origin: 17px 17px;
    transform: translateY(calc(var(--orb-lift, 0) * 1px)) rotate(calc(${ORB_NEEDLE.restDeg}deg + var(--orb-turn, 0) * 1deg));
  }
  .nav-orb__north { fill: hsl(${ORB_RED} / ${NAV_OPACITY.knob}); }
  .nav-orb__south { fill: hsl(${ORB_PALE} / ${NAV_OPACITY.knob}); }
  .nav-orb__hub { fill: hsl(${ORB_TEAL} / ${NAV_OPACITY.knob}); stroke: hsl(${ORB_PALE} / ${NAV_OPACITY.knob}); stroke-width: 0.7; }
  .nav-orb__off { display: none; stroke: hsl(${ORB_PALE} / ${NAV_OPACITY.knob}); stroke-width: 1.5; stroke-linecap: round; }
  /* ON: the ring brighter and thicker, with its soft glow (a non-colour cue too: the ring's weight), the needle fuller */
  .nav-orb[aria-checked='true'] .nav-orb__glow { display: inline; }
  .nav-orb[aria-checked='true'] .nav-orb__ring { stroke: hsl(${ORB_TEAL} / ${NAV_OPACITY.active}); stroke-width: 1.3; }
  .nav-orb[aria-checked='true'] .nav-orb__north { fill: hsl(${ORB_RED} / ${NAV_OPACITY.active}); }
  .nav-orb[aria-checked='true'] .nav-orb__south { fill: hsl(${ORB_PALE} / ${NAV_OPACITY.active}); }
  .nav-orb[aria-checked='true'] .nav-orb__hub { fill: hsl(${ORB_TEAL} / ${NAV_OPACITY.active}); }
  .nav-orb[aria-disabled='true'] .nav-orb__off { display: inline; }
  .nav-orb[aria-disabled='true'] .nav-orb__needle { opacity: 0.5; }
  .nav-orb:focus-visible { outline: 2px solid hsl(${ORB_TEAL}); outline-offset: -4px; }
`;
