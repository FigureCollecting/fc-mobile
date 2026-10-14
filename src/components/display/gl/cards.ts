/**
 * CASE-GL: each figure as a flat textured card where the classic view draws
 * its picture (caseFigures.figureGeometry, the same numbers), clipped to the
 * figure in it; its tap box the classic view's figure button; with labels on,
 * its name plate a card of drawn text (canvas-texture labels in the same
 * atlas, so they cost no layer and no draw call of their own); and a soft
 * shadow under it on its surface.
 */
import type { Vec3 } from '../caseCamera';
import { PLATE_H_MM, figureGeometry, plateOf, type FigureDraw } from '../caseFigures';
import type { FigureArt, PictureMargins } from '../figureArt';
import type { TapBox } from './hitTest';

export interface Clip {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const NO_CLIP: Clip = { top: 0, right: 0, bottom: 0, left: 0 };

/** How a card's atlas cell is painted. */
export type CardPaint =
  | { readonly kind: 'cutout'; readonly url: string; readonly clip: Clip }
  | { readonly kind: 'masked'; readonly url: string; readonly maskUrl: string; readonly clip: Clip }
  | { readonly kind: 'framed'; readonly url: string; readonly clip: Clip }
  | { readonly kind: 'plate'; readonly name: string; readonly clip: Clip }
  | { readonly kind: 'label'; readonly name: string; readonly clip: Clip };

export interface FigureCard {
  readonly id: number;
  /** The figure's index in the list the screen shows (onSelect's). */
  readonly figure: number;
  readonly role: 'figure' | 'label';
  readonly cab: number;
  readonly surface: number;
  /** The atlas cell it draws: one per art, however many cards draw it. */
  readonly key: string;
  readonly paint: CardPaint;
  /** Width / height of the card, so of its cell. */
  readonly aspect: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  /** Covers what lies behind it everywhere in its box: framed art, plates, labels. */
  readonly opaque: boolean;
  readonly tap: TapBox | null;
}

export interface ShadowCard {
  readonly figure: number;
  readonly a: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
}

/** What the case draws for the figure at this index: its art, its picture's aspect, its picture's clear margins (null while read). */
export type CardLook = (index: number) => { art: FigureArt; aspect: number; margins: PictureMargins | null };

const f3 = (n: number) => n.toFixed(3);

function paintOf(kind: string, art: FigureArt, name: string, clip: Clip): CardPaint {
  if (kind === 'cutout') return { kind: 'cutout', url: art.url!, clip };
  if (kind === 'masked') return { kind: 'masked', url: art.url!, maskUrl: art.maskUrl!, clip };
  if (kind === 'framed') return { kind: 'framed', url: art.url!, clip };
  return { kind: 'plate', name, clip: NO_CLIP };
}

function keyOf(p: CardPaint, aspect: number): string {
  const clip = [p.clip.top, p.clip.right, p.clip.bottom, p.clip.left].map(f3).join(',');
  if (p.kind === 'plate' || p.kind === 'label') return `${p.kind}|${p.name}|${f3(aspect)}`;
  return `${p.kind}|${p.url}|${p.kind === 'masked' ? p.maskUrl : ''}|${clip}`;
}

export function buildCards(draws: readonly { draw: FigureDraw; cab: number }[], look: CardLook, labels: boolean): { cards: FigureCard[]; shadows: ShadowCard[] } {
  const cards: FigureCard[] = [];
  const shadows: ShadowCard[] = [];
  for (const { draw, cab } of draws) {
    const { placed, slot, cx } = draw;
    const { item } = placed;
    const { art, aspect, margins } = look(item.index);
    const g = figureGeometry(draw, art, aspect, margins);
    const clip: Clip = { top: g.clear.top, right: g.clear.right, bottom: g.clear.bottom, left: g.clear.left };
    const x0 = g.artCx - g.boxW / 2 + clip.left * g.boxW;
    const x1 = g.artCx + g.boxW / 2 - clip.right * g.boxW;
    const y0 = g.yBottom + clip.bottom * g.boxH;
    const y1 = g.yBottom + g.boxH - clip.top * g.boxH;
    const paint = paintOf(g.drawnKind, art, item.figure.name, clip);
    const cardAspect = (x1 - x0) / (y1 - y0);
    const id = cards.length;
    cards.push({
      id,
      figure: item.index,
      role: 'figure',
      cab,
      surface: slot.surfaceIndex,
      key: keyOf(paint, cardAspect),
      paint,
      aspect: cardAspect,
      x0,
      x1,
      y0,
      y1,
      z: placed.zMm,
      opaque: paint.kind === 'framed' || paint.kind === 'plate',
      tap: { id, x0: g.tapX0, x1: g.tapX0 + g.tapW, y0: slot.topMm, y1: slot.topMm + placed.heightMm, z: placed.zMm },
    });
    // the shadow: as the classic view lays it where no contact band is read (the middle of the picture's opaque columns)
    const contact = (g.grounded ? art.contactBand : null) ?? {
      centerXFrac: 0.5 + (cx - g.artCx) / g.boxW,
      widthFrac: g.drawnKind === 'cutout' || g.drawnKind === 'masked' ? 0.6 : 0.9,
    };
    const shadowW = Math.max(20, contact.widthFrac * g.boxW * 1.15);
    const shadowD = Math.min(slot.depthMm, Math.max(40, item.depthMm));
    const shadowX = g.artCx - g.boxW / 2 + contact.centerXFrac * g.boxW;
    shadows.push({ figure: item.index, a: [shadowX - shadowW / 2, slot.topMm + 0.6, placed.zMm - shadowD / 2], u: [shadowW, 0, 0], v: [0, 0, shadowD] });
    if (labels) {
      const p = plateOf(draw);
      const label: CardPaint = { kind: 'label', name: item.figure.name, clip: NO_CLIP };
      const w = p.u[0];
      cards.push({
        id: cards.length,
        figure: item.index,
        role: 'label',
        cab,
        surface: slot.surfaceIndex,
        key: keyOf(label, w / PLATE_H_MM),
        paint: label,
        aspect: w / PLATE_H_MM,
        x0: p.a[0],
        x1: p.a[0] + w,
        y0: p.a[1] - PLATE_H_MM,
        y1: p.a[1],
        z: p.a[2],
        opaque: true,
        tap: null,
      });
    }
  }
  return { cards, shadows };
}
