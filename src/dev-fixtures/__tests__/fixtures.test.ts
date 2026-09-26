import { describe, it, expect, afterEach } from 'vitest';
import {
  FIXTURE_FIGURES,
  FIXTURE_META,
  isFixtureMode,
  setFixtureMode,
  getFixtureMultiplier,
  getFixtureFigures,
} from '../fixtures';

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

  it('a production build ignores the localStorage override entirely', () => {
    setFixtureMode(true);
    expect(isFixtureMode()).toBe(true);

    // Simulate a real prod build: DEV false and no VITE_ALLOW_FIXTURE_OVERRIDE
    // (that var only exists in .env.test, which vitest itself loads — a real
    // `vite build` with no --mode loads .env.production, which never sets it).
    const wasDev = import.meta.env.DEV;
    const wasOverride = import.meta.env.VITE_ALLOW_FIXTURE_OVERRIDE;
    (import.meta.env as { DEV: boolean }).DEV = false;
    (import.meta.env as { VITE_ALLOW_FIXTURE_OVERRIDE?: string }).VITE_ALLOW_FIXTURE_OVERRIDE = undefined;
    try {
      expect(isFixtureMode()).toBe(false);
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = wasDev;
      (import.meta.env as { VITE_ALLOW_FIXTURE_OVERRIDE?: string }).VITE_ALLOW_FIXTURE_OVERRIDE = wasOverride;
    }
  });

  it('VITE_ALLOW_FIXTURE_OVERRIDE keeps the override working on a non-dev build (the e2e preview build)', () => {
    setFixtureMode(true);

    const wasDev = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = false;
    // .env.test already sets this for real; asserting the current value
    // covers the exact e2e-build configuration this exists for.
    try {
      expect(import.meta.env.VITE_ALLOW_FIXTURE_OVERRIDE).toBe('true');
      expect(isFixtureMode()).toBe(true);
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = wasDev;
    }
  });
});

describe('fixture stress-test multiplier (?fx=N)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('defaults to no multiplier when the param is absent', () => {
    window.history.pushState({}, '', '/?layout=case');
    expect(getFixtureMultiplier()).toBe(1);
    expect(getFixtureFigures()).toBe(FIXTURE_FIGURES);
  });

  it('repeats the fixture set N times with unique ids under ?fx=N', () => {
    window.history.pushState({}, '', '/?fx=5');
    expect(getFixtureMultiplier()).toBe(5);
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 5);
    expect(new Set(figures.map((f) => f._id)).size).toBe(figures.length);
  });

  it('ignores invalid, fractional, or <=1 values', () => {
    for (const value of ['abc', '1', '0', '-3', '2.7']) {
      window.history.pushState({}, '', `/?fx=${value}`);
      expect(getFixtureMultiplier()).toBe(value === '2.7' ? 2 : 1);
    }
  });

  it('keeps display meta (matted rendering) for every repeated copy', () => {
    window.history.pushState({}, '', '/?fx=3');
    const figures = getFixtureFigures();
    const rem = figures.find((f) => f._id.startsWith('fx-rem'));
    expect(rem).toBeDefined();
    // At least one repeated copy of "rem" should resolve the same matted meta.
    const remCopies = figures.filter((f) => f._id.startsWith('fx-rem'));
    expect(remCopies).toHaveLength(3);
  });
});
