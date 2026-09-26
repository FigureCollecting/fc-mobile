import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FIXTURE_FIGURES,
  FIXTURE_META,
  isFixtureMode,
  setFixtureMode,
  getFixtureMultiplier,
  getFixtureFigures,
  getFixtureBranch,
  resolveFixtureArt,
} from '../fixtures';
import { getDisplayMeta } from '../../components/display/displayMeta';

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

describe('fixture art: committed synthetic stand-ins, real cut-outs only for local sign-off', () => {
  const SYNTHETIC_DIR = path.resolve(import.meta.dirname, '../synthetic');

  it('gives every fixture an image in tests, always the committed synthetic art (never a git-ignored cut-out)', () => {
    expect(import.meta.env.VITE_FIXTURE_ART).toBe('synthetic');
    for (const f of FIXTURE_FIGURES) {
      expect(f.imageUrl, f._id).toMatch(new RegExp(`/synthetic/${f._id.replace(/^fx-/, '')}\\.png$`));
    }
  });

  it('draws each synthetic figure as an RGBA PNG at its fixture\'s native size', () => {
    for (const f of FIXTURE_FIGURES) {
      const png = readFileSync(path.join(SYNTHETIC_DIR, `${f._id.replace(/^fx-/, '')}.png`));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(FIXTURE_META[f._id].width);
      expect(png.readUInt32BE(20)).toBe(FIXTURE_META[f._id].height);
      expect(png[25], 'colour type 6 = RGBA').toBe(6);
    }
  });

  it('prefers a real cut-out when present, unless synthetic-only, and falls back to the synthetic art', () => {
    const real = { './rem.png': '/real/rem.png' };
    const synthetic = { './synthetic/rem.png': '/synthetic/rem.png', './synthetic/spike.png': '/synthetic/spike.png' };
    expect(resolveFixtureArt('rem', { real, synthetic, syntheticOnly: false })).toBe('/real/rem.png');
    expect(resolveFixtureArt('rem', { real, synthetic, syntheticOnly: true })).toBe('/synthetic/rem.png');
    expect(resolveFixtureArt('spike', { real, synthetic, syntheticOnly: false })).toBe('/synthetic/spike.png');
    expect(resolveFixtureArt('madoka', { real, synthetic, syntheticOnly: false })).toBeUndefined();
  });
});

describe('fixture render branch (?fxbranch=framed|silhouette)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('defaults to the matted branch: the fixture set itself', () => {
    for (const query of ['/', '/?fxbranch=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixtureBranch()).toBe('matted');
      expect(getFixtureFigures()).toBe(FIXTURE_FIGURES);
    }
  });

  it('framed: the same figures and images, but unmatted like a real figure, so the case frames the photo', () => {
    window.history.pushState({}, '', '/?fxbranch=framed');
    expect(getFixtureBranch()).toBe('framed');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      expect(f.name).toBe(FIXTURE_FIGURES[i].name);
      expect(f.imageUrl).toBe(FIXTURE_FIGURES[i].imageUrl);
      expect(f._id).not.toBe(FIXTURE_FIGURES[i]._id);
      expect(getDisplayMeta(f).matted).toBe(false);
    });
  });

  it('silhouette: the same figures without images', () => {
    window.history.pushState({}, '', '/?fxbranch=silhouette');
    expect(getFixtureBranch()).toBe('silhouette');
    const figures = getFixtureFigures();
    expect(figures.map((f) => f._id)).toEqual(FIXTURE_FIGURES.map((f) => f._id));
    for (const f of figures) expect(f.imageUrl).toBeUndefined();
  });

  it('combines with the ?fx=N multiplier, keeping ids unique', () => {
    window.history.pushState({}, '', '/?fx=2&fxbranch=framed');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 2);
    expect(new Set(figures.map((f) => f._id)).size).toBe(figures.length);
    for (const f of figures) expect(getDisplayMeta(f).matted).toBe(false);
  });
});
