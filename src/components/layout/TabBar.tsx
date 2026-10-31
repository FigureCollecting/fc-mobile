import { useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { hapticLight } from '../../utils/haptics';
import { useChromeStore } from '../../stores/chrome';
import { useJogStore, type JogTarget } from '../../stores/jog';
import { JOG_DEAD_PX, jogDetents, jogSpeed } from '../display/casePose';
import { BottomSheet } from '../ui/BottomSheet';
import { LEGACY_SCREENS_ENABLED } from '../../config/features';
import { Style } from '../../styles/Style';

interface TabItem {
  path: string;
  label: string;
  icon: string;
}

/** 4-slot tab bar; the docked center Add action lives between slots 2 and 3. */
const LEFT_TABS: TabItem[] = [
  { path: '/', label: 'Collection', icon: 'grid' },
  { path: '/discover', label: 'Search', icon: 'search' },
];

const RIGHT_TABS: TabItem[] = [
  { path: '/stats', label: 'Stats', icon: 'stats' },
  { path: '/profile', label: 'Profile', icon: 'user' },
];

function TabIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? 'var(--brand-400)' : 'var(--text-tertiary)';
  switch (icon) {
    case 'grid':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'search':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'stats':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 20V10" />
          <path d="M12 20V4" />
          <path d="M6 20v-6" />
        </svg>
      );
    case 'user':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M5.5 21a8.5 8.5 0 0 1 13 0" />
        </svg>
      );
    default:
      return null;
  }
}

function Tab({ item }: { item: TabItem }) {
  const [location, setLocation] = useLocation();
  const active = location === item.path;
  return (
    <button
      class={`tab-bar__item ${active ? 'tab-bar__item--active' : ''}`}
      onClick={() => { hapticLight(); setLocation(item.path); }}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      type="button"
    >
      <span class="tab-bar__icon">
        <TabIcon icon={item.icon} active={active} />
      </span>
      <span class="tab-bar__label">{item.label}</span>
    </button>
  );
}

/** Center Add action sheet — routes into the existing add flows. */
function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const go = (path: string) => { onClose(); setLocation(path); };
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="add-sheet">
        <h2 class="add-sheet__title">Add figures</h2>
        {LEGACY_SCREENS_ENABLED && (
          <button class="add-sheet__option" type="button" onClick={() => go('/sync')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3" />
            </svg>
            <span>Sync from MFC</span>
          </button>
        )}
        <button class="add-sheet__option" type="button" onClick={() => go('/import')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Import your MFC export</span>
        </button>
        <button class="add-sheet__option" type="button" onClick={() => go('/discover')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6v12M8 6v12M11 6v12M15 6v12M19 6v12" />
          </svg>
          <span>Look up a barcode</span>
        </button>
        <Style css={`
          .add-sheet { display: flex; flex-direction: column; gap: var(--space-1); padding-bottom: var(--space-4); }
          .add-sheet__title {
            font-size: var(--font-base);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--space-2);
          }
          .add-sheet__option {
            display: flex; align-items: center; gap: var(--space-3);
            min-height: var(--touch-min);
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            font-size: var(--font-sm);
            color: var(--text-primary);
          }
          .add-sheet__option:active { background: var(--surface-tertiary); }
        `} />
      </div>
    </BottomSheet>
  );
}

/** NAV-JOG: how far (px) the knob follows the thumb from the button's centre: the jog's reach shown, not its speed. */
const KNOB_REACH_PX = 16;
/**
 * NAV-JOG: a click this soon (ms, by the events' own times) after a jog's lift is that drag's (a mouse raises one with
 * its up; a touch drag none); a later one is a click of its own (Enter, a switch) and opens the menu.
 */
const JOG_CLICK_MS = 100;
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

/**
 * NAV-JOG (Ross 10-28): the bottom-centre button as the jog on offer. A press that leaves JOG_DEAD_PX starts it (once),
 * aims it at the thumb's offset from where it went down at every move, and the lift or a pointercancel stops it; such a
 * drag makes no tap. A press that never leaves the dead zone is a tap: the button's click, the menu. The drag is the
 * button's own (pointer capture), so it crosses the tab bar's tabs and the case's tabs without pressing any.
 */
function useJogDrive(jog: JogTarget | null) {
  const drive = useRef<{ id: number; x0: number; y0: number; target: JogTarget; moved: boolean; on: boolean; band: number } | null>(null);
  /** When (the event's timeStamp) the last drag lifted; null: no drag since the last press or click. */
  const swallowed = useRef<number | null>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const end = (e: PointerEvent) => {
    const d = drive.current;
    if (!d || d.id !== e.pointerId) return;
    drive.current = null;
    swallowed.current = d.moved ? e.timeStamp : null;
    delete (e.currentTarget as HTMLElement).dataset.jogging;
    if (knob.current) knob.current.style.transform = '';
    if (d.on) d.target.stop();
  };
  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!jog || drive.current) return;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer cannot be captured */
      }
      swallowed.current = null;
      drive.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, target: jog, moved: false, on: false, band: 0 };
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drive.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      const reach = Math.hypot(dx, dy);
      if (!d.moved) {
        if (reach <= JOG_DEAD_PX) return;
        d.moved = true;
        d.on = d.target.start();
        if (!d.on) return;
        (e.currentTarget as HTMLElement).dataset.jogging = '';
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
      const k = Math.min(1, KNOB_REACH_PX / reach);
      if (knob.current) knob.current.style.transform = `translate(${Math.round(dx * k)}px, ${Math.round(dy * k)}px)`;
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
  /** Whether this click is a jog's lift (and so no tap): it comes within JOG_CLICK_MS of it; asked once per click. */
  const swallow = (e: MouseEvent) => {
    const at = swallowed.current;
    swallowed.current = null;
    return at !== null && e.timeStamp - at <= JOG_CLICK_MS;
  };
  return { handlers, knob, swallow };
}

const JOG_CSS = `
  .tab-bar__add--jog { touch-action: none; }
  .tab-bar__add--jog[data-jogging] { background: var(--brand-600); }
  .tab-bar__jog-knob {
    position: absolute;
    left: calc(50% - 7px);
    top: calc(50% - 7px);
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.92);
    pointer-events: none;
    opacity: 0;
  }
  .tab-bar__add--jog[data-jogging] .tab-bar__jog-knob { opacity: 1; }
`;

export function TabBar() {
  const hidden = useChromeStore((s) => s.hidden);
  const jog = useJogStore((s) => s.target);
  const [addOpen, setAddOpen] = useState(false);
  const drive = useJogDrive(jog);

  return (
    <>
      <nav
        class={`tab-bar ${hidden ? 'tab-bar--hidden' : ''}`}
        role="navigation"
        aria-label="Main navigation"
      >
        {LEFT_TABS.map((t) => <Tab key={t.path} item={t} />)}
        <div class="tab-bar__dock" aria-hidden="false">
          <button
            class={jog ? 'tab-bar__add tab-bar__add--jog' : 'tab-bar__add'}
            type="button"
            aria-label={jog ? 'Move the camera: hold and drag. Tap to add figures' : 'Add figures'}
            data-jog={jog ? '' : undefined}
            // (no jog on offer, a press starts nothing; a drive begun goes on to its lift though the jog is withdrawn)
            {...drive.handlers}
            onClick={(e) => {
              if (drive.swallow(e)) return;
              hapticLight();
              setAddOpen(true);
            }}
          >
            {jog ? (
              <>
                {/* NAV-JOG: the plus with an arrowhead on each arm: move, and still the Add button's plus */}
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="4" x2="12" y2="20" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <polyline points="9 7 12 4 15 7" />
                  <polyline points="9 17 12 20 15 17" />
                  <polyline points="7 9 4 12 7 15" />
                  <polyline points="17 9 20 12 17 15" />
                </svg>
                <span ref={drive.knob} class="tab-bar__jog-knob" aria-hidden="true" />
              </>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </button>
        </div>
        {RIGHT_TABS.map((t) => <Tab key={t.path} item={t} />)}

        <Style css={`
          .tab-bar {
            display: flex;
            align-items: stretch;
            height: calc(var(--bottom-nav-height) + var(--safe-area-bottom));
            padding-bottom: var(--safe-area-bottom);
            background: var(--surface-secondary);
            border-top: 1px solid var(--border-subtle);
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 100;
            transition: transform var(--transition-normal);
          }

          .tab-bar--hidden {
            transform: translateY(calc(100% + 16px));
          }

          .tab-bar__item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1px;
            min-height: var(--touch-min);
            position: relative;
          }

          .tab-bar__icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            position: relative;
          }

          .tab-bar__label {
            font-size: var(--font-2xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-tertiary);
            line-height: 1;
          }

          .tab-bar__item--active .tab-bar__label {
            color: var(--brand-400);
          }

          .tab-bar__dock {
            width: calc(var(--fab-size) + 12px);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
          }

          /* IC1-R2 (Ross 2026-10-09): the + is raised on every screen, between the case's pull-up tabs */
          .tab-bar__add {
            position: absolute;
            top: calc(var(--fab-size) / -1.25);
            width: var(--fab-size);
            height: var(--fab-size);
            border-radius: var(--radius-full);
            background: var(--brand-500);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
            transition: transform var(--transition-fast);
          }

          .tab-bar__add:active {
            transform: scale(0.94);
            background: var(--brand-600);
          }
        `} />
        {jog && <Style css={JOG_CSS} />}
      </nav>
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
