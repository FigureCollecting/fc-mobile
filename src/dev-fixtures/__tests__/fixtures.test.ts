import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  FIXTURE_FIGURES,
  FIXTURE_META,
  isFixtureMode,
  setFixtureMode,
  getFixtureMultiplier,
  getFixtureFigures,
  getFixtureBranch,
  getFixtureWidths,
  getFixtureImageRef,
  resolveFixtureArt,
} from '../fixtures';
import { getDisplayMeta } from '../../components/display/displayMeta';
import { figureArt } from '../../components/display/figureArt';
import { measureCaseFigure } from '../../components/display/packCabinets';

/** The unfiltered pixels of a PNG this repo's script wrote (one IDAT, filter 0 on every row). */
function pngPixels(file: string): { width: number; height: number; channels: number; rows: Buffer[] } {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  let o = 8;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels + 1;
  const rows = Array.from({ length: height }, (_, y) => {
    expect(raw[y * stride], 'filter type 0').toBe(0);
    return raw.subarray(y * stride + 1, (y + 1) * stride);
  });
  return { width, height, channels, rows };
}

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

  it('has an opaque clean copy (RGB, a studio backdrop) and a mask whose alpha IS the cut-out\'s, for every figure (CASE-ADAPT)', () => {
    for (const f of FIXTURE_FIGURES) {
      const name = f._id.replace(/^fx-/, '');
      const cut = pngPixels(path.join(SYNTHETIC_DIR, `${name}.png`));
      const clean = pngPixels(path.join(SYNTHETIC_DIR, 'clean', `${name}.png`));
      const mask = pngPixels(path.join(SYNTHETIC_DIR, 'mask', `${name}.png`));
      expect([clean.width, clean.height, clean.channels]).toEqual([cut.width, cut.height, 3]);
      expect([mask.width, mask.height, mask.channels]).toEqual([cut.width, cut.height, 4]);
      let drawn = 0;
      let alphaOff = 0;
      let colourOff = 0;
      for (let y = 0; y < cut.height; y++) {
        for (let x = 0; x < cut.width; x++) {
          const a = cut.rows[y][x * 4 + 3];
          if (mask.rows[y][x * 4 + 3] !== a) alphaOff++;
          if (a === 255) {
            drawn++;
            // where the figure is solid the clean copy shows the figure itself
            for (let c = 0; c < 3; c++) if (clean.rows[y][x * 3 + c] !== cut.rows[y][x * 4 + c]) colourOff++;
          }
        }
      }
      expect({ name, alphaOff, colourOff }).toEqual({ name, alphaOff: 0, colourOff: 0 });
      expect(drawn, name).toBeGreaterThan(1000);
    }
  });

  it("labels each figure with the width its cut-out draws at true scale, rounded up: the case packs it by that, never narrower", () => {
    for (const f of FIXTURE_FIGURES) {
      const name = f._id.replace(/^fx-/, '');
      const cut = pngPixels(path.join(SYNTHETIC_DIR, `${name}.png`));
      let [x0, x1, y0, y1] = [cut.width, -1, cut.height, -1];
      for (let y = 0; y < cut.height; y++) {
        for (let x = 0; x < cut.width; x++) {
          if (cut.rows[y][x * 4 + 3] <= 10) continue;
          [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
        }
      }
      const heightMm = f.dimensions!.heightMm!;
      // drawn so its opaque rows are heightMm tall over its clear margins (pictureBox)
      const pictureH = heightMm / (1 - y0 / cut.height - (cut.height - 1 - y1) / cut.height);
      const opaqueFrac = (x1 - x0 + 1) / cut.width;
      const meta = getDisplayMeta(f);
      // as a cut-out (the display meta's aspect) and as masked art (the image list's own size)
      const drawn = Math.max(opaqueFrac * meta.aspect * pictureH, opaqueFrac * (cut.width / cut.height) * pictureH);
      const footprint = measureCaseFigure(f, 0, meta).widthMm;
      expect(f.dimensions!.widthMm, name).toBe(footprint);
      expect(footprint, name).toBeGreaterThanOrEqual(drawn);
      expect(footprint - drawn, name).toBeLessThan(1);
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

describe('fixture render branch (?fxbranch=masked|framed|silhouette)', () => {
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

  it('framed: the same figures on their opaque clean copies, unmatted like a real figure, so the case frames the photo', () => {
    window.history.pushState({}, '', '/?fxbranch=framed');
    expect(getFixtureBranch()).toBe('framed');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      expect(f.name).toBe(FIXTURE_FIGURES[i].name);
      expect(f.imageUrl).toMatch(new RegExp(`/synthetic/clean/${FIXTURE_FIGURES[i]._id.replace(/^fx-/, '')}\\.png$`));
      expect(f._id).not.toBe(FIXTURE_FIGURES[i]._id);
      expect(getDisplayMeta(f).matted).toBe(false);
      expect(getFixtureImageRef(f)).toBeUndefined();
      expect(figureArt(f, getDisplayMeta(f), getFixtureImageRef(f)).kind).toBe('framed');
    });
  });

  it('masked: the clean copy with its separate mask, as the image list will give it (CASE-ADAPT)', () => {
    window.history.pushState({}, '', '/?fxbranch=masked');
    expect(getFixtureBranch()).toBe('masked');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      const name = FIXTURE_FIGURES[i]._id.replace(/^fx-/, '');
      expect(f._id).toBe(`${FIXTURE_FIGURES[i]._id}-masked`);
      const ref = getFixtureImageRef(f);
      expect(ref?.url).toMatch(new RegExp(`/synthetic/clean/${name}\\.png$`));
      expect(ref?.maskUrl).toMatch(new RegExp(`/synthetic/mask/${name}\\.png$`));
      expect(ref?.width).toBe(FIXTURE_META[FIXTURE_FIGURES[i]._id].width);
      expect(figureArt(f, getDisplayMeta(f), ref).kind).toBe('masked');
    });
    // the plain fixtures carry no image list entry: they are cut-outs
    expect(getFixtureImageRef(FIXTURE_FIGURES[0])).toBeUndefined();
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

describe('fixture labelled widths (?fxwidth=none|narrow): the shapes a real collection brings to the case', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('defaults to the labelled widths: the fixture set itself', () => {
    for (const query of ['/', '/?fxwidth=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixtureWidths()).toBe('labelled');
      expect(getFixtureFigures()).toBe(FIXTURE_FIGURES);
    }
  });

  it('none: the same figures without a labelled width, their heights kept', () => {
    window.history.pushState({}, '', '/?fxwidth=none');
    expect(getFixtureWidths()).toBe('none');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      expect(f._id).toBe(FIXTURE_FIGURES[i]._id);
      expect(f.imageUrl).toBe(FIXTURE_FIGURES[i].imageUrl);
      expect(f.dimensions).toEqual({ heightMm: FIXTURE_FIGURES[i].dimensions!.heightMm });
    });
  });

  it('narrow: each labelled half as wide, well under what its cut-out draws at true scale, as the real sign-off cut-outs are', () => {
    window.history.pushState({}, '', '/?fxwidth=narrow');
    expect(getFixtureWidths()).toBe('narrow');
    const figures = getFixtureFigures();
    figures.forEach((f, i) => {
      const label = FIXTURE_FIGURES[i].dimensions!.widthMm!;
      expect(f.dimensions).toEqual({ heightMm: FIXTURE_FIGURES[i].dimensions!.heightMm, widthMm: Math.round(label / 2) });
      // the synthetic labels are their true-scale drawn width rounded up (above): half is under it
      expect(f.dimensions!.widthMm!).toBeLessThan(label - 1);
    });
  });

  it('combines with ?fx=N and ?fxbranch', () => {
    window.history.pushState({}, '', '/?fx=2&fxbranch=masked&fxwidth=none');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 2);
    expect(new Set(figures.map((f) => f._id)).size).toBe(figures.length);
    for (const f of figures) {
      expect(f._id).toMatch(/-masked$/);
      expect(f.dimensions?.widthMm).toBeUndefined();
    }
  });
});
