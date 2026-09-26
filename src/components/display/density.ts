/**
 * Density presets — Compact is the default. These px values mirror the
 * --shelf-h / --row-h custom properties in tokens.css (the CSS side handles
 * pure-CSS consumers; the JS side feeds layout math that needs numbers).
 */
export type Density = 'comfortable' | 'compact' | 'gallery';

export const DENSITIES: Density[] = ['comfortable', 'compact', 'gallery'];

export const DEFAULT_DENSITY: Density = 'compact';

/**
 * Virtual case: figure band height (px) per shelf. Compact is tuned so a
 * 360px phone viewport packs ~3 figures per shelf (was ~2 at the old 168px
 * band) — verified against the dev-fixture aspect/relHeight distribution.
 */
export const SHELF_BAND: Record<Density, number> = {
  comfortable: 216,
  compact: 115,
  gallery: 126,
};

/** Justified rows: base row height (px). */
export const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 172,
  compact: 132,
  gallery: 98,
};

export function isDensity(value: string | null | undefined): value is Density {
  return value === 'comfortable' || value === 'compact' || value === 'gallery';
}
