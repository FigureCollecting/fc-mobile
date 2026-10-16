import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BADGE_ICON, WEB_MANIFEST } from '../webManifest';

const PUBLIC = path.resolve(__dirname, '../../public');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number; alpha: boolean } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

describe('web manifest', () => {
  it("names the app 'Figure Collecting' on the home screen and everywhere else, with the space", () => {
    expect(WEB_MANIFEST.short_name).toBe('Figure Collecting');
    expect(WEB_MANIFEST.name).toBe('Figure Collecting');
  });

  it('uses the same name under the splash silhouette and as the document title', () => {
    const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain(`<span class="pre-splash__text">${WEB_MANIFEST.name}</span>`);
    expect(html).toContain(`<title>${WEB_MANIFEST.name}</title>`);
  });

  it("identifies the app as '/' and lets a Fold unfold into landscape", () => {
    expect(WEB_MANIFEST.id).toBe('/');
    expect(WEB_MANIFEST.start_url).toBe('/');
    expect(WEB_MANIFEST.scope).toBe('/');
    expect(WEB_MANIFEST.display).toBe('standalone');
    expect(WEB_MANIFEST.orientation).toBe('any');
  });

  it('declares 192 and 512 icons, and maskable ones, separately (never "any maskable")', () => {
    const icons = WEB_MANIFEST.icons ?? [];
    const has = (size: string, purpose: string) => icons.some((i) => i.sizes === size && i.purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
    for (const icon of icons) expect(icon.purpose).not.toMatch(/\s/);
  });

  it('points every icon at a PNG in public/ of the declared size', () => {
    for (const icon of [...(WEB_MANIFEST.icons ?? []), BADGE_ICON]) {
      const [w, h] = (icon.sizes as string).split('x').map(Number);
      expect(icon.type).toBe('image/png');
      expect(pngSize(path.join(PUBLIC, icon.src)), icon.src).toMatchObject({ width: w, height: h });
    }
  });

  it('ships a 72px notification badge with transparency (Android draws only its alpha)', () => {
    expect(BADGE_ICON.src).toBe('/icons/badge-72.png');
    expect(pngSize(path.join(PUBLIC, BADGE_ICON.src)).alpha).toBe(true);
  });

  it('matches the badge the service worker shows with push', () => {
    const sw = readFileSync(path.resolve(__dirname, '../../src/sw.ts'), 'utf8');
    expect(sw).toContain(`'${BADGE_ICON.src}'`);
  });
});
