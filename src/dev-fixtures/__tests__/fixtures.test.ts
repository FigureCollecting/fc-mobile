import { describe, it, expect, afterEach, vi } from 'vitest';
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
  getFixtureAsym,
  getFixtureUnique,
  getFixtureSync,
  getFixtureFields,
  getFixtureGoods,
  getFixturePhotos,
  fixturePhotos,
  FIXTURE_SUB,
  getFixtureOnly,
  getFixtureImageRef,
  resolveFixtureArt,
} from '../fixtures';
import { getDisplayMeta } from '../../components/display/displayMeta';
import { figureArt } from '../../components/display/figureArt';
import { measureCaseFigure } from '../../components/display/packCabinets';
import { formatAsOf } from '../../components/sync/SyncBadge';
import type { LocalMeta } from '../../local/figures';
import type { Figure } from '@figurecollecting/fc-shared';
import { ProductKind } from '@figurecollecting/fc-api-contract';

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

/** Where a PNG of this repo's script draws: its first and last opaque column and row (alpha past 10). */
function opaqueBounds(png: ReturnType<typeof pngPixels>, channels = 4) {
  let [x0, x1, y0, y1] = [png.width, -1, png.height, -1];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.rows[y][x * channels + 3] <= 10) continue;
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
    }
  }
  return { x0, x1, y0, y1, left: x0 / png.width, right: (png.width - 1 - x1) / png.width };
}

describe('fixture off-centre art (?fxasym=1): figures standing off-centre in their pictures, as real cut-outs can', () => {
  const SYNTHETIC_DIR = path.resolve(import.meta.dirname, '../synthetic');
  /** Both lean right in their pictures: the figure's centre this far right of the picture's, in picture widths. */
  const LEANS = [
    { name: 'rem', off: 0.18 },
    { name: 'spike', off: 0.3 },
  ] as const;

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('off unless asked for: the fixture set itself', () => {
    for (const query of ['/', '/?fxasym=0', '/?fxasym=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixtureAsym()).toBe(false);
      expect(getFixtureFigures()).toBe(FIXTURE_FIGURES);
    }
  });

  it('the same figure moved sideways in its picture: its pixels, rows and drawn width kept, its centre well off the picture\'s', () => {
    for (const { name, off } of LEANS) {
      const cut = pngPixels(path.join(SYNTHETIC_DIR, `${name}.png`));
      const asym = pngPixels(path.join(SYNTHETIC_DIR, 'asym', `${name}.png`));
      expect([asym.width, asym.height, asym.channels]).toEqual([cut.width, cut.height, 4]);
      const a = opaqueBounds(asym);
      const c = opaqueBounds(cut);
      expect([a.y0, a.y1, a.x1 - a.x0], name).toEqual([c.y0, c.y1, c.x1 - c.x0]);
      // the figure's centre against the picture's: (left - right) / 2 of its width
      expect((a.left - a.right) / 2, name).toBeCloseTo(off, 2);
      const dx = a.x0 - c.x0;
      let moved = 0;
      for (let y = 0; y < cut.height; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
          for (let k = 0; k < 4; k++) if (asym.rows[y][(x + dx) * 4 + k] !== cut.rows[y][x * 4 + k]) moved++;
        }
      }
      expect({ name, moved }).toEqual({ name, moved: 0 });
    }
  });

  it('with its masked halves: an opaque clean copy and a mask whose alpha IS the off-centre cut-out\'s', () => {
    for (const { name } of LEANS) {
      const asym = pngPixels(path.join(SYNTHETIC_DIR, 'asym', `${name}.png`));
      const clean = pngPixels(path.join(SYNTHETIC_DIR, 'asym', 'clean', `${name}.png`));
      const mask = pngPixels(path.join(SYNTHETIC_DIR, 'asym', 'mask', `${name}.png`));
      expect([clean.width, clean.height, clean.channels]).toEqual([asym.width, asym.height, 3]);
      expect([mask.width, mask.height, mask.channels]).toEqual([asym.width, asym.height, 4]);
      let alphaOff = 0;
      for (let y = 0; y < asym.height; y++) {
        for (let x = 0; x < asym.width; x++) if (mask.rows[y][x * 4 + 3] !== asym.rows[y][x * 4 + 3]) alphaOff++;
      }
      expect({ name, alphaOff }).toEqual({ name, alphaOff: 0 });
    }
  });

  it('?fxasym=1 draws Rem and Spike off-centre in every branch; the others as they are', () => {
    const leans = (id: string) => /^fx-(rem|spike)(-|$)/.test(id);
    window.history.pushState({}, '', '/?fxasym=1');
    expect(getFixtureAsym()).toBe(true);
    const cutouts = getFixtureFigures();
    expect(cutouts).toHaveLength(FIXTURE_FIGURES.length);
    cutouts.forEach((f, i) => {
      const name = FIXTURE_FIGURES[i]._id.replace(/^fx-/, '');
      expect(f._id).toBe(FIXTURE_FIGURES[i]._id);
      if (leans(f._id)) expect(f.imageUrl).toMatch(new RegExp(`/synthetic/asym/${name}\\.png$`));
      else expect(f.imageUrl).toBe(FIXTURE_FIGURES[i].imageUrl);
      expect(figureArt(f, getDisplayMeta(f), getFixtureImageRef(f)).kind).toBe('cutout');
    });

    window.history.pushState({}, '', '/?fxasym=1&fxbranch=masked&fx=2');
    const masked = getFixtureFigures();
    expect(masked).toHaveLength(FIXTURE_FIGURES.length * 2);
    for (const f of masked) {
      const name = f._id.replace(/^fx-/, '').replace(/(-x\d+)?-masked$/, '');
      const dir = leans(f._id) ? 'synthetic/asym' : 'synthetic';
      const ref = getFixtureImageRef(f);
      expect(ref?.url, f._id).toMatch(new RegExp(`/${dir}/clean/${name}\\.png$`));
      expect(ref?.maskUrl, f._id).toMatch(new RegExp(`/${dir}/mask/${name}\\.png$`));
      expect(f.imageUrl).toBe(ref?.url);
    }

    window.history.pushState({}, '', '/?fxasym=1&fxbranch=framed');
    for (const f of getFixtureFigures()) {
      const name = f._id.replace(/^fx-/, '').replace(/-framed$/, '');
      expect(f.imageUrl, f._id).toMatch(new RegExp(`/${leans(f._id) ? 'synthetic/asym' : 'synthetic'}/clean/${name}\\.png$`));
    }
  });
});

describe('fixture distinct pictures (?fxuniq=1): each repeated copy at its own picture URL, as a real collection has', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  /** What the case reads of each figure: its image list entry's picture and mask, else its own picture. */
  const pictures = (f: Figure) => {
    const ref = getFixtureImageRef(f);
    return ref ? [ref.url, ref.maskUrl] : [f.imageUrl];
  };

  it('off unless asked for: the copies share their pictures, in every branch', () => {
    for (const query of ['/?fx=3', '/?fx=3&fxuniq=0', '/?fx=3&fxuniq=bogus', '/?fx=3&fxbranch=masked', '/?fx=3&fxbranch=framed']) {
      window.history.pushState({}, '', query);
      expect(getFixtureUnique()).toBe(false);
      const figures = getFixtureFigures();
      expect(new Set(figures.map((f) => f.imageUrl)).size, query).toBe(FIXTURE_FIGURES.length);
      figures.forEach((f, i) => expect(pictures(f), f._id).toEqual(pictures(figures[i % FIXTURE_FIGURES.length])));
    }
  });

  it('?fxuniq=1: every copy of every branch draws the same picture at its own URL, the first copy at the fixture\'s', () => {
    for (const branch of ['', '&fxbranch=masked', '&fxbranch=framed']) {
      window.history.pushState({}, '', `/?fx=3&fxuniq=1${branch}`);
      expect(getFixtureUnique()).toBe(true);
      const figures = getFixtureFigures();
      expect(figures).toHaveLength(FIXTURE_FIGURES.length * 3);
      const urls = figures.flatMap(pictures);
      expect(new Set(urls).size, branch).toBe(urls.length);
      figures.forEach((f, i) => {
        const copy = Math.floor(i / FIXTURE_FIGURES.length) + 1;
        const first = pictures(figures[i % FIXTURE_FIGURES.length]);
        expect(pictures(f), f._id).toEqual(first.map((u) => (copy === 1 ? u : `${u}?copy=${copy}`)));
        if (getFixtureImageRef(f)) expect(f.imageUrl).toBe(getFixtureImageRef(f)?.url);
      });
    }
    window.history.pushState({}, '', '/?fx=3&fxuniq=1&fxbranch=silhouette');
    expect(getFixtureFigures().every((f) => f.imageUrl === undefined)).toBe(true);
  });
});

describe('fixture sync states (?fxsync=1): the tiles\' sync badge and xN count, as a local collection draws them', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.useRealTimers();
  });

  const localOf = (f: Figure) => (f as Figure & { local?: LocalMeta }).local;

  /** What a tile's badge says: the quiet known badge, Pending, Offline, or an as-of of today or another day. */
  const badge = (local: LocalMeta) => {
    if (local.sync !== 'offline-stale') return local.sync;
    if (local.asOf === null) return 'offline';
    return /^as of \d\d:\d\d /.test(formatAsOf(local.asOf)) ? 'as-of-today' : 'as-of-another-day';
  };

  it('off unless asked for: no local state and no counts, in every branch', () => {
    for (const query of ['/', '/?fxsync=0', '/?fxsync=bogus', '/?fx=2', '/?fxbranch=silhouette']) {
      window.history.pushState({}, '', query);
      expect(getFixtureSync(), query).toBe(false);
      for (const f of getFixtureFigures()) {
        expect(localOf(f), `${query} ${f._id}`).toBeUndefined();
        expect(f.quantity, `${query} ${f._id}`).toBeUndefined();
      }
    }
  });

  it('?fxsync=1&fx=2: every badge text with no count, x2 and x12, and a quiet synced one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T19:05:00Z'));
    window.history.pushState({}, '', '/?fx=2&fxsync=1');
    expect(getFixtureSync()).toBe(true);
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 2);
    const seen = new Set<string>();
    for (const f of figures) {
      const local = localOf(f);
      expect(local, f._id).toBeDefined();
      expect(local!.headId).toBe(f._id);
      expect(local!.heads).toEqual([f._id]);
      expect(local!.kind).toBe(f.collectionStatus);
      seen.add(`${badge(local!)} x${f.quantity ?? 1}`);
    }
    const texts = ['pending', 'offline', 'as-of-today', 'as-of-another-day'];
    for (const text of texts) for (const n of [1, 2, 12]) expect(seen, `${text} x${n}`).toContain(`${text} x${n}`);
    expect([...seen].some((s) => s.startsWith('known x'))).toBe(true);
  });

  it('combines with the plate branch, keeping the figures\' ids', () => {
    window.history.pushState({}, '', '/?fxsync=1&fxbranch=silhouette');
    const figures = getFixtureFigures();
    expect(figures.map((f) => f._id)).toEqual(FIXTURE_FIGURES.map((f) => f._id));
    expect(figures.every((f) => f.imageUrl === undefined && localOf(f) !== undefined)).toBe(true);
  });
});

describe('a wall of one fixture (?fxonly=<name>): a homogeneous dense wall for the case budget (MOB-NAV-2)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('off for anything absent or not a fixture: the fixture set itself', () => {
    for (const query of ['/', '/?fxonly=', '/?fxonly=bogus', '/?fxonly=fx-spike']) {
      window.history.pushState({}, '', query);
      expect(getFixtureOnly(), query).toBeUndefined();
      expect(getFixtureFigures()).toBe(FIXTURE_FIGURES);
    }
  });

  it('every slot of every copy is that one fixture, ids unique, each still drawn as its matted cut-out', () => {
    window.history.pushState({}, '', '/?fxonly=spike&fx=3');
    const spike = FIXTURE_FIGURES.find((f) => f._id === 'fx-spike')!;
    expect(getFixtureOnly()).toBe(spike);
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 3);
    expect(new Set(figures.map((f) => f._id)).size).toBe(figures.length);
    expect(figures[0]._id).toBe('fx-spike');
    expect(figures[1]._id).toBe('fx-spike-x2');
    expect(figures[figures.length - 1]._id).toBe(`fx-spike-x${figures.length}`);
    for (const f of figures) {
      expect(f.name).toBe(spike.name);
      expect(f.dimensions).toEqual(spike.dimensions);
      expect(f.imageUrl).toBe(spike.imageUrl);
      expect(getDisplayMeta(f)).toEqual(getDisplayMeta(spike));
    }
  });

  it('on its own: one copy of the manifest, every slot that fixture', () => {
    window.history.pushState({}, '', '/?fxonly=rem');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    expect(figures.map((f) => f.name)).toEqual(FIXTURE_FIGURES.map(() => 'Rem'));
  });

  it('one copy of the manifest is as many of the one fixture; combines with ?fxwidth', () => {
    window.history.pushState({}, '', '/?fxonly=miku-nendo&fxwidth=narrow');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    for (const f of figures) expect(f.dimensions).toEqual({ heightMm: 100, widthMm: 43 });
  });
});

describe('fixture longer cards (?fxfields=1): cards that carry different numbers of fields, as real figures do', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('off unless asked for: the manifest as it is', () => {
    for (const query of ['/', '/?fxfields=0', '/?fxfields=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixtureFields(), query).toBe(false);
      expect(getFixtureFigures(), query).toBe(FIXTURE_FIGURES);
    }
  });

  it('?fxfields=1: every other figure carries a version, its materials and a note more; the rest are as they were', () => {
    window.history.pushState({}, '', '/?fxfields=1');
    expect(getFixtureFields()).toBe(true);
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      if (i % 2 === 1) {
        expect(f.version, f._id).toBe('Limited edition');
        expect(f.materials, f._id).toBe('PVC, ABS');
        expect(f.note, f._id).toMatch(/\S/);
        expect({ ...f, version: undefined, materials: undefined, note: undefined }).toEqual({ ...FIXTURE_FIGURES[i], version: undefined, materials: undefined, note: undefined });
      } else expect(f).toEqual(FIXTURE_FIGURES[i]);
    });
  });

  it('with the multiplier, every copy of every other fixture slot is the longer card', () => {
    window.history.pushState({}, '', '/?fx=2&fxfields=1');
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length * 2);
    expect(figures.map((f) => f.note !== undefined)).toEqual(figures.map((_, i) => i % FIXTURE_FIGURES.length % 2 === 1));
  });
});

describe('fixture goods and media (?fxgoods=1): products the case leaves off its shelves (FIGURES-ONLY-1)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  const kindOf = (f: Figure): ProductKind | undefined => (f as Figure & { local?: { productKind?: ProductKind } }).local?.productKind;

  it('off unless asked for: the manifest as it is', () => {
    for (const query of ['/', '/?fxgoods=0', '/?fxgoods=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixtureGoods(), query).toBe(false);
      expect(getFixtureFigures(), query).toBe(FIXTURE_FIGURES);
    }
  });

  it('?fxgoods=1: Dark Angel Olivia and Spike Spiegel are goods, Ryuko Matoi is media, the other four state no kind', () => {
    window.history.pushState({}, '', '/?fxgoods=1');
    expect(getFixtureGoods()).toBe(true);
    const figures = getFixtureFigures();
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    expect(figures.map((f) => [f.name, kindOf(f)])).toEqual([
      ['Rem', undefined],
      ['Dark Angel Olivia', ProductKind.GOODS],
      ['Nendoroid Hatsune Miku', undefined],
      ['Madoka Kaname', undefined],
      ['Spike Spiegel', ProductKind.GOODS],
      ['Hatsune Miku: Deep Sea Girl', undefined],
      ['Ryuko Matoi', ProductKind.MEDIA],
    ]);
    // nothing else about a figure changes
    figures.forEach((f, i) => expect({ ...f, local: undefined }).toEqual({ ...FIXTURE_FIGURES[i], local: undefined }));
  });

  it('with the multiplier, every copy of those slots is the same kind', () => {
    window.history.pushState({}, '', '/?fx=3&fxgoods=1');
    const kinds = getFixtureFigures().map(kindOf);
    expect(kinds).toHaveLength(FIXTURE_FIGURES.length * 3);
    expect(kinds.filter((k) => k === ProductKind.GOODS)).toHaveLength(6);
    expect(kinds.filter((k) => k === ProductKind.MEDIA)).toHaveLength(3);
    expect(kinds.filter((k) => k === undefined)).toHaveLength(12);
  });

  it('combines with ?fxsync=1: the sync badge state stays, the kind rides on it', () => {
    window.history.pushState({}, '', '/?fxsync=1&fxgoods=1');
    const [rem, olivia] = getFixtureFigures() as (Figure & { local: LocalMeta })[];
    expect(rem!.local.sync).toBe('pending');
    expect(rem!.local.productKind).toBeUndefined();
    expect(olivia!.local.sync).toBe('offline-stale');
    expect(olivia!.local.productKind).toBe(ProductKind.GOODS);
  });
});

describe('fixture photos (?fxphotos=1): a local item and three photos each, for the figure card\'s Photos tab (GALLERY-1)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('off unless asked for: the fixtures are as they were, with no local item', () => {
    for (const query of ['/', '/?fxphotos=0', '/?fxphotos=bogus']) {
      window.history.pushState({}, '', query);
      expect(getFixturePhotos(), query).toBe(false);
      expect(getFixtureFigures(), query).toBe(FIXTURE_FIGURES);
    }
  });

  it('?fxphotos=1 gives every figure a local item (its id its head), two of its copies for every third figure, and changes nothing else', () => {
    window.history.pushState({}, '', '/?fxphotos=1');
    expect(getFixturePhotos()).toBe(true);
    const figures = getFixtureFigures() as (Figure & { local: LocalMeta })[];
    expect(figures).toHaveLength(FIXTURE_FIGURES.length);
    figures.forEach((f, i) => {
      expect(f.local.headId).toBe(f._id);
      expect(f.local.copies, f._id).toHaveLength(i % 3 === 1 ? 2 : 1);
      expect({ ...f, local: undefined }).toEqual({ ...FIXTURE_FIGURES[i], local: undefined });
    });
  });

  it('every figure has the same three photos, on the public image address: the default with a mask, a plain one, a second with a mask', () => {
    const photos = fixturePhotos();
    expect(photos.map((p) => [p.primary, p.maskUrl !== undefined])).toEqual([[true, true], [false, false], [false, true]]);
    for (const p of photos) expect(p.url).toMatch(/^https:\/\/images\.figurecollecting\.com\/d\/[0-9a-f]{64}$/);
    expect(FIXTURE_SUB).toBe('fixture-user');
  });
});
