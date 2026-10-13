// Whether the compositor drew a control: a PNG of the screen where it stands is read back
// (decodePng) and its ink counted (inkShare). A tile the compositor dropped is one flat colour,
// so a control it never drew has no ink however its DOM box, style and hit-testing look.
import { inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** width x height RGBA bytes, row by row. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** An 8-bit, non-interlaced RGB or RGBA PNG (what a Chromium screenshot is) as RGBA. */
export function decodePng(png: Buffer): Rgba {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG: bit depth ${depth}, colour type ${colour}, interlace ${interlace}`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (channels === 0) throw new Error('PNG has no IHDR');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is short');
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[out + x - channels] : 0;
      const b = y > 0 ? rows[out - stride + x] : 0;
      const c = x >= channels && y > 0 ? rows[out - stride + x - channels] : 0;
      const v = raw[src + x];
      if (filter === 0) rows[out + x] = v;
      else if (filter === 1) rows[out + x] = (v + a) & 0xff;
      else if (filter === 2) rows[out + x] = (v + b) & 0xff;
      else if (filter === 3) rows[out + x] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) rows[out + x] = (v + paeth(a, b, c)) & 0xff;
      else throw new Error(`PNG row ${y} has filter ${filter}`);
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    data[j] = rows[i];
    data[j + 1] = rows[i + 1];
    data[j + 2] = rows[i + 2];
    data[j + 3] = 255;
  }
  return { width, height, data };
}

/**
 * The share (0..1) of the picture's pixels that differ from its commonest colour by more than
 * `delta` on a colour channel: a control's text, icon and edges against its own background.
 */
export function inkShare(image: Rgba, delta = 24): number {
  const total = image.width * image.height;
  if (total === 0) return 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < image.data.length; i += 4) {
    const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let common = 0;
  let best = -1;
  for (const [key, n] of counts) {
    if (n > best) {
      best = n;
      common = key;
    }
  }
  const [r, g, b] = [common >> 16, (common >> 8) & 0xff, common & 0xff];
  let ink = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (Math.abs(image.data[i] - r) > delta || Math.abs(image.data[i + 1] - g) > delta || Math.abs(image.data[i + 2] - b) > delta) ink++;
  }
  return ink / total;
}
