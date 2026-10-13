import { deflateSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, inkShare, type Rgba } from './paintCheck';

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A PNG of `pixels` (RGBA), each row with its own filter, in colour type 6 or (alpha dropped) 2. */
function encodePng(width: number, height: number, pixels: number[], filters: number[], colour: 2 | 6 = 6, depth = 8, interlace = 0): Buffer {
  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const p = pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
      row.push(...p.slice(0, channels));
    }
    rows.push(row);
  }
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const raw: number[] = [];
  rows.forEach((row, y) => {
    const f = filters[y % filters.length];
    raw.push(f);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = y > 0 ? rows[y - 1][x] : 0;
      const c = x >= channels && y > 0 ? rows[y - 1][x - channels] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw.push((row[x] - pred) & 0xff);
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colour;
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Software\0test', 'latin1')),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 5 x 4 picture whose every channel varies, so each filter has something to predict. */
const W = 5;
const H = 4;
const PIXELS = Array.from({ length: W * H }, (_, i) => [(i * 37) & 0xff, (i * 91 + 13) & 0xff, (255 - i * 11) & 0xff, (i * 53 + 100) & 0xff]).flat();

const flat = (width: number, height: number, rgb: [number, number, number]): Rgba => ({
  width,
  height,
  data: Uint8Array.from(Array.from({ length: width * height }, () => [...rgb, 255]).flat()),
});

describe('decodePng', () => {
  it('reads every row filter (none, sub, up, average, paeth) back to the same RGBA', () => {
    for (const f of [0, 1, 2, 3, 4]) {
      const img = decodePng(encodePng(W, H, PIXELS, [f]));
      expect([img.width, img.height]).toEqual([W, H]);
      expect(Array.from(img.data)).toEqual(PIXELS);
    }
    // a different filter on each row
    expect(Array.from(decodePng(encodePng(W, H, PIXELS, [4, 3, 1, 2])).data)).toEqual(PIXELS);
  });

  it("breaks paeth's ties as the PNG spec does: left before up before up-left", () => {
    // at (1, 1): left a = 0, up b = 30, up-left c = 10, so |p - b| = |p - c| = 10 and paeth predicts b
    const px = [10, 30, 0, 99].flatMap((v) => [v, v, v, 255]);
    const img = decodePng(encodePng(2, 2, px, [0, 4]));
    expect(Array.from(img.data)).toEqual(px);
  });

  it('reads an RGB picture (colour type 2) as opaque RGBA', () => {
    const img = decodePng(encodePng(W, H, PIXELS, [4, 0], 2));
    const opaque = PIXELS.map((v, i) => (i % 4 === 3 ? 255 : v));
    expect(Array.from(img.data)).toEqual(opaque);
  });

  it('refuses what is not an 8-bit, non-interlaced RGB or RGBA PNG', () => {
    expect(() => decodePng(Buffer.from('GIF89a......'))).toThrow(/not a PNG/);
    expect(() => decodePng(encodePng(W, H, PIXELS, [0], 6, 16))).toThrow(/bit depth 16/);
    expect(() => decodePng(encodePng(W, H, PIXELS, [0], 6, 8, 1))).toThrow(/interlace 1/);
    const grey = encodePng(W, H, PIXELS, [0]);
    grey[8 + 8 + 9] = 0; // IHDR colour type
    expect(() => decodePng(grey)).toThrow(/colour type 0/);
    const noHeader = Buffer.concat([grey.subarray(0, 8), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(noHeader)).toThrow(/no IHDR/);
  });

  it('refuses image data shorter than the header says, and a row filter past 4', () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // the rows without their filter bytes: one byte per row short
    const short = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(2 * 2 * 4))), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(short)).toThrow(/short/);
    const badFilter = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([5, ...new Array(8).fill(0), 0, ...new Array(8).fill(0)]))), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(badFilter)).toThrow(/row 0 has filter 5/);
  });
});

describe('inkShare', () => {
  it('is 0 for one flat colour: a tile the compositor never drew', () => {
    expect(inkShare(flat(8, 8, [10, 10, 12]))).toBe(0);
    expect(inkShare({ width: 0, height: 0, data: new Uint8Array(0) })).toBe(0);
  });

  it('counts the pixels off the commonest colour by more than delta on any channel', () => {
    const img = flat(10, 10, [20, 20, 20]);
    const set = (i: number, rgb: [number, number, number]) => img.data.set(rgb, i * 4);
    set(0, [200, 200, 200]); // text
    set(1, [20, 20, 45]); // past delta on blue only
    set(2, [20, 44, 20]); // exactly delta off on green: not ink
    set(3, [44, 20, 20]); // exactly delta off on red: not ink
    expect(inkShare(img)).toBeCloseTo(2 / 100, 10);
    expect(inkShare(img, 23)).toBeCloseTo(4 / 100, 10);
    expect(inkShare(img, 200)).toBe(0);
  });

  it('a tie for the commonest colour goes to the colour seen first', () => {
    const img = flat(5, 1, [0, 0, 0]);
    img.data.set([200, 200, 200], 8);
    img.data.set([200, 200, 200], 12);
    img.data.set([190, 190, 190], 16);
    // black and light grey two each: black is the background, so both greys and the near-grey are ink
    expect(inkShare(img)).toBeCloseTo(3 / 5, 10);
  });

  it("takes the background from the picture's commonest colour, not its first pixel", () => {
    const img = flat(4, 1, [0, 0, 0]);
    img.data.set([250, 250, 250], 0);
    expect(inkShare(img)).toBeCloseTo(1 / 4, 10);
  });
});
