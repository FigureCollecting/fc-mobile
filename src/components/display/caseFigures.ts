/**
 * Where the case draws each figure (world mm), as both renderers draw it:
 * the classic CSS 3D scene (CabinetScene) and the canvas (gl/). Moved out of
 * CabinetScene unchanged (CASE-GL), so the two views match frame for frame.
 */
import type { Vec3 } from './caseCamera';
import type { FigureBox } from './caseCull';
import { clearInset, pictureBox, pictureOffsetMm, type FigureArt, type FigureImageRef, type PictureMargins } from './figureArt';
import type { AlphaMargins } from './alphaMargin';
import { FIGURE_GAP_MM, type PackedCabinet, type PlacedFigure, type SurfaceSlot, type WallLayout } from './packCabinets';

/** A nameplate's full width; a narrower figure's plate is its own width, so neighbours' plates never meet. */
export const PLATE_MAX_MM = 110;
/** A nameplate's height, hanging from the front edge of its figure's surface. */
export const PLATE_H_MM = 30;

export interface FigureDraw {
  readonly placed: PlacedFigure;
  readonly slot: SurfaceSlot;
  /** World x of the footprint's centre. */
  readonly cx: number;
}

/** Every placed figure of the packed cabinets, with the wall index of its cabinet and its footprint's centre on the wall. */
export function figureDraws(cabinets: readonly (PackedCabinet | null)[], wall: WallLayout): { draw: FigureDraw; cab: number }[] {
  const draws: { draw: FigureDraw; cab: number }[] = [];
  cabinets.forEach((cab, ci) => {
    if (!cab) return;
    const ws = wall.cabinets[ci];
    for (const surf of cab.surfaces) {
      const left = ws.centerMm - surf.slot.widthMm / 2;
      for (const placed of surf.items) {
        draws.push({ cab: ci, draw: { placed, slot: surf.slot, cx: left + placed.xMm + placed.item.widthMm / 2 } });
      }
    }
  });
  return draws;
}

/** A plate's aspect: a figure without a picture, or one whose picture is still being read. */
export const PLATE_ASPECT = 0.75;

/** Aspect of what the figure draws: the image's own when the list gives it, else the display meta's. */
export function artAspect(art: FigureArt, image: FigureImageRef | undefined, metaAspect: number): number {
  if (art.kind === 'plate') return PLATE_ASPECT;
  if (image?.width && image.height) return image.width / image.height;
  return metaAspect;
}

/** No picture alpha to read (framed, plate): nothing clear around the figure, known at once. */
export const OPAQUE: PictureMargins = { top: 0, bottom: 0 };

/**
 * The clear margins of what the case draws for a figure: the image list's
 * bottom when it gives one, the rest from the picture's alpha; null while
 * the alpha is still being read.
 */
export function pictureMargins(art: FigureArt, alpha: ReadonlyMap<string, AlphaMargins>): PictureMargins | null {
  if (!art.alphaUrl) return OPAQUE;
  const read = alpha.get(art.alphaUrl);
  if (!read) return null;
  return { top: read.top, bottom: art.bottomMarginFrac ?? read.bottom, left: read.left, right: read.right };
}

/** Where a figure draws (world mm): its picture's box and the tap box it hangs from (SceneFigure). */
export function figureGeometry(draw: FigureDraw, art: FigureArt, aspect: number, margins: PictureMargins | null) {
  const { placed, slot, cx } = draw;
  const { item } = placed;
  const grounded = margins !== null;
  // until its picture is read, a figure draws its plate, within the footprint it is packed by, never the picture at a width
  // its packing may not hold; the picture loads meanwhile, hidden, and shows the moment it is read
  const drawnKind = grounded ? art.kind : 'plate';
  const known = margins ?? OPAQUE;
  const picture = pictureBox(drawnKind, placed.heightMm, grounded ? aspect : PLATE_ASPECT, known, item.widthMm);
  const boxH = picture.heightMm;
  const boxW = picture.widthMm;
  // the picture's centre: moved so the figure in it, not the picture, stands centred on its slot
  const artCx = cx + pictureOffsetMm(boxW, known);
  const yBottom = slot.topMm - picture.belowMm;
  // the tap box: the figure standing on its surface, never wider than its footprint and half the gap each side,
  // so neighbours' boxes meet at most; the picture hangs from it by its transparent margins and takes no taps
  const tapW = Math.min(boxW, item.widthMm + FIGURE_GAP_MM);
  const tapX0 = cx - tapW / 2;
  // the figure's opaque rows and columns: the picture is clipped to them, its clear margins cost no px
  const clear = clearInset(drawnKind, known);
  return { grounded, drawnKind, boxW, boxH, artCx, yBottom, tapW, tapX0, clear };
}

/**
 * What a figure's layer covers (world mm), at its depth: its tap box and the picture hanging from it, clipped to the
 * figure in it, whose opaque rows run from the surface to the figure's height (pictureBox).
 */
export function figureLayerBox(draw: FigureDraw, g: ReturnType<typeof figureGeometry>, cab: number): FigureBox {
  return {
    cab,
    x0: Math.min(g.tapX0, g.artCx - g.boxW / 2 + g.clear.left * g.boxW),
    x1: Math.max(g.tapX0 + g.tapW, g.artCx + g.boxW / 2 - g.clear.right * g.boxW),
    y0: draw.slot.topMm,
    y1: draw.slot.topMm + draw.placed.heightMm,
    z: draw.placed.zMm,
  };
}

/** A figure's name plate (world mm): its corner and sides, hanging just in front of the front edge of its surface. */
export function plateOf(draw: FigureDraw): { a: Vec3; u: Vec3; v: Vec3 } {
  const { placed, slot, cx } = draw;
  const w = Math.min(PLATE_MAX_MM, placed.item.widthMm);
  return { a: [cx - w / 2, slot.topMm + 1, slot.frontZMm + 1], u: [w, 0, 0], v: [0, -PLATE_H_MM, 0] };
}
