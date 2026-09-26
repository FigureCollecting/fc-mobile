import { describe, it, expect } from 'vitest';
import { getFacet, applyFilters, countActiveFilters, UNSPECIFIED } from '../facets';
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
