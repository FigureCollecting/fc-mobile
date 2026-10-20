import type { ComponentChildren } from 'preact';
import { SideRail, type RailItem } from '../ui/SideRail';

/**
 * SIDE-RAIL-1 (Ross 10-18): the figure (Info) card's sections stand on one right rail, the same in the full-screen
 * viewer's sheet and the Fold-open pane. The registry fixes their order and their slots: Stores (prices by store, after
 * ER-1b) has its slot and no content yet, so it is not drawn until `ready` says its content is there; Details and Copies
 * are the card's today, and Photos (GAL1) opens the figure's photos (GALLERY-1).
 */
export interface FigureSection {
  id: 'details' | 'photos' | 'copies' | 'stores';
  label: string;
  /** Its content exists: only then does the rail draw it. */
  ready: boolean;
}

export const FIGURE_SECTIONS: readonly FigureSection[] = [
  { id: 'details', label: 'Details', ready: true },
  { id: 'photos', label: 'Photos', ready: true },
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
  photos: (
    <svg {...ICON}>
      <rect x="3.5" y="5.5" width="13" height="10" rx="1.5" />
      <circle cx="10" cy="10.5" r="2.6" />
      <path d="M7.5 5.5l.8-1.5h3.4l.8 1.5" />
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
  /** GALLERY-1: opens the figure's photos; null for a figure with no local item (no product to list photos of). */
  onPhotos: (() => void) | null;
  /** The figure's way to its full page (copies and actions); null for a figure with no local item. */
  onCopies: (() => void) | null;
  class?: string;
}

export function FigureRail({ detailsOpen, onDetails, onPhotos, onCopies, class: className }: FigureRailProps) {
  const items: RailItem[] = readySections().map((s) => ({ id: s.id, label: s.label, icon: ICONS[s.id], disabled: (s.id === 'copies' && onCopies === null) || (s.id === 'photos' && onPhotos === null) }));
  return (
    <SideRail
      label="Figure sections"
      class={className}
      items={items}
      current={detailsOpen ? 'details' : null}
      onSelect={(id) => {
        if (id === 'details') onDetails();
        else if (id === 'photos') onPhotos?.();
        else if (id === 'copies') onCopies?.();
      }}
    />
  );
}
