// The one place the app icon and the static splash get their art and numbers.
// scripts/generate-brand.mjs draws the PNG icons and writes the splash art
// into index.html from src/assets/brand/final-E.svg with these; the tests
// check the committed results against the same numbers.

/** The figure's share of the icon height at scale 1 (302 px of 512 in the first icons). */
export const ICON_BASE_FIGURE_FRACTION = 0.59;
/** Where the figure's bounding box is centred, as fractions of the icon (a little low: the plinth is the heavy end). */
export const ICON_FIGURE_CENTER = { x: 0.5, y: 0.5127 };
/**
 * The ring the figure fills (Ross, 10-16: the 90 % mark, not the strict 80 % maskable one): the circle
 * of this radius, a fraction of the icon size, about the icon's centre. iconFigureScale finds the scale.
 */
export const ICON_RING_RADIUS = 0.45;
export const ICON_BG = '#14161a';
export const ICON_FG = '#eeece6';
export const ICON_SIZES = [180, 192, 512];

/** The figure's height as a fraction of the icon height, `scale` times that of the first icons. */
export const iconFigureFraction = (scale: number): number => ICON_BASE_FIGURE_FRACTION * scale;

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

export type Point = [number, number];

/** Points along the outline of an absolute M/C/Z path (vtracer's): each move, and each cubic at `steps` even steps. */
export function outlinePoints(d: string, steps = 16): Point[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Point[] = [];
  let at: Point = [0, 0];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++] as string;
    if (command === 'M') {
      at = [num(), num()];
      points.push(at);
    } else if (command === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      const [x0, y0] = at;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        points.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3]);
      }
      at = [x3, y3];
    } else if (command !== 'Z') {
      throw new Error(`path command ${command}: only absolute M, C and Z are read`);
    }
  }
  return points;
}

/** The box around points. */
export function boundsOf(points: readonly Point[]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The largest share of a square icon's height the box `bbox` can take, centred on `centre` (fractions of
 * the icon) as figureLayout puts it, with every point inside the circle of `radius` about the icon's centre.
 * A point p lands at centre + k (p - the box's centre), k = fraction / bbox.height; its distance to the
 * icon's centre grows with k past the one root of |d + k v| = radius, the smallest of which is the fit.
 */
export function ringFitFraction(points: readonly Point[], bbox: Box, centre: { x: number; y: number }, radius: number): number {
  const [dx, dy] = [centre.x - 0.5, centre.y - 0.5];
  const rest = dx * dx + dy * dy - radius * radius;
  if (rest >= 0) throw new Error('the centre is outside the ring');
  let k = Infinity;
  for (const [px, py] of points) {
    const [vx, vy] = [px - (bbox.x + bbox.width / 2), py - (bbox.y + bbox.height / 2)];
    const vv = vx * vx + vy * vy;
    if (vv === 0) continue;
    const dv = dx * vx + dy * vy;
    k = Math.min(k, (-dv + Math.sqrt(dv * dv - vv * rest)) / vv);
  }
  return k * bbox.height;
}

/** The figure's outline in the SVG's own canvas (its path's translate applied). */
export const figureOutline = (art: FigureArt): Point[] => outlinePoints(art.d).map(([x, y]): Point => [x + art.tx, y + art.ty]);

/** The scale (iconFigureFraction's) at which the figure's outline just fits inside ICON_RING_RADIUS, centred on ICON_FIGURE_CENTER. */
export function iconFigureScale(art: FigureArt): number {
  const outline = figureOutline(art);
  return ringFitFraction(outline, boundsOf(outline), ICON_FIGURE_CENTER, ICON_RING_RADIUS) / ICON_BASE_FIGURE_FRACTION;
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
