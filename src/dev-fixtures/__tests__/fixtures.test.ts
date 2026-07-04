import { describe, it, expect, afterEach } from 'vitest';
import { FIXTURE_FIGURES, FIXTURE_META, isFixtureMode, setFixtureMode } from '../fixtures';

afterEach(() => localStorage.clear());

describe('dev fixture manifest', () => {
  it('provides 7 figures shaped like API figures', () => {
    expect(FIXTURE_FIGURES).toHaveLength(7);
    for (const f of FIXTURE_FIGURES) {
      expect(f._id).toMatch(/^fx-/);
      expect(f.name).toBeTruthy();
      expect(f.manufacturer).toBeTruthy();
      expect(f.scale).toBeTruthy();
      expect(f.origin).toBeTruthy();
      expect(f.category).toBe('Prepainted');
      expect(['owned', 'ordered', 'wished']).toContain(f.collectionStatus);
      expect(f.companyRoles?.[0]?.roleName).toBe('Distributor');
    }
  });

  it('has display meta with sane footprint scalars for every figure', () => {
    for (const f of FIXTURE_FIGURES) {
      const meta = FIXTURE_META[f._id];
      expect(meta).toBeDefined();
      expect(meta.aspect).toBeCloseTo(meta.width / meta.height, 1);
      expect(meta.relHeight).toBeGreaterThan(0.5);
      expect(meta.relHeight).toBeLessThanOrEqual(1);
      expect(meta.footprintCenterX).toBeGreaterThan(0);
      expect(meta.footprintCenterX).toBeLessThan(1);
      expect(meta.footprintWidth).toBeGreaterThan(0);
      expect(meta.footprintWidth).toBeLessThanOrEqual(1);
    }
  });

  it('covers both recovered and unrecovered bases (synthetic-shadow path)', () => {
    const recovered = FIXTURE_FIGURES.filter((f) => FIXTURE_META[f._id].baseRecovered);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered.length).toBeLessThan(FIXTURE_FIGURES.length);
  });

  it('defaults fixture mode OFF under test, honors localStorage override', () => {
    expect(isFixtureMode()).toBe(false);
    setFixtureMode(true);
    expect(isFixtureMode()).toBe(true);
    setFixtureMode(false);
    expect(isFixtureMode()).toBe(false);
  });
});
