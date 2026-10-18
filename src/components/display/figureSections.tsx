import type { ComponentChildren } from 'preact';
import { SideRail, type RailItem } from '../ui/SideRail';

/**
 * SIDE-RAIL-1 (Ross 10-18): the figure (Info) card's sections stand on one right rail, the same in the full-screen
 * viewer's sheet and the Fold-open pane. The registry fixes their order and their slots: Photos (GAL1) and Stores
 * (prices by store, after ER-1b) have theirs and no content yet, so they are not drawn until `ready` says their content
 * is there; Details and Copies are the card's today.
 */
export interface FigureSection {
  id: 'details' | 'photos' | 'copies' | 'stores';
  label: string;
  /** Its content exists: only then does the rail draw it. */
  ready: boolean;
}

export const FIGURE_SECTIONS: readonly FigureSection[] = [
  { id: 'details', label: 'Details', ready: true },
  { id: 'photos', label: 'Photos', ready: false },
  { id: 'copies', label: 'Copies', ready: true },
  { id: 'stores', label: 'Stores', ready: false },
];

export const readySections = (): FigureSection[] => FIGURE_SECTIONS.filter((s) => s.ready);

const ICON = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' } as const;

/** One icon per section that has content (a section gets its icon when its content is built). */
const ICONS: Partial<Record<FigureSection['id'], ComponentChildren>> = {
  details: (
    <svg {...ICON}>
      <path d="M4 5.5h12M4 10h12M4 14.5h7" />
    </svg>
  ),
  copies: (
    <svg {...ICON}>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  ),
};

interface FigureRailProps {
  /** Its fields show (the sheet at all of its detent, or the pane). */
  detailsOpen: boolean;
  onDetails: () => void;
  /** The figure's way to its full page (copies and actions); null for a figure with no local item. */
  onCopies: (() => void) | null;
  class?: string;
}

export function FigureRail({ detailsOpen, onDetails, onCopies, class: className }: FigureRailProps) {
  const items: RailItem[] = readySections().map((s) => ({ id: s.id, label: s.label, icon: ICONS[s.id], disabled: s.id === 'copies' && onCopies === null }));
  return (
    <SideRail
      label="Figure sections"
      class={className}
      items={items}
      current={detailsOpen ? 'details' : null}
      onSelect={(id) => {
        if (id === 'details') onDetails();
        else if (id === 'copies') onCopies?.();
      }}
    />
  );
}
