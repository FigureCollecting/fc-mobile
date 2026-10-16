// Just enough PNG for the brand generator and its test: read 8-bit RGB / RGBA
// (non-interlaced) and write opaque RGB. No dependencies.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  width: number;
  height: number;
  /** The [r, g, b] of a pixel (alpha, if any, is dropped). */
  pixel(x: number, y: number): number[];
}

export function decodePng(file: Buffer): DecodedPng {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colourType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colourType !== 2 && colourType !== 6)) throw new Error('unsupported PNG (8-bit RGB/RGBA, not interlaced)');
      channels = colourType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i] as number;
      const a = i >= channels ? (pixels[y * stride + i - channels] as number) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] as number) : 0;
      const c = y > 0 && i >= channels ? (pixels[(y - 1) * stride + i - channels] as number) : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + i] = (x + add) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const o = y * stride + x * channels;
      return [pixels[o] as number, pixels[o + 1] as number, pixels[o + 2] as number];
    },
  };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** An opaque 8-bit RGB PNG from width * height * 3 bytes. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
