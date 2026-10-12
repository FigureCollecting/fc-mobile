/**
 * What the case draws for one figure (CASE-ADAPT), best first:
 *  - masked: the derivative composited with its separate alpha mask at
 *    display time (CSS mask-image; Ross 09-26: masking is a non-destructive
 *    overlay, the derivative is never cut out), grounded on the mask;
 *  - cutout: a picture that carries its own alpha (the matted derivative, or
 *    a dev fixture), grounded on that alpha;
 *  - framed: a clean copy without a mask, standing as a framed picture;
 *  - plate: no picture at all, a placeholder card with the figure's name.
 * The picture's address comes from the image list (a GetProductImages entry,
 * imageRefFromProductImage) or else resolveFigureImageUrl.
 */
import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from './displayMeta';
import { resolveFigureImageUrl } from './matteImageUrl';

export interface ContactBandFrac {
  readonly centerXFrac: number;
  readonly widthFrac: number;
}

/** One figure's picture as the image list gives it. */
export interface FigureImageRef {
  readonly url: string;
  readonly maskUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bottomMarginFrac?: number;
  readonly contactBand?: ContactBandFrac;
}

export type FigureArtKind = 'masked' | 'cutout' | 'framed' | 'plate';

export interface FigureArt {
  readonly kind: FigureArtKind;
  readonly url?: string;
  readonly maskUrl?: string;
  /** The image whose alpha says where the figure is drawn (grounding, taps); none for framed and plate. */
  readonly alphaUrl?: string;
  /** Measured by the server; else the client measures alphaUrl. */
  readonly bottomMarginFrac?: number;
  readonly contactBand?: ContactBandFrac;
}

export function figureArt(figure: Figure, meta: FigureDisplayMeta, image?: FigureImageRef, baseUrl?: string): FigureArt {
  if (image?.url && image.maskUrl) {
    return {
      kind: 'masked',
      url: image.url,
      maskUrl: image.maskUrl,
      alphaUrl: image.maskUrl,
      bottomMarginFrac: image.bottomMarginFrac,
      contactBand: image.contactBand,
    };
  }
  const url = image?.url || resolveFigureImageUrl(figure, baseUrl);
  if (!url) return { kind: 'plate' };
  if (!image && meta.matted) {
    return { kind: 'cutout', url, alphaUrl: url, bottomMarginFrac: meta.bottomMarginFrac, contactBand: meta.contactBand };
  }
  return { kind: 'framed', url };
}

/**
 * The clear margins above and below a figure, together, are believed up to
 * this fraction of its picture, so the box stays within 10x the figure: a
 * larger sum (a figure under a tenth of its picture, or a bad mask) is cut.
 * The bottom is kept first, so the lowest opaque row stays on the surface;
 * the top gives way, and only such a figure draws short of its height.
 */
export const MAX_MARGINS_FRAC = 0.9;

/** A picture's clear margins around the figure: above and below as fractions of its height, left and right (when known) of its width. */
export interface PictureMargins {
  readonly top: number;
  readonly bottom: number;
  readonly left?: number;
  readonly right?: number;
}

/** The box a figure's picture is drawn in, mm. */
export interface PictureBox {
  readonly widthMm: number;
  readonly heightMm: number;
  /** How far the picture hangs below the surface: its clear bottom margin. */
  readonly belowMm: number;
}

/** A measured margin as a fraction: a negative one, or none (NaN), is 0. */
const clearFrac = (frac: number) => (frac > 0 ? frac : 0);

/**
 * True scale (Ross 09-26): the picture is drawn so that the figure in it,
 * its opaque rows, stands exactly heightMm tall with its lowest row on the
 * surface, over the clear margins above and below it. Cut-outs and masked
 * art keep their shape (their sides are clear); a framed copy or a plate is
 * an opaque box, drawn no wider than the footprint it is packed by, so it
 * never reaches over a neighbour.
 */
export function pictureBox(kind: FigureArtKind, heightMm: number, aspect: number, margins: PictureMargins, footprintMm: number): PictureBox {
  const bottom = Math.min(MAX_MARGINS_FRAC, clearFrac(margins.bottom));
  const top = Math.min(MAX_MARGINS_FRAC - bottom, clearFrac(margins.top));
  const boxH = heightMm / (1 - top - bottom);
  const natural = aspect * boxH;
  const widthMm = kind === 'framed' || kind === 'plate' ? Math.min(natural, footprintMm) : natural;
  return { widthMm, heightMm: boxH, belowMm: bottom * boxH };
}

/**
 * How wide the figure in a cut-out or masked picture draws at true scale,
 * mm: the picture sized by pictureBox, less its clear columns left and
 * right. Wider than aspect x height when the clear rows are tall (wings over
 * a small figure); the case packs such art by it, never by less (a label
 * fitted to nothing, or none at all), and centres those columns, not the
 * picture, on the slot (pictureOffsetMm), so no figure reaches over a
 * neighbour or past its surface.
 */
export function drawnWidthMm(heightMm: number, aspect: number, margins: PictureMargins): number {
  const picture = pictureBox('cutout', heightMm, aspect, margins, Infinity);
  return picture.widthMm * Math.max(0, 1 - clearFrac(margins.left ?? 0) - clearFrac(margins.right ?? 0));
}

/**
 * How far along the wall a picture widthMm wide is moved so the figure in
 * it, its opaque columns, stands centred on its slot rather than the
 * picture: half its clear right less its clear left, of its width (a figure
 * leaning right in its picture moves it left). 0 when the sides are not
 * known: framed and plate art, or a picture not read yet.
 */
export function pictureOffsetMm(widthMm: number, margins: PictureMargins): number {
  return ((clearFrac(margins.right ?? 0) - clearFrac(margins.left ?? 0)) / 2) * widthMm;
}

/** The part of a coordinator.v1.ProductImage the case reads. */
export interface ProductImageLike {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly mask?: { readonly url: string };
  readonly bottomMarginFrac?: number;
  readonly contactBand?: ContactBandFrac;
}

/** A GetProductImages entry as a FigureImageRef; undefined when it has no URL (no public media base). */
export function imageRefFromProductImage(image: ProductImageLike): FigureImageRef | undefined {
  if (!image.url) return undefined;
  const ref: { -readonly [K in keyof FigureImageRef]: FigureImageRef[K] } = { url: image.url };
  if (image.mask?.url) ref.maskUrl = image.mask.url;
  if (image.width > 0 && image.height > 0) {
    ref.width = image.width;
    ref.height = image.height;
  }
  if (image.bottomMarginFrac !== undefined) ref.bottomMarginFrac = image.bottomMarginFrac;
  if (image.contactBand) ref.contactBand = { centerXFrac: image.contactBand.centerXFrac, widthFrac: image.contactBand.widthFrac };
  return ref;
}
