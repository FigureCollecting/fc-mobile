import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import {
  ARRANGEMENT_LABEL,
  CASE_ARRANGEMENTS,
  DEFAULT_CASE_ARRANGEMENT,
  NO_SCALE,
  NON_SCALE,
  UNKNOWN_SERIES,
  arrangeCase,
  isCaseArrangement,
  scaleGroupOf,
  seriesGroupOf,
  type CaseArrangement,
} from '../caseArrangement';

let next = 0;
function fig(name: string, origin?: string, scale = '', createdAt = ''): Figure {
  next += 1;
  return { _id: `id-${String(next).padStart(3, '0')}`, name, origin, scale, createdAt } as Figure;
}
/** Each figure as the packer sees it: its list index kept (the tap's onSelect index). */
const items = (figures: Figure[]) => figures.map((figure, index) => ({ figure, index }));
const names = (arranged: { items: { figure: Figure }[] }) => arranged.items.map((i) => i.figure.name);

describe('PACK1: the six case arrangements (Ross 10-26)', () => {
  it('exactly six, the default series, then scale, then name, each in plain words', () => {
    expect(CASE_ARRANGEMENTS).toEqual(['series-scale-name', 'scale-series-name', 'series-name', 'scale-name', 'name', 'date-added']);
    expect(DEFAULT_CASE_ARRANGEMENT).toBe('series-scale-name');
    expect(CASE_ARRANGEMENTS.map((a) => ARRANGEMENT_LABEL[a])).toEqual([
      'Series, then scale, then name',
      'Scale, then series, then name',
      'Series, then name',
      'Scale, then name',
      'Name',
      'Date added, newest first',
    ]);
  });

  it('knows its own values and nothing else', () => {
    for (const a of CASE_ARRANGEMENTS) expect(isCaseArrangement(a)).toBe(true);
    for (const v of ['', 'Name', 'activity', null, undefined, 3, ['name']]) expect(isCaseArrangement(v)).toBe(false);
  });
});

describe('scale groups: by ratio, the larger first; non-scale after them, no scale last', () => {
  it('reads 1/n and 1:n as the same ratio; life size is 1/1', () => {
    expect(scaleGroupOf(fig('a', undefined, '1/7'))).toEqual({ key: 'scale:7', rank: 7 });
    expect(scaleGroupOf(fig('a', undefined, ' 1 : 7 '))).toEqual({ key: 'scale:7', rank: 7 });
    expect(scaleGroupOf(fig('a', undefined, '1/1'))).toEqual({ key: 'scale:1', rank: 1 });
    expect(scaleGroupOf(fig('a', undefined, '1/2.5'))).toEqual({ key: 'scale:2.5', rank: 2.5 });
  });

  it('Nendoroid, prize, non-scale and any other words are the one non-scale group; nothing, blank or Unspecified is no scale', () => {
    for (const s of ['Non-Scale', 'non scale', 'NONSCALE', 'ノンスケール', 'Nendoroid', 'Prize', 'Statue']) {
      expect(scaleGroupOf(fig('a', undefined, s)).key, s).toBe(NON_SCALE);
    }
    for (const s of ['', '   ', 'Unspecified', 'unspecified', undefined]) {
      expect(scaleGroupOf({ ...fig('a'), scale: s } as Figure).key, String(s)).toBe(NO_SCALE);
    }
    expect(scaleGroupOf(fig('a', undefined, '1/0')).key).toBe(NON_SCALE);
  });

  it('orders 1/4 before 1/6 before 1/7 before 1/12, then non-scale, then no scale', () => {
    const list = ['1/12', '', 'Nendoroid', '1/7', '1/4', '1/6', 'Prize'].map((s) => fig(`s${s}`, 'X', s));
    const out = arrangeCase(items(list), 'scale-name');
    expect(out.items.map((i) => i.figure.scale)).toEqual(['1/4', '1/6', '1/7', '1/12', 'Nendoroid', 'Prize', '']);
  });
});

describe('series groups: case- and accent-insensitive; unknown series last', () => {
  it('folds case, accents and width, so one series is one group', () => {
    expect(seriesGroupOf(fig('a', 'Re:Zero')).key).toBe(seriesGroupOf(fig('b', 're:zero')).key);
    expect(seriesGroupOf(fig('a', 'Pokémon')).key).toBe(seriesGroupOf(fig('b', 'POKEMON')).key);
    expect(seriesGroupOf(fig('a', 'Ｆａｔｅ')).key).toBe(seriesGroupOf(fig('b', 'Fate')).key);
    expect(seriesGroupOf(fig('a', '  ')).key).toBe(UNKNOWN_SERIES);
    expect(seriesGroupOf(fig('a')).key).toBe(UNKNOWN_SERIES);
  });
});

describe('each order', () => {
  // one small collection, in a list order none of the arrangements has
  const list = () => {
    next = 0;
    return [
      fig('Rem', 'Re:Zero', '1/7', '2026-03-01T00:00:00Z'),
      fig('emilia', 're:zero', '1/7', '2026-05-01T00:00:00Z'),
      fig('Saber', 'Fate', '1/4', '2026-01-01T00:00:00Z'),
      fig('Miku', undefined, '1/8', '2026-04-01T00:00:00Z'),
      fig('Nendoroid Miku', 'Vocaloid', 'Nendoroid', '2026-02-01T00:00:00Z'),
      fig('Élan', 'Fate', '', ''),
      fig('Archer', 'Fate', '1/7', '2026-06-01T00:00:00Z'),
      fig('Ram', 'Re:Zero', '1/4', '2026-01-15T00:00:00Z'),
    ];
  };

  const cases: [CaseArrangement, string[], (string | null)[]][] = [
    [
      'series-scale-name',
      ['Saber', 'Archer', 'Élan', 'Ram', 'emilia', 'Rem', 'Nendoroid Miku', 'Miku'],
      ['fate', 'fate', 'fate', 're:zero', 're:zero', 're:zero', 'vocaloid', UNKNOWN_SERIES],
    ],
    [
      'scale-series-name',
      ['Saber', 'Ram', 'Archer', 'emilia', 'Rem', 'Miku', 'Nendoroid Miku', 'Élan'],
      ['scale:4', 'scale:4', 'scale:7', 'scale:7', 'scale:7', 'scale:8', NON_SCALE, NO_SCALE],
    ],
    [
      'series-name',
      ['Archer', 'Élan', 'Saber', 'emilia', 'Ram', 'Rem', 'Nendoroid Miku', 'Miku'],
      ['fate', 'fate', 'fate', 're:zero', 're:zero', 're:zero', 'vocaloid', UNKNOWN_SERIES],
    ],
    [
      'scale-name',
      ['Ram', 'Saber', 'Archer', 'emilia', 'Rem', 'Miku', 'Nendoroid Miku', 'Élan'],
      ['scale:4', 'scale:4', 'scale:7', 'scale:7', 'scale:7', 'scale:8', NON_SCALE, NO_SCALE],
    ],
    ['name', ['Archer', 'Élan', 'emilia', 'Miku', 'Nendoroid Miku', 'Ram', 'Rem', 'Saber'], [null, null, null, null, null, null, null, null]],
    ['date-added', ['Archer', 'emilia', 'Miku', 'Rem', 'Nendoroid Miku', 'Ram', 'Saber', 'Élan'], [null, null, null, null, null, null, null, null]],
  ];

  for (const [arrangement, order, groups] of cases) {
    it(`${arrangement}: ${order.join(', ')}`, () => {
      const out = arrangeCase(items(list()), arrangement);
      expect(names(out)).toEqual(order);
      // a group is the first key's value; name and date added have none (each figure stands alone)
      expect(out.groups).toEqual(groups);
    });
  }

  it('keeps each figure its list index: the tap and the pictures still find it', () => {
    const before = items(list());
    const out = arrangeCase(before, 'name');
    for (const i of out.items) expect(before[i.index].figure).toBe(i.figure);
  });

  it('never depends on the list order: any shuffle arranges the same', () => {
    const base = list();
    for (const arrangement of CASE_ARRANGEMENTS) {
      const want = names(arrangeCase(items(base), arrangement));
      expect(names(arrangeCase(items([...base].reverse()), arrangement)), arrangement).toEqual(want);
      expect(names(arrangeCase(items([...base.slice(3), ...base.slice(0, 3)]), arrangement)), arrangement).toEqual(want);
    }
  });

  it('names compare by their numbers as numbers, and identical names by id', () => {
    next = 0;
    const a = fig('Miku 10');
    const b = fig('miku 2');
    const c = fig('Miku 2');
    expect(arrangeCase(items([a, c, b]), 'name').items.map((i) => i.figure._id)).toEqual([b._id, c._id, a._id]);
  });

  it('two series the collator calls equal (Straße, Strasse) stay two groups, never interleaved by name', () => {
    next = 0;
    const a = fig('A', 'Straße');
    const b = fig('B', 'Strasse');
    const c = fig('C', 'Straße');
    const arranged = arrangeCase(items([a, b, c]), 'series-name');
    expect(names(arranged)).toEqual(['B', 'A', 'C']);
    expect(arranged.groups).toEqual(['strasse', 'straße', 'straße']);
  });

  it('date added: one with no time stands after one with a time, whichever the list puts first', () => {
    next = 0;
    const dated = fig('B', undefined, '', '2026-01-01T00:00:00Z');
    const undated = fig('A');
    expect(names(arrangeCase(items([undated, dated]), 'date-added'))).toEqual(['B', 'A']);
    expect(names(arrangeCase(items([dated, undated]), 'date-added'))).toEqual(['B', 'A']);
  });

  it('the same figure twice keeps the list order between them', () => {
    next = 0;
    const one = fig('A', 'S', '1/7');
    const arranged = arrangeCase([{ figure: one, index: 4 }, { figure: one, index: 1 }], 'series-scale-name');
    expect(arranged.items.map((i) => i.index)).toEqual([1, 4]);
  });

  it('a figure with no name stands with the empty names, first; nothing throws on a figure with nothing', () => {
    next = 0;
    const bare = { _id: 'bare' } as Figure;
    for (const arrangement of CASE_ARRANGEMENTS) {
      expect(() => arrangeCase(items([bare, fig('A', 'S', '1/7', '2026-01-01T00:00:00Z')]), arrangement)).not.toThrow();
    }
    expect(arrangeCase(items([fig('A'), bare]), 'name').items[0].figure._id).toBe('bare');
  });
});
