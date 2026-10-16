// The one place the app icon and the static splash get their art and numbers.
// scripts/generate-brand.mjs draws the PNG icons and writes the splash art
// into index.html from src/assets/brand/final-E.svg with these; the tests
// check the committed results against the same numbers.

/**
 * How much bigger the figure is drawn than in the first icons, which
 * had her at ICON_BASE_FIGURE_FRACTION of the icon height. 1.4 is about 83 % of the
 * height; 1.25 (74 %) is the alternative.
 */
export const ICON_FIGURE_SCALE = 1.4;
/** The figure's share of the icon height at scale 1 (302 px of 512 in the first icons). */
export const ICON_BASE_FIGURE_FRACTION = 0.59;
/** Where the figure's bounding box is centred, as fractions of the icon (a little low: the plinth is the heavy end). */
export const ICON_FIGURE_CENTER = { x: 0.5, y: 0.5127 };
export const ICON_BG = '#14161a';
export const ICON_FG = '#eeece6';
export const ICON_SIZES = [180, 192, 512];

/** The figure's height as a fraction of the icon height. */
export const iconFigureFraction = (scale: number = ICON_FIGURE_SCALE): number => ICON_BASE_FIGURE_FRACTION * scale;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The scale and translate that put a figure's box at `fraction` of a square icon's height, centred on `centre`. */
export function figureLayout(bbox: Box, size: number, fraction: number, centre: { x: number; y: number }): { scale: number; tx: number; ty: number } {
  const scale = (fraction * size) / bbox.height;
  return {
    scale,
    tx: centre.x * size - scale * (bbox.x + bbox.width / 2),
    ty: centre.y * size - scale * (bbox.y + bbox.height / 2),
  };
}

export interface FigureArt {
  d: string;
  tx: number;
  ty: number;
}

/** The single translated path of a vtracer SVG (final-E.svg). */
export function parseFigureArt(svg: string): FigureArt {
  const m = svg.match(/<path d="([^"]+)"[^>]*transform="translate\(([-\d.]+),\s*([-\d.]+)\)"/);
  if (m === null) throw new Error('expected one <path> with a translate transform');
  return { d: (m[1] as string).trim(), tx: Number(m[2]), ty: Number(m[3]) };
}

const round1 = (n: number): string => String(Math.round(n * 10) / 10 + 0);

/** Path data with every number rounded to one decimal (0.05 of a unit on an 800-unit figure). */
export function roundPathData(d: string): string {
  return d.replace(/-?\d+\.\d+/g, (n) => round1(Number(n))).replace(/\s+/g, ' ');
}

/** The inline <svg> for the static splash: no style attribute, so a CSP without 'unsafe-inline' allows it. */
export function splashArtMarkup(art: FigureArt, bbox: Box): string {
  const viewBox = [bbox.x, bbox.y, bbox.width, bbox.height].map(round1).join(' ');
  return `<svg class="pre-splash__art" viewBox="${viewBox}" fill="${ICON_FG}" aria-hidden="true" focusable="false"><path d="${roundPathData(art.d)}" transform="translate(${round1(art.tx)},${round1(art.ty)})"/></svg>`;
}
