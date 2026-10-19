// FIGURES-ONLY-1 (Ross 10-18): the case shelves figures only. Goods (a towel, a tapestry, a poster) and media stay in
// the collection list, the tiles and Info, and are counted for the View card; a product with no stated kind keeps
// today's behaviour and is shelved.
import { describe, expect, it } from 'vitest';
import { ProductKind } from '@figurecollecting/fc-api-contract';
import type { Figure } from '@figurecollecting/fc-shared';
import { isShelved, notShelvedLine, splitForShelves } from '../shelved';

type Shown = Figure & { local?: { productKind?: ProductKind } };

const figure = (id: string, productKind?: ProductKind, withLocal = true): Shown =>
  ({
    _id: id,
    name: id,
    manufacturer: '',
    scale: '',
    userId: 'u',
    createdAt: '',
    updatedAt: '',
    ...(withLocal ? { local: productKind === undefined ? {} : { productKind } } : {}),
  }) as Shown;

/** Ross's 559 owned items by MFC category (spine claim attr_key='category'), with the kind the spine derives for each (GOODS1 defaults: Plushes goods, Misc goods, as MFC's largest category is keychains, badges and small acrylic). */
const ROSS: readonly [category: string, count: number, kind: ProductKind][] = [
  ['Prepainted', 521, ProductKind.FIGURE],
  ['On Walls', 14, ProductKind.GOODS],
  ['Trading', 7, ProductKind.FIGURE],
  ['Action/Dolls', 6, ProductKind.FIGURE],
  ['Plushes', 3, ProductKind.GOODS],
  ['Linens', 3, ProductKind.GOODS],
  ['Stationeries', 2, ProductKind.GOODS],
  ['Misc', 2, ProductKind.GOODS],
  ['Video', 1, ProductKind.MEDIA],
];

const rossCollection = (): Shown[] => ROSS.flatMap(([category, count, kind]) => Array.from({ length: count }, (_, i) => figure(`${category}-${i}`, kind)));

describe('isShelved', () => {
  it.each([
    ['a figure', ProductKind.FIGURE, true],
    ['goods', ProductKind.GOODS, false],
    ['media', ProductKind.MEDIA, false],
    ['no stated kind', undefined, true],
    ['an UNSPECIFIED kind (never sent, but zero on the wire reads as unknown)', ProductKind.UNSPECIFIED, true],
    ['a kind a newer server sent that this build has not heard of', 99 as ProductKind, true],
  ])('%s: shelved is %s', (_label, kind, shelved) => {
    expect(isShelved(figure('x', kind))).toBe(shelved);
  });

  it('shelves a figure that has no local meta at all (the dev fixtures)', () => {
    expect(isShelved(figure('x', undefined, false))).toBe(true);
  });
});

describe('splitForShelves', () => {
  it('keeps the shelved figures in their order and counts the goods and the media left off', () => {
    const a = figure('a');
    const towel = figure('towel', ProductKind.GOODS);
    const b = figure('b', ProductKind.FIGURE);
    const video = figure('video', ProductKind.MEDIA);
    const poster = figure('poster', ProductKind.GOODS);
    const split = splitForShelves([a, towel, b, video, poster]);
    expect(split.shelved).toEqual([a, b]);
    expect(split.shelved[0]).toBe(a);
    expect(split).toMatchObject({ goods: 2, media: 1 });
  });

  it('hands back the very list when nothing is left off, so nothing downstream re-renders for it', () => {
    const list = [figure('a'), figure('b', ProductKind.FIGURE)];
    expect(splitForShelves(list).shelved).toBe(list);
  });

  it('puts every one of Ross\'s categories where the brief says: 534 shelved, 24 goods, 1 media of 559', () => {
    const all = rossCollection();
    expect(all).toHaveLength(559);
    const split = splitForShelves(all);
    expect(split.shelved).toHaveLength(534);
    expect(split.goods).toBe(24);
    expect(split.media).toBe(1);
    expect(split.shelved.length + split.goods + split.media).toBe(559);
  });

  it('handles an empty collection', () => {
    expect(splitForShelves([])).toMatchObject({ shelved: [], goods: 0, media: 0 });
  });
});

describe('notShelvedLine', () => {
  it.each([
    [22, 0, '22 goods not shelved'],
    [0, 1, '1 media not shelved'],
    [22, 1, '22 goods and 1 media not shelved'],
    [1, 0, '1 goods not shelved'],
  ])('%i goods, %i media: "%s"', (goods, media, line) => {
    expect(notShelvedLine(goods, media)).toBe(line);
  });

  it('says nothing when nothing is left off', () => {
    expect(notShelvedLine(0, 0)).toBeNull();
  });
});
