import type { Figure } from '@figurecollecting/fc-shared';
import type { ListFilters } from '../hooks/useFigureListParams';

export interface FacetValue {
  value: string;
  count: number;
}

export type FacetKind = 'mfr' | 'dist' | 'scale' | 'origin' | 'cat' | 'type' | 'tag';

/** Scale synthesizes "Unspecified" for non-scale figures (desktop parity). */
export const UNSPECIFIED = 'Unspecified';

function facetValuesOf(figure: Figure, kind: FacetKind): string[] {
  switch (kind) {
    case 'mfr':
      return figure.manufacturer ? [figure.manufacturer] : [];
    case 'dist':
      return (figure.companyRoles ?? [])
        .filter((r) => r.roleName?.toLowerCase().includes('distrib') && r.companyName)
        .map((r) => r.companyName!) ;
    case 'scale':
      return [figure.scale && figure.scale !== '' ? figure.scale : UNSPECIFIED];
    case 'origin':
      return figure.origin ? [figure.origin] : [];
    case 'cat':
      // Missing category counts as the dominant default so the preselected
      // Prepainted chip never hides uncategorized figures.
      return [figure.category ?? 'Prepainted'];
    case 'type':
      return [figure.classification ?? 'Figures'];
    case 'tag':
      return figure.tags ?? [];
  }
}

/** Distinct values for a facet with counts, sorted by count desc then name. */
export function getFacet(figures: Figure[], kind: FacetKind): FacetValue[] {
  const counts = new Map<string, number>();
  for (const f of figures) {
    for (const v of facetValuesOf(f, kind)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function matchesList(figure: Figure, kind: FacetKind, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const values = facetValuesOf(figure, kind);
  return values.some((v) => selected.includes(v));
}

/**
 * Apply the full filter state to a figure list (client-side; the query/idb
 * layer stays the single source of figures — eventual-consistency friendly).
 */
export function applyFilters(figures: Figure[], filters: ListFilters): Figure[] {
  return figures.filter((f) => {
    if (filters.status.length > 0 && !filters.status.includes(f.collectionStatus ?? '')) {
      return false;
    }
    return (
      matchesList(f, 'mfr', filters.mfr) &&
      matchesList(f, 'dist', filters.dist) &&
      matchesList(f, 'scale', filters.scale) &&
      matchesList(f, 'origin', filters.origin) &&
      matchesList(f, 'cat', filters.cat) &&
      matchesList(f, 'type', filters.type) &&
      matchesList(f, 'tag', filters.tag)
    );
  });
}

/** Count of active filter selections beyond the defaults (for the badge). */
export function countActiveFilters(filters: ListFilters): number {
  return (
    filters.status.length +
    filters.mfr.length +
    filters.dist.length +
    filters.scale.length +
    filters.origin.length +
    filters.tag.length
  );
}
