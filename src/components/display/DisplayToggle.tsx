import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import { DENSITIES } from './density';
import type { Density } from './density';
import type { LayoutMode } from '../../hooks/useFigureListParams';
import { Style } from '../../styles/Style';

interface DisplayToggleProps {
  layout: LayoutMode;
  density: Density;
  /** Nameplate overlay toggle — defaults off. */
  labels?: boolean;
  onLayout: (layout: LayoutMode) => void;
  onDensity: (density: Density) => void;
  onLabels?: (labels: boolean) => void;
}

const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  gallery: 'Gallery',
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

/** The case button's icon: a wall of cabinets side by side. */
function CaseIcon() {
  return (
    <svg {...ICON} stroke-linejoin="round">
      <rect x="1" y="2" width="4" height="12" rx="0.5" />
      <rect x="6" y="2" width="4" height="12" rx="0.5" />
      <rect x="11" y="2" width="4" height="12" rx="0.5" />
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
 * other mode switches to it; a tap on Tiles while it shows opens a small menu of its densities, the
 * current one ticked. The Tiles icon is its current density.
 *
 * NAV-2A2 (Ross 11-04): no swipe-mode button (CAM1's) on either camera: one finger moves the camera.
 * NAV-SCOPE (Ross 11-18): the case has one continuous view, so Case is a plain mode button: no views menu.
 */
export function DisplayToggle({
  layout,
  density,
  labels = false,
  onLayout,
  onDensity,
  onLabels,
}: DisplayToggleProps) {
  const [menu, setMenu] = useState<'rows' | null>(null);
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
    if (mode !== layout) {
      setMenu(null);
      onLayout(mode);
    } else if (mode === 'rows') setMenu(menu === 'rows' ? null : 'rows');
  };

  // the Tiles button names its density and, while the tiles show, opens their menu; the Case button is the mode alone
  const modeButton = (mode: LayoutMode, label: string, icon: ComponentChildren) => (
    <button
      class={`display-toggle__btn ${layout === mode ? 'display-toggle__btn--active' : ''}`}
      type="button"
      data-mode={mode}
      aria-label={label}
      aria-pressed={layout === mode}
      {...(layout === mode && mode === 'rows' ? { 'aria-haspopup': 'menu', 'aria-expanded': menu === mode } : {})}
      onClick={() => tapMode(mode)}
    >
      {icon}
    </button>
  );

  return (
    <div class="display-toggle" ref={root}>
      <div class="display-toggle__group" role="group" aria-label="Display mode">
        {modeButton('case', 'Case', <CaseIcon />)}
        {modeButton('rows', `Tiles, ${DENSITY_LABEL[density]}`, <TilesIcon density={density} />)}
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
        <div class="display-toggle__menu" role="menu" aria-label="Tiles views">
          {DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitemradio"
              aria-checked={d === density}
              class="display-toggle__item"
              onClick={() => {
                hapticLight();
                setMenu(null);
                onDensity(d);
              }}
            >
              {DENSITY_LABEL[d]}
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

        .display-toggle__cycle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
        }

        .display-toggle__cycle:active {
          background: var(--surface-tertiary);
          color: var(--text-primary);
        }

        .display-toggle__cycle--active {
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
