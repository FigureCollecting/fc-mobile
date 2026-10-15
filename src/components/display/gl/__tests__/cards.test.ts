import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDraw } from '../../caseFigures';
import type { FigureArt, PictureMargins } from '../../figureArt';
import { buildCards, type CardLook } from '../cards';

const figure = (id: string, name: string) => ({ _id: id, name }) as unknown as Figure;

function drawOf(index: number, cx: number, z = -150): FigureDraw {
  return {
    cx,
    slot: { surfaceIndex: 1, isTop: false, topMm: 1000, maxHeightMm: 380, widthMm: 380, depthMm: 300, frontZMm: -12 },
    placed: {
      item: { figure: figure(`f${index}`, `Figure ${index}`), index, heightMm: 200, widthMm: 80, billboardWidthMm: 100, depthMm: 60, heightEstimated: false },
      xMm: 0,
      zMm: z,
      heightMm: 200,
      tooDeep: false,
    },
  };
}

const CUT: FigureArt = { kind: 'cutout', url: 'https://img.test/a.png', alphaUrl: 'https://img.test/a.png' };
const MARGINS: PictureMargins = { top: 0.1, bottom: 0.1, left: 0.2, right: 0.2 };
const look = (art: FigureArt, margins: PictureMargins | null, aspect = 0.5): CardLook => () => ({ art, aspect, margins });

describe('buildCards: each figure a card where the classic view draws its picture', () => {
  it('a cut-out: the card is the picture clipped to the figure in it, its cell the same part of the picture; the tap box is the button', () => {
    const { cards } = buildCards([{ draw: drawOf(3, 100), cab: 2 }], look(CUT, MARGINS), false);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    // pictureBox: 250 mm tall (200 / 0.8), 125 wide, 25 below the surface; clipped 20 % each side, 10 % top and bottom
    expect(c).toMatchObject({ id: 0, figure: 3, role: 'figure', cab: 2, surface: 1, x0: 62.5, x1: 137.5, y0: 1000, y1: 1200, z: -150, opaque: false });
    expect(c.aspect).toBeCloseTo(75 / 200, 9);
    expect(c.paint).toEqual({ kind: 'cutout', url: CUT.url, clip: { top: 0.1, right: 0.2, bottom: 0.1, left: 0.2 } });
    expect(c.tap).toEqual({ id: 0, x0: 55, x1: 145, y0: 1000, y1: 1200, z: -150 });
  });

  it('framed art covers what lies behind it (an occluder); a cut-out does not', () => {
    const framed: FigureArt = { kind: 'framed', url: 'https://img.test/b.jpg' };
    const { cards } = buildCards([{ draw: drawOf(0, 100), cab: 0 }], look(framed, { top: 0, bottom: 0 }), false);
    expect(cards[0].opaque).toBe(true);
    expect(cards[0].paint).toEqual({ kind: 'framed', url: framed.url, clip: { top: 0, right: 0, bottom: 0, left: 0 } });
    // framed: as wide as its footprint at most (80 mm), its full height
    expect(cards[0].x1 - cards[0].x0).toBeCloseTo(80, 9);
    expect(cards[0].y1 - cards[0].y0).toBeCloseTo(200, 9);
  });

  it('a masked figure paints its picture through its mask', () => {
    const masked: FigureArt = { kind: 'masked', url: 'https://img.test/c.jpg', maskUrl: 'https://img.test/c.mask.png', alphaUrl: 'https://img.test/c.mask.png' };
    const { cards } = buildCards([{ draw: drawOf(0, 100), cab: 0 }], look(masked, MARGINS), false);
    expect(cards[0].paint).toMatchObject({ kind: 'masked', url: masked.url, maskUrl: masked.maskUrl });
    expect(cards[0].opaque).toBe(false);
  });

  it('a picture still being read stands as its name plate, opaque, as the classic view draws it', () => {
    const { cards } = buildCards([{ draw: drawOf(0, 100), cab: 0 }], look(CUT, null), false);
    expect(cards[0].paint).toEqual({ kind: 'plate', name: 'Figure 0', clip: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(cards[0].opaque).toBe(true);
  });

  it('one art drawn by many figures is one atlas key; another clip or picture is another', () => {
    const { cards } = buildCards(
      [
        { draw: drawOf(0, 100), cab: 0 },
        { draw: drawOf(1, 300), cab: 0 },
      ],
      look(CUT, MARGINS),
      false,
    );
    expect(cards[0].key).toBe(cards[1].key);
    const other = buildCards([{ draw: drawOf(0, 100), cab: 0 }], look(CUT, { ...MARGINS, top: 0.2 }), false).cards[0];
    expect(other.key).not.toBe(cards[0].key);
    const plates = buildCards(
      [
        { draw: drawOf(0, 100), cab: 0 },
        { draw: drawOf(1, 300), cab: 0 },
      ],
      look(CUT, null),
      false,
    ).cards;
    // a plate shows its figure's own name
    expect(plates[0].key).not.toBe(plates[1].key);
  });

  it('labels on: a name plate card hanging from the front edge of the surface, drawn text, no tap; off: none', () => {
    const on = buildCards([{ draw: drawOf(3, 100), cab: 0 }], look(CUT, MARGINS), true).cards;
    expect(on).toHaveLength(2);
    const label = on.find((c) => c.role === 'label')!;
    expect(label).toMatchObject({ figure: 3, x0: 60, x1: 140, y0: 971, y1: 1001, z: -11, opaque: true, tap: null });
    expect(label.paint).toEqual({ kind: 'label', name: 'Figure 3', clip: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(label.aspect).toBeCloseTo(80 / 30, 9);
    expect(buildCards([{ draw: drawOf(3, 100), cab: 0 }], look(CUT, MARGINS), false).cards.some((c) => c.role === 'label')).toBe(false);
  });

  it('a soft shadow on the surface under each figure, where the classic view lays it', () => {
    const { shadows } = buildCards([{ draw: drawOf(3, 100), cab: 0 }], look(CUT, MARGINS), false);
    expect(shadows).toHaveLength(1);
    // 0.6 of the picture's width x 1.15 wide, the figure's depth deep, centred under it
    expect(shadows[0].a[0]).toBeCloseTo(100 - 86.25 / 2, 9);
    expect(shadows[0].a[1]).toBeCloseTo(1000.6, 9);
    expect(shadows[0].a[2]).toBeCloseTo(-180, 9);
    expect(shadows[0].u).toEqual([86.25, 0, 0]);
    expect(shadows[0].v).toEqual([0, 0, 60]);
  });

  it('ids run in order, card by card', () => {
    const { cards } = buildCards(
      [
        { draw: drawOf(0, 100), cab: 0 },
        { draw: drawOf(1, 300), cab: 0 },
      ],
      look(CUT, MARGINS),
      true,
    );
    expect(cards.map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(cards.filter((c) => c.tap).map((c) => c.tap!.id)).toEqual(cards.filter((c) => c.role === 'figure').map((c) => c.id));
  });
});
