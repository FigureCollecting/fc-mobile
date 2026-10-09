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
