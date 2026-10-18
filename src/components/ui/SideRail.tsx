import type { ComponentChildren } from 'preact';
import { Style } from '../../styles/Style';

/**
 * SIDE-RAIL-1 (Ross 10-17, 10-18): frequent selections live on a RIGHT-side rail, never along the top, where an Android
 * notification banner can land under the tap and take it to another app. About 24 px in from the screen edge so the
 * back-swipe never fires; stacked icon over a short label, never sideways text.
 */

/** How far in from the screen edge the rail stands (the back-swipe gesture lives in the outer edge). */
export const RAIL_INSET_PX = 24;
/** The rail's width: the room a page leaves beside it is this plus RAIL_INSET_PX. */
export const RAIL_WIDTH_PX = 60;
/** One button's height, icon over label. */
export const RAIL_ITEM_HEIGHT_PX = 52;
const RAIL_GAP_PX = 6;

/** The height of a rail of `count` buttons: they and the gaps between them. */
export function railHeightPx(count: number): number {
  return count === 0 ? 0 : count * RAIL_ITEM_HEIGHT_PX + (count - 1) * RAIL_GAP_PX;
}

export interface RailItem {
  id: string;
  /** One short word. */
  label: string;
  icon: ComponentChildren;
  disabled?: boolean;
}

interface SideRailProps {
  /** What the rail is, for assistive technology. */
  label: string;
  items: readonly RailItem[];
  /** The item whose content shows now. */
  current?: string | null;
  onSelect: (id: string) => void;
  class?: string;
}

/** The rail itself: where it stands is its host's (`class`), which sets the inset from the edge. */
export function SideRail({ label, items, current = null, onSelect, class: className = '' }: SideRailProps) {
  return (
    <nav class={`side-rail ${className}`} aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          class="side-rail__item"
          aria-current={current === item.id ? 'true' : undefined}
          disabled={item.disabled === true}
          onClick={() => onSelect(item.id)}
        >
          {item.icon}
          <span class="side-rail__label">{item.label}</span>
        </button>
      ))}
      <Style css={`
        .side-rail {
          display: flex;
          flex-direction: column;
          gap: ${RAIL_GAP_PX}px;
          width: ${RAIL_WIDTH_PX}px;
        }

        .side-rail__item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          min-height: ${RAIL_ITEM_HEIGHT_PX}px;
          padding: 6px 2px;
          border-radius: var(--radius-md);
          background: color-mix(in srgb, var(--surface-primary) 70%, transparent);
          color: var(--text-secondary);
        }

        .side-rail__item[aria-current='true'] {
          color: var(--brand-400);
        }

        .side-rail__item:disabled {
          opacity: 0.45;
        }

        .side-rail__label {
          font-size: var(--font-xs);
          line-height: 1;
          font-weight: var(--font-weight-semibold, 600);
        }
      `} />
    </nav>
  );
}
