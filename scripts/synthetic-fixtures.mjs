// Draws the committed stand-in art for the seven dev fixtures:
// src/dev-fixtures/synthetic/<name>.png. Our own flat geometric figures on
// a transparent background (RGBA), at each fixture's native pixel size, so
// clean checkouts and CI render the case's matted branch. Beside each, the
// two halves of the masked branch (CASE-ADAPT): clean/<name>.png, the figure
// on an opaque studio backdrop (RGB, like a clean re-encoded product photo),
// and mask/<name>.png, white whose alpha is exactly the cut-out's; asym/
// holds the same three for figures moved off-centre in their pictures. No
// photos, no dependencies. Re-run after changing a shape:
// node scripts/synthetic-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', 'src', 'dev-fixtures', 'synthetic');
const SS = 4; // 4 x 4 samples per pixel for anti-aliased edges

// ── Shapes: [kind, color, ...params] in 0..1 fractions of the image box ──
const ellipse = (color, cx, cy, rx, ry) => ({ color, hit: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 });
const poly = (color, ...pts) => ({
  color,
  hit: (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
});
const rect = (color, x0, y0, x1, y1) => poly(color, [x0, y0], [x1, y0], [x1, y1], [x0, y1]);

const SKIN = [246, 214, 190];

// Painter's order: later shapes cover earlier ones. Each figure stands on
// its base (or its feet, where the fixture's base was not recovered) with a
// small transparent margin below, like a real cut-out.
const FIGURES = {
  rem: {
    size: [550, 800],
    shapes: [
      ellipse([150, 150, 160], 0.48, 0.93, 0.3, 0.04),
      poly([28, 30, 58], [0.3, 0.9], [0.66, 0.9], [0.58, 0.42], [0.38, 0.42]),
      poly([240, 240, 245], [0.4, 0.88], [0.56, 0.88], [0.52, 0.5], [0.44, 0.5]),
      rect(SKIN, 0.45, 0.36, 0.51, 0.43),
      ellipse(SKIN, 0.48, 0.3, 0.1, 0.08),
      ellipse([96, 150, 230], 0.48, 0.25, 0.12, 0.07),
      ellipse([96, 150, 230], 0.39, 0.32, 0.04, 0.08),
    ],
  },
  'dark-angel': {
    size: [600, 738],
    shapes: [
      poly([96, 40, 120], [0.34, 0.95], [0.66, 0.95], [0.6, 0.86], [0.4, 0.86]),
      poly([110, 50, 140], [0.48, 0.45], [0.02, 0.12], [0.2, 0.55]),
      poly([110, 50, 140], [0.52, 0.45], [0.98, 0.12], [0.8, 0.55]),
      poly([214, 90, 60], [0.43, 0.3], [0.57, 0.3], [0.6, 0.55], [0.4, 0.55]),
      poly([30, 24, 36], [0.42, 0.87], [0.58, 0.87], [0.56, 0.42], [0.44, 0.42]),
      ellipse(SKIN, 0.5, 0.35, 0.065, 0.06),
      ellipse([214, 90, 60], 0.5, 0.29, 0.085, 0.045),
    ],
  },
  'miku-nendo': {
    size: [523, 550],
    shapes: [
      ellipse([200, 215, 225], 0.5, 0.93, 0.28, 0.045),
      ellipse([40, 190, 190], 0.2, 0.55, 0.08, 0.3),
      ellipse([40, 190, 190], 0.8, 0.55, 0.08, 0.3),
      poly([70, 70, 80], [0.38, 0.9], [0.62, 0.9], [0.58, 0.6], [0.42, 0.6]),
      ellipse(SKIN, 0.5, 0.38, 0.24, 0.22),
      ellipse([40, 190, 190], 0.5, 0.26, 0.26, 0.14),
    ],
  },
  madoka: {
    size: [600, 712],
    shapes: [
      rect([250, 190, 205], 0.44, 0.84, 0.48, 0.96),
      rect([250, 190, 205], 0.52, 0.84, 0.56, 0.96),
      poly([250, 245, 250], [0.3, 0.86], [0.7, 0.86], [0.56, 0.44], [0.44, 0.44]),
      poly([235, 120, 160], [0.36, 0.72], [0.64, 0.72], [0.56, 0.46], [0.44, 0.46]),
      ellipse(SKIN, 0.5, 0.36, 0.08, 0.07),
      ellipse([235, 120, 160], 0.5, 0.31, 0.1, 0.06),
      ellipse([235, 120, 160], 0.37, 0.4, 0.04, 0.09),
      ellipse([235, 120, 160], 0.63, 0.4, 0.04, 0.09),
    ],
  },
  spike: {
    size: [550, 800],
    shapes: [
      rect([30, 34, 60], 0.44, 0.55, 0.49, 0.96),
      rect([30, 34, 60], 0.51, 0.55, 0.56, 0.96),
      poly([36, 44, 80], [0.4, 0.58], [0.6, 0.58], [0.58, 0.24], [0.42, 0.24]),
      poly([230, 200, 90], [0.47, 0.25], [0.53, 0.25], [0.5, 0.4]),
      ellipse(SKIN, 0.5, 0.18, 0.07, 0.06),
      ellipse([40, 40, 48], 0.5, 0.13, 0.09, 0.05),
    ],
  },
  'miku-deepsea': {
    size: [600, 400],
    shapes: [
      ellipse([24, 30, 60], 0.5, 0.88, 0.4, 0.07),
      rect([230, 110, 140], 0.12, 0.55, 0.14, 0.86),
      poly([230, 110, 140], [0.13, 0.62], [0.05, 0.5], [0.07, 0.48], [0.14, 0.58]),
      poly([230, 110, 140], [0.13, 0.66], [0.22, 0.52], [0.24, 0.54], [0.14, 0.7]),
      ellipse([30, 120, 200], 0.55, 0.62, 0.32, 0.2),
      poly([20, 20, 30], [0.38, 0.84], [0.72, 0.84], [0.66, 0.56], [0.44, 0.56]),
      ellipse(SKIN, 0.56, 0.44, 0.06, 0.09),
      ellipse([30, 120, 200], 0.56, 0.36, 0.09, 0.08),
    ],
  },
  ryuuko: {
    size: [600, 412],
    shapes: [
      poly([215, 230, 240], [0.1, 0.93], [0.55, 0.93], [0.5, 0.78], [0.14, 0.78]),
      poly([200, 40, 40], [0.3, 0.52], [0.95, 0.08], [0.96, 0.11], [0.32, 0.56]),
      poly([25, 25, 30], [0.2, 0.8], [0.46, 0.8], [0.4, 0.42], [0.28, 0.42]),
      poly([200, 40, 40], [0.26, 0.6], [0.42, 0.6], [0.4, 0.5], [0.28, 0.5]),
      ellipse(SKIN, 0.34, 0.33, 0.05, 0.08),
      ellipse([25, 25, 40], 0.34, 0.27, 0.07, 0.07),
    ],
  },
};

function rasterize([w, h], shapes) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / w;
          const v = (y + (sy + 0.5) / SS) / h;
          for (let i = shapes.length - 1; i >= 0; i--) {
            if (shapes[i].hit(u, v)) {
              [r, g, b] = [r + shapes[i].color[0], g + shapes[i].color[1], b + shapes[i].color[2]];
              covered++;
              break;
            }
          }
        }
      }
      const o = (y * w + x) * 4;
      if (covered) {
        px[o] = Math.round(r / covered);
        px[o + 1] = Math.round(g / covered);
        px[o + 2] = Math.round(b / covered);
        px[o + 3] = Math.round((255 * covered) / (SS * SS));
      }
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng([w, h], pixels, channels = 4) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // RGBA or RGB
  const raw = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * channels + 1) + 1, y * w * channels, (y + 1) * w * channels);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A soft grey studio sweep, lighter at the top: the clean copy's backdrop.
function backdrop(h, y) {
  const v = Math.round(236 - (24 * y) / Math.max(1, h - 1));
  return [v, v, v + 2];
}

/** The cut-out over the backdrop, opaque (RGB). */
function cleanCopy([w, h], rgba) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const bg = backdrop(h, y);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = rgba[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + bg[c] * (1 - a));
    }
  }
  return rgb;
}

/** White, with the cut-out's alpha: what CSS mask-image reads. */
function maskOf([w, h], rgba) {
  const mask = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) mask[i * 4 + 3] = rgba[i * 4 + 3];
  return mask;
}

function write(file, png, size) {
  writeFileSync(file, png);
  console.log(`${path.relative(process.cwd(), file)} ${size[0]}x${size[1]} ${png.length} bytes`);
}

/** The cut-out moved sideways by dx px (clear where it moved from). */
function shifted([w, h], rgba, dx) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) rgba.copy(out, (y * w + x + dx) * 4, (y * w + x) * 4, (y * w + x + 1) * 4);
  }
  return out;
}

/** The cut-out, its clean copy and its mask, under `dir`. */
function writeAll(dir, name, size, rgba) {
  for (const sub of [dir, path.join(dir, 'clean'), path.join(dir, 'mask')]) mkdirSync(sub, { recursive: true });
  write(path.join(dir, `${name}.png`), encodePng(size, rgba), size);
  write(path.join(dir, 'clean', `${name}.png`), encodePng(size, cleanCopy(size, rgba), 3), size);
  write(path.join(dir, 'mask', `${name}.png`), encodePng(size, maskOf(size, rgba)), size);
}

// Off-centre stand-ins (?fxasym=1): the same figure moved sideways in its
// picture, as a real cut-out can stand (a staff held out, a base off to one
// side). Moved by whole pixels, so it is exactly the figure above: Rem 88 px
// left (2 % clear left, 38 % right), Spike 165 px right (70 % left, 10 % right).
const ASYM = { rem: -88, spike: 165 };

for (const [name, { size, shapes }] of Object.entries(FIGURES)) {
  const rgba = rasterize(size, shapes);
  writeAll(OUT, name, size, rgba);
  if (ASYM[name]) writeAll(path.join(OUT, 'asym'), name, size, shifted(size, rgba, ASYM[name]));
}
