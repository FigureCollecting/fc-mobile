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

/** A picture's clear margins above and below the figure, fractions of its height. */
export interface PictureMargins {
  readonly top: number;
  readonly bottom: number;
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
