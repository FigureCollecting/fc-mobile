import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import { DENSITIES } from './density';
import type { Density } from './density';
import type { CaseView, SwipeMode } from './casePrefs';
import type { LayoutMode } from '../../hooks/useFigureListParams';
import { Style } from '../../styles/Style';

interface DisplayToggleProps {
  layout: LayoutMode;
  density: Density;
  /** The case's view (whole cabinets, one cabinet, one shelf). */
  caseView: CaseView;
  /** What a swipe does in the case (CAM1): pans the wall or moves the camera. */
  swipe?: SwipeMode;
  /** Nameplate overlay toggle — defaults off. */
  labels?: boolean;
  onLayout: (layout: LayoutMode) => void;
  onDensity: (density: Density) => void;
  onCaseView: (view: CaseView) => void;
  /** The case's swipe-mode button is shown only where this is given. */
  onSwipe?: (swipe: SwipeMode) => void;
  onLabels?: (labels: boolean) => void;
}

const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  gallery: 'Gallery',
};

const CASE_VIEWS: readonly CaseView[] = ['wall', 'cabinet', 'shelf'];
const CASE_VIEW_LABEL: Record<CaseView, string> = {
  wall: 'Whole cabinets',
  cabinet: 'One cabinet',
  shelf: 'One shelf',
};

const SWIPES: readonly SwipeMode[] = ['pan', 'camera'];
const SWIPE_LABEL: Record<SwipeMode, string> = {
  pan: 'Pan the wall',
  camera: 'Move the camera',
};

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'aria-hidden': 'true',
} as const;

/** The case button's icon: the view it shows. */
function CaseIcon({ view }: { view: CaseView }) {
  if (view === 'wall') {
    return (
      <svg {...ICON} stroke-linejoin="round">
        <rect x="1" y="2" width="4" height="12" rx="0.5" />
        <rect x="6" y="2" width="4" height="12" rx="0.5" />
        <rect x="11" y="2" width="4" height="12" rx="0.5" />
      </svg>
    );
  }
  if (view === 'cabinet') {
    return (
      <svg {...ICON} stroke-linejoin="round" stroke-linecap="round">
        <rect x="4" y="1.5" width="8" height="13" rx="0.5" />
        <path d="M4 6h8M4 10h8" />
      </svg>
    );
  }
  // one shelf with figures on it
  return (
    <svg {...ICON} stroke-linecap="round">
      <path d="M1.5 12.5h13" />
      <path d="M4.5 12.5v-4M8 12.5V6.5M11.5 12.5v-3" />
    </svg>
  );
}

/** The swipe button's icon: the mode it is in, four arrows (pan the wall) or a camera (move it). */
function SwipeIcon({ mode }: { mode: SwipeMode }) {
  if (mode === 'pan') {
    return (
      <svg {...ICON} stroke-linejoin="round" stroke-linecap="round">
        <path d="M8 1.5v13M1.5 8h13" />
        <path d="M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
      </svg>
    );
  }
  return (
    <svg {...ICON} stroke-linejoin="round" stroke-linecap="round">
      <path d="M2 5h2.2l1-1.6h5.6L11.8 5H14a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5v-7A.5.5 0 0 1 2 5Z" />
      <circle cx="8" cy="8.8" r="2.3" />
    </svg>
  );
}

/** The tiles button's icon: its density as a grid of one tile, four or nine. */
function TilesIcon({ density }: { density: Density }) {
  return (
    <svg {...ICON} stroke-linecap="round">
      {density === 'comfortable' && <rect x="2" y="2" width="12" height="12" rx="1" />}
      {density === 'compact' && <><rect x="2" y="2" width="5.5" height="5.5" rx="0.5" /><rect x="8.5" y="2" width="5.5" height="5.5" rx="0.5" /><rect x="2" y="8.5" width="5.5" height="5.5" rx="0.5" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="0.5" /></>}
      {density === 'gallery' && <><rect x="1.5" y="1.5" width="3.6" height="3.6" /><rect x="6.2" y="1.5" width="3.6" height="3.6" /><rect x="10.9" y="1.5" width="3.6" height="3.6" /><rect x="1.5" y="6.2" width="3.6" height="3.6" /><rect x="6.2" y="6.2" width="3.6" height="3.6" /><rect x="10.9" y="6.2" width="3.6" height="3.6" /><rect x="1.5" y="10.9" width="3.6" height="3.6" /><rect x="6.2" y="10.9" width="3.6" height="3.6" /><rect x="10.9" y="10.9" width="3.6" height="3.6" /></>}
    </svg>
  );
}

/**
 * The header's display controls (desk HDR, Ross decided (a) 10-14): exactly two mode buttons, Case and
 * Tiles, at fixed places that never move or grow, and the nameplate toggle beside them. A tap on the
 * other mode switches to it; a tap on the mode showing opens a small menu of its views (Case: whole
 * cabinets, one cabinet, one shelf; Tiles: its densities), the current one ticked. Each button's icon is
 * its mode's current view.
 *
 * CAM1 (Ross 10-18, a): on the case, just left of the two mode buttons, one more button: what a swipe does
 * (pan the wall or move the camera, exclusive), its icon the mode in force and a tap opening the same kind of
 * menu. It stands in the header, outside the zoom layer, so it works with the picture zoomed.
 */
export function DisplayToggle({
  layout,
  density,
  caseView,
  swipe = 'camera',
  labels = false,
  onLayout,
  onDensity,
  onCaseView,
  onSwipe,
  onLabels,
}: DisplayToggleProps) {
  const [menu, setMenu] = useState<LayoutMode | 'swipe' | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === null) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current!.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const tapMode = (mode: LayoutMode) => {
    hapticLight();
    if (mode === layout) setMenu(menu === mode ? null : mode);
    else {
      setMenu(null);
      onLayout(mode);
    }
  };

  const modeButton = (mode: LayoutMode, name: string, view: string, icon: ComponentChildren) => (
    <button
      class={`display-toggle__btn ${layout === mode ? 'display-toggle__btn--active' : ''}`}
      type="button"
      data-mode={mode}
      aria-label={`${name}, ${view}`}
      aria-pressed={layout === mode}
      {...(layout === mode ? { 'aria-haspopup': 'menu', 'aria-expanded': menu === mode } : {})}
      onClick={() => tapMode(mode)}
    >
      {icon}
    </button>
  );

  const items: readonly [string, string, boolean, () => void][] =
    menu === 'case'
      ? CASE_VIEWS.map((v) => [v, CASE_VIEW_LABEL[v], v === caseView, () => onCaseView(v)])
      : menu === 'swipe'
        ? SWIPES.map((m) => [m, SWIPE_LABEL[m], m === swipe, () => onSwipe?.(m)])
        : DENSITIES.map((d) => [d, DENSITY_LABEL[d], d === density, () => onDensity(d)]);
  const menuName = menu === 'case' ? 'Case views' : menu === 'swipe' ? 'Swipe modes' : 'Tiles views';

  return (
    <div class="display-toggle" ref={root}>
      {layout === 'case' && onSwipe && (
        <button
          class={`display-toggle__swipe ${menu === 'swipe' ? 'display-toggle__swipe--open' : ''}`}
          type="button"
          aria-label={`Swipe, ${SWIPE_LABEL[swipe]}`}
          aria-haspopup="menu"
          aria-expanded={menu === 'swipe'}
          onClick={() => {
            hapticLight();
            setMenu(menu === 'swipe' ? null : 'swipe');
          }}
        >
          <SwipeIcon mode={swipe} />
        </button>
      )}

      <div class="display-toggle__group" role="group" aria-label="Display mode">
        {modeButton('case', 'Case', CASE_VIEW_LABEL[caseView], <CaseIcon view={caseView} />)}
        {modeButton('rows', 'Tiles', DENSITY_LABEL[density], <TilesIcon density={density} />)}
      </div>

      <button
        class={`display-toggle__cycle ${labels ? 'display-toggle__cycle--active' : ''}`}
        type="button"
        aria-pressed={labels}
        aria-label={`Labels: ${labels ? 'on' : 'off'}`}
        title={`Labels: ${labels ? 'on' : 'off'}`}
        onClick={() => { hapticLight(); onLabels?.(!labels); }}
      >
        {/* small museum nameplate glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="6.5" width="12" height="6" rx="1" />
          <path d="M5 9h6" opacity="0.7" />
        </svg>
      </button>

      {menu !== null && (
        <div class="display-toggle__menu" role="menu" aria-label={menuName}>
          {items.map(([key, label, current, pick]) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={current}
              class="display-toggle__item"
              onClick={() => {
                hapticLight();
                setMenu(null);
                pick();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <Style css={`
        .display-toggle {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--space-1);
        }

        .display-toggle__group {
          display: flex;
          align-items: center;
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          padding: 2px;
          gap: 2px;
        }

        /* fixed size and place: the two never move or grow */
        .display-toggle__btn {
          flex: none;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 28px;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-tertiary);
          transition: color 150ms ease, background 150ms ease;
        }

        .display-toggle__btn--active {
          background: var(--surface-secondary);
          color: var(--brand-400);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .display-toggle__cycle,
        .display-toggle__swipe {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
        }

        .display-toggle__cycle:active,
        .display-toggle__swipe:active {
          background: var(--surface-tertiary);
          color: var(--text-primary);
        }

        .display-toggle__cycle--active,
        .display-toggle__swipe--open {
          background: var(--surface-tertiary);
          color: var(--brand-400);
        }

        .display-toggle__menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 150;
          display: flex;
          flex-direction: column;
          min-width: 172px;
          padding: var(--space-1);
          border-radius: var(--radius-md);
          background: var(--surface-secondary);
          border: 1px solid var(--border-subtle);
          box-shadow: var(--shadow-lg);
        }

        .display-toggle__item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          min-height: 40px;
          padding: 0 var(--space-3) 0 var(--space-2);
          border-radius: calc(var(--radius-md) - 2px);
          font-size: var(--font-sm);
          color: var(--text-primary);
          text-align: left;
        }

        .display-toggle__item[aria-checked='true'] {
          color: var(--brand-400);
        }

        /* the tick on the current view, drawn by CSS so the item's name is just the view */
        .display-toggle__item::before {
          content: '';
          width: 16px;
          text-align: center;
        }

        .display-toggle__item[aria-checked='true']::before {
          content: '\\2713';
        }
      `} />
    </div>
  );
}
