import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { CabinetProfile } from '../cabinetProfile';
import { describeViolator, measureCaseFigure, packCabinets, type CaseFigure } from '../packCabinets';
import { UNMATTED_META } from '../displayMeta';

// CASE-FB3b (Ross 10-17, his Fold8: 12 figures "too wide for the IKEA KLINGSBO glass-door cabinet even with shelf out";
// "unclear if these could have been placed within or on top"). The data shows why (prod.tsv, 10-16): most have no
// width, so the case derives one from the picture's aspect times a height that is often a scale estimate or the
// 200 mm default, and a lying figure's wide photo becomes 400-700 mm; MFC's L (length) lands in depth only. The rules:
//   - a height only an estimate gives gives way to what the labels support of the width: the labeled L (the long side
//     of the footprint), else the scale's nominal character height (1600 mm / n), so the picture drawn is no wider than its
//     footprint; a labeled width or height is never changed;
//   - a figure may stand turned on its shelf: it fits where its longer side fits the width and its shorter the depth,
//     or the reverse;
//   - before a figure is listed as not fitting it is tried in a tier, on the cabinet top (the room above), on the
//     KLINGSBO's open shelf and in a wider cabinet of the wall (the rack); the list says what it measured and from what.

const fig = (name: string, dimensions: Record<string, number>, scale?: string): Figure => ({ _id: name, name, scale, dimensions }) as unknown as Figure;
const meta = (aspect: number) => ({ ...UNMATTED_META, aspect });
const measure = (f: Figure, aspect: number, drawn?: Parameters<typeof measureCaseFigure>[3]): CaseFigure => measureCaseFigure(f, 0, meta(aspect), drawn);
const NOMINAL_1_7 = 1600 / 7;

describe('what a width the labels do not give is capped at', () => {
  it('a labeled length with no width is the long side: a picture wider than it gives way, an estimated height with it', () => {
    // Boa Hancock: L=150 only; no height, no scale: the 200 mm default height at a 2.6 aspect read 520 mm wide
    const boa = measure(fig('Boa Hancock', { depthMm: 150 }), 2.6);
    expect(boa.widthMm).toBeCloseTo(150, 9);
    // SIZE-L3: the length is the width of a lying figure; the footprint's depth is Ross's ratio of it (it was the length itself)
    expect(boa.depthMm).toBeCloseTo(0.65 * 150, 9);
    expect(boa.heightMm).toBeCloseTo(150 / 2.6, 9);
    expect(boa.heightEstimated).toBe(true);
    expect(boa.billboardWidthMm).toBeCloseTo(150, 9);
    expect(boa.widthBasis).toBe('length');
  });

  it('a labeled width is never capped, whatever the length or the picture say', () => {
    const f = measure(fig('Octopus', { heightMm: 100, widthMm: 335, depthMm: 150 }, '1/3'), 3);
    expect(f.widthMm).toBe(335);
    expect(f.widthBasis).toBe('labeled');
  });

  it('with no length, a scale caps it at the nominal character height, and an estimated height gives way too', () => {
    const f = measure(fig('Kurumi', {}, '1/7'), 1.5);
    expect(f.widthMm).toBeCloseTo(NOMINAL_1_7, 9);
    expect(f.heightMm).toBeCloseTo(NOMINAL_1_7 / 1.5, 9);
    expect(f.heightEstimated).toBe(true);
    expect(f.widthBasis).toBe('scale');
  });

  it('a labeled height stands, and with it the picture it draws: nothing is capped, the list says where the width comes from', () => {
    // Momioka Risa 1/4, H=230: a 2.0 aspect picture is 460 mm wide at 230 mm tall (the 1/4 nominal height is 400 mm)
    const f = measure(fig('Risa', { heightMm: 230 }, '1/4'), 2);
    expect(f.heightMm).toBe(230);
    expect(f.heightEstimated).toBe(false);
    expect(f.widthMm).toBeCloseTo(460, 9);
    expect(f.widthBasis).toBe('photo');
    expect(f.depthMm).toBeCloseTo(0.65 * 460, 9);
  });

  it('a picture inside what the labels support is as before: a standing figure, a length that is not exceeded', () => {
    const standing = measure(fig('Standing', {}, '1/7'), 0.7);
    expect(standing.widthMm).toBeCloseTo(0.7 * NOMINAL_1_7, 9);
    expect(standing.widthBasis).toBe('photo');
    const elsa = measure(fig('Elsa Granhiert', { heightMm: 60, depthMm: 190 }), 2.2);
    expect(elsa.widthMm).toBeCloseTo(132, 9);
    expect(elsa.heightMm).toBe(60);
    expect(elsa.widthBasis).toBe('photo');
  });

  it('nothing labeled and no scale: the default height and the picture decide, as before', () => {
    const f = measure(fig('Nothing', {}), 2.6);
    expect(f.heightMm).toBe(200);
    expect(f.widthMm).toBeCloseTo(520, 9);
    expect(f.widthBasis).toBe('photo');
  });

  it('what a cut-out draws (its clear margins read) is what is capped, at the height that draws it', () => {
    const margins = { top: 0.05, bottom: 0.05, left: 0.1, right: 0.1 };
    const f = measure(fig('Cut-out', { depthMm: 150 }), 2.6, margins);
    expect(f.widthMm).toBeCloseTo(150, 6);
    expect(f.widthBasis).toBe('length');
  });
});

describe('a figure may stand turned on its shelf', () => {
  const place = (item: CaseFigure, pattern: readonly CabinetProfile[] = [IKEA_KLINGSBO]) => {
    const { cabinets, violators } = packCabinets([item], pattern);
    const placed = cabinets.flatMap((c) => c.surfaces.flatMap((s) => s.items.map((p) => ({ p, slot: s.slot, cab: c.index }))));
    return { placed, violators };
  };

  it('150 mm wide, 350 deep (Zuikaku) is too deep for a KLINGSBO shelf as it stands and fits it turned', () => {
    const item = measure(fig('Zuikaku', { heightMm: 190, widthMm: 150, depthMm: 350 }, '1/4'), 0.8);
    expect(item.depthMm).toBe(350);
    const { placed, violators } = place(item);
    expect(violators).toEqual([]);
    expect(placed).toHaveLength(1);
    // its long side along the shelf, its short one deep: 350 of the plate's 359 mm and 150 of its 314
    expect(placed[0].p.item).toMatchObject({ widthMm: 350, depthMm: 150, turned: true });
    expect(placed[0].p.item.widthMm).toBeLessThanOrEqual(placed[0].slot.widthMm);
    expect(placed[0].p.item.depthMm).toBeLessThanOrEqual(placed[0].slot.depthMm);
    expect(placed[0].p.tooDeep).toBe(false);
  });

  it('a figure that fits as it stands stays as it stands', () => {
    const { placed } = place(measure(fig('Plain', { heightMm: 200, widthMm: 100, depthMm: 80 }), 0.5));
    expect(placed[0].p.item.turned).toBeFalsy();
    expect(placed[0].p.item).toMatchObject({ widthMm: 100, depthMm: 80 });
  });

  it('turned or not, a footprint that fits no shelf of the cabinet stands on its top, which is wider', () => {
    // 400 x 380: over the 382 x 335 interior either way, within the 450 x 400 top (Yoko Littner, 1/4, L=380)
    const { placed, violators } = place(measure(fig('Yoko', { depthMm: 380 }, '1/4'), 1.3));
    expect(violators).toEqual([]);
    expect(placed[0].slot.isTop).toBe(true);
  });

  it('a footprint over every place on the wall is listed, never placed', () => {
    const { placed, violators } = place(measure(fig('Huge', { widthMm: 900, depthMm: 800, heightMm: 200 }), 1));
    expect(placed).toEqual([]);
    expect(violators).toHaveLength(1);
  });
});

/** The 12 the Fold8 listed on 10-17 (11:07, Collection 559), as the records give their sizes (prod.tsv), the aspects of lying and seated figures' photos. */
const TWELVE: [string, Record<string, number>, string | undefined, number][] = [
  ['Elsa Granhiert', { heightMm: 60, depthMm: 190 }, undefined, 2.2],
  ['Tokisaki Kurumi (tall)', { heightMm: 770 }, '1/2.5', 0.7],
  ['Kasumigaoka Utaha', { heightMm: 200 }, '1/4', 1.9],
  ['Boa Hancock', { depthMm: 150 }, undefined, 2.6],
  ['Yoko Littner', { depthMm: 380 }, '1/4', 1.3],
  ['Kirigiri Kyoko', { heightMm: 226 }, '1/4', 1.8],
  ['Zuikaku', { heightMm: 190, widthMm: 150, depthMm: 350 }, '1/4', 1.6],
  ['Tokisaki Kurumi (wide)', { depthMm: 230 }, '1/7', 2.0],
  ['Momioka Risa', { heightMm: 230 }, '1/4', 2.0],
  ['Takarabako no Monster Octopus Girl', { heightMm: 270, widthMm: 335, depthMm: 335 }, '1/3', 1.4],
  ['Naga', { heightMm: 502, widthMm: 228, depthMm: 218 }, '1/4', 0.9],
  ['Re:Zero Emilia - Puck 1/7 (Pulchra)', { depthMm: 255 }, '1/7', 1.8],
];

describe('the twelve figures of the 10-17 list: each lands somewhere or is listed with the reason and what was measured', () => {
  const items = TWELVE.map(([name, dims, scale, aspect], i) => measureCaseFigure(fig(name, dims, scale), i, meta(aspect)));
  const where = (r: ReturnType<typeof packCabinets>) =>
    new Map(r.cabinets.flatMap((c) => c.surfaces.flatMap((s) => s.items.map((p) => [p.item.figure.name, { kind: c.profile.id, top: s.slot.isTop, turned: p.item.turned === true }] as const))));

  it('in a KLINGSBO wall, every one but two is placed: on a shelf or tier, or on a top', () => {
    const r = packCabinets(items, [IKEA_KLINGSBO]);
    const at = where(r);
    expect(r.violators.map((v) => v.item.figure.name)).toEqual(['Tokisaki Kurumi (tall)', 'Momioka Risa']);
    expect(at.size).toBe(10);
    // the ones whose width only the picture gave stand within the length or the scale that supports them
    expect(at.get('Boa Hancock')).toMatchObject({ top: false });
    expect(at.get('Tokisaki Kurumi (wide)')).toMatchObject({ top: false });
    expect(at.get('Re:Zero Emilia - Puck 1/7 (Pulchra)')).toMatchObject({ top: false });
    expect(at.get('Zuikaku')).toMatchObject({ top: false, turned: true });
    // 380 mm wide (the length is her width; her depth is no longer the length, 247 mm in Ross's ratio): wider than the glass, so a tier or the top
    expect(at.get('Yoko Littner')).toMatchObject({ kind: 'ikea-klingsbo' });
    // 407 mm wide, labeled height: its picture's width, over the glass and within the top
    expect(at.get('Kirigiri Kyoko')).toMatchObject({ top: true });
  });

  it('the two left are listed for what is really over: the 770 mm one is within a tier (805 mm) but its 539 mm width is over every place (450 mm, the top); the 230 mm one is 460 mm wide', () => {
    const r = packCabinets(items, [IKEA_KLINGSBO]);
    expect(r.violators.map((v) => v.reason)).toEqual(['too-wide', 'too-wide']);
    expect(r.violators.map((v) => describeViolator(v, [IKEA_KLINGSBO]))).toEqual([
      "too wide: 539 mm from the photo's shape, no labeled width; the widest place takes 450 mm",
      "too wide: 460 mm from the photo's shape, no labeled width; the widest place takes 450 mm",
    ]);
  });

  it('with the rack in the wall, none is listed: a figure no KLINGSBO takes goes to a wider cabinet', () => {
    const r = packCabinets(items, [IKEA_KLINGSBO, OPEN_STEEL_RACK]);
    expect(r.violators).toEqual([]);
    expect(where(r).size).toBe(12);
  });
});

describe('what the list says', () => {
  const pattern = [IKEA_KLINGSBO];
  const listed = (f: Figure, aspect: number) => {
    const r = packCabinets([measureCaseFigure(f, 0, meta(aspect))], pattern);
    expect(r.violators).toHaveLength(1);
    return describeViolator(r.violators[0], pattern);
  };

  it('too wide, from the picture alone: its width, that it is the picture\'s shape, and that no width is labeled', () => {
    expect(listed(fig('Wide photo', {}), 5)).toBe("too wide: 1000 mm from the photo's shape, no labeled width; the widest place takes 450 mm");
  });

  it('too wide, labeled: the label is the measure', () => {
    expect(listed(fig('Labeled', { heightMm: 200, widthMm: 520, depthMm: 100 }), 1)).toBe('too wide: 520 mm, labeled; the widest place takes 450 mm');
  });

  it('too tall: an estimate says what it was estimated from', () => {
    // the tallest place is a tier: the cabinet floor to the top's underside with all four glass shelves out, 1772 - 421 mm
    expect(listed(fig('Estimated tall', {}, '1/1'), 0.3)).toBe('too tall: 1600 mm estimated from its 1/1 scale; the most any place takes is 1351 mm');
  });

  it('too wide, capped: a labeled length or a scale that bounds the picture still over every place says so', () => {
    // L=500, an estimated height gives way to it: 500 mm wide, over the top's 450
    expect(listed(fig('Long', { depthMm: 500 }), 3)).toBe('too wide: 500 mm, capped at its labeled length; the widest place takes 450 mm');
    // 1/2 scale: its nominal 800 mm
    expect(listed(fig('Half', {}, '1/2'), 3)).toBe("too wide: 800 mm capped at its scale's height; the widest place takes 450 mm");
  });

  it('where each measure fits some place but none takes them all, the closest place says how far over', () => {
    // 600 tall (a tier takes it), 430 wide (the top takes it): the top is the closest, 588 over its 587.6 mm
    expect(listed(fig('In between', { heightMm: 600, widthMm: 430, depthMm: 100 }), 1)).toBe('too tall: 600 mm, labeled; no place takes all of it, the closest takes 587.6 mm');
  });

  it('a depth the labels do not give is said to come from the width', () => {
    const hand: CaseFigure = { figure: fig('Hand', {}), index: 0, heightMm: 100, widthMm: 100, billboardWidthMm: 100, depthMm: 500, heightEstimated: false };
    expect(describeViolator({ item: hand, reason: 'too-deep' }, pattern)).toBe('too deep: 500 mm estimated from its width; the deepest place takes 400 mm');
  });

  it('too deep: a labeled length', () => {
    expect(listed(fig('Deep', { heightMm: 100, widthMm: 100, depthMm: 500 }), 1)).toBe('too deep: 500 mm, labeled; the deepest place takes 400 mm');
  });
});
