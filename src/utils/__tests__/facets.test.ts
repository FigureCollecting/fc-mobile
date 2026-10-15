import { describe, it, expect } from 'vitest';
import { getFacet, applyFilters, countActiveFilters, holdingOf, isDefaultFilters, UNSPECIFIED } from '../facets';
import { FIXTURE_FIGURES } from '../../dev-fixtures/fixtures';
import type { ListFilters } from '../../hooks/useFigureListParams';

const EMPTY: ListFilters = {
  status: [], mfr: [], dist: [], scale: [], origin: [], cat: [], type: [], tag: [],
};

describe('facets', () => {
  it('counts manufacturer values sorted by count', () => {
    const mfr = getFacet(FIXTURE_FIGURES, 'mfr');
    expect(mfr[0]).toEqual({ value: 'Good Smile Company', count: 3 });
    expect(mfr.map((v) => v.value)).toContain('FREEing');
  });

  it('extracts distributors from companyRoles', () => {
    const dist = getFacet(FIXTURE_FIGURES, 'dist');
    const gsc = dist.find((v) => v.value === 'Good Smile Company');
    expect(gsc?.count).toBe(5);
    expect(dist.map((v) => v.value)).toContain('Crunchyroll');
  });

  it('synthesizes Unspecified for non-scale figures', () => {
    const scale = getFacet(FIXTURE_FIGURES, 'scale');
    expect(scale.map((v) => v.value)).toContain(UNSPECIFIED);
  });

  it('applies conjunctive facet filters with disjunctive values', () => {
    const out = applyFilters(FIXTURE_FIGURES, {
      ...EMPTY,
      mfr: ['Good Smile Company'],
      status: ['owned'],
    });
    expect(out.map((f) => f._id)).toEqual(['fx-rem', 'fx-miku-nendo']);
  });

  it('filters by tag facet', () => {
    const out = applyFilters(FIXTURE_FIGURES, { ...EMPTY, tag: ['blue hair'] });
    expect(out).toHaveLength(2);
  });

  it('treats category-less figures as Prepainted so the default chip stays safe', () => {
    const noCat = [{ ...FIXTURE_FIGURES[0], category: undefined }];
    const out = applyFilters(noCat as any, { ...EMPTY, cat: ['Prepainted'] });
    expect(out).toHaveLength(1);
  });

  it('counts active selections excluding cat/type defaults', () => {
    expect(countActiveFilters({ ...EMPTY, cat: ['Prepainted'], type: ['Figures'] })).toBe(0);
    expect(countActiveFilters({ ...EMPTY, mfr: ['X'], status: ['owned'] })).toBe(2);
  });
});

describe('holdings, chosen in Refine (SHEETS-FB1 3)', () => {
  const held = (id: string, kind: string | undefined, status?: string) =>
    ({ ...FIXTURE_FIGURES[0]!, _id: id, collectionStatus: status, ...(kind === undefined ? {} : { local: { kind } }) }) as never;
  const set = [held('o', 'owned', 'owned'), held('r', 'ordered', 'ordered'), held('w', 'wished', 'wished'), held('f', 'former'), held('x', undefined, 'wished')];
  const ids = (filters: ListFilters) => applyFilters(set, filters).map((f) => f._id);

  it('a figure is held as its local kind, else (a fixture) its collection status', () => {
    expect(set.map(holdingOf)).toEqual(['owned', 'ordered', 'wished', 'former', 'wished']);
    expect(holdingOf({ ...FIXTURE_FIGURES[0]!, collectionStatus: undefined })).toBe('');
  });

  it('none chosen: every holding but No longer owned', () => {
    expect(ids(EMPTY)).toEqual(['o', 'r', 'w', 'x']);
  });

  it('chosen: just those, No longer owned too when chosen', () => {
    expect(ids({ ...EMPTY, status: ['wished'] })).toEqual(['w', 'x']);
    expect(ids({ ...EMPTY, status: ['owned', 'former'] })).toEqual(['o', 'f']);
  });
});

describe('isDefaultFilters', () => {
  const defaults: ListFilters = { ...EMPTY, status: ['owned'], cat: ['Prepainted'], type: ['Figures'] };
  it('true when every list holds the defaults, in any order', () => {
    expect(isDefaultFilters({ ...defaults }, defaults)).toBe(true);
    expect(isDefaultFilters({ ...defaults, status: ['owned'], cat: ['Prepainted'] }, { ...defaults, cat: ['Prepainted'] })).toBe(true);
    expect(isDefaultFilters({ ...EMPTY, status: ['b', 'a'] }, { ...EMPTY, status: ['a', 'b'] })).toBe(true);
  });
  it('false when any list differs: a value more, one fewer, or another', () => {
    expect(isDefaultFilters({ ...defaults, mfr: ['Alter'] }, defaults)).toBe(false);
    expect(isDefaultFilters({ ...defaults, status: [] }, defaults)).toBe(false);
    expect(isDefaultFilters({ ...defaults, status: ['wished'] }, defaults)).toBe(false);
    expect(isDefaultFilters({ ...defaults, cat: [] }, defaults)).toBe(false);
  });
});
