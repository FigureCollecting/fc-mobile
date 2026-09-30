import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASE_VIEWPORTS, SHOT_VIEWPORTS } from './caseViewports';
import { SHOT_TOLERANCE_PX, pngSize, signoffPath, signoffShot } from './signoffShots';

/** The first 24 bytes of a PNG: signature, IHDR length and type, width, height. */
function pngHeader(width: number, height: number): Buffer {
  const out = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
  out.writeUInt32BE(13, 8);
  out.write('IHDR', 12, 'latin1');
  out.writeUInt32BE(width, 16);
  out.writeUInt32BE(height, 20);
  return out;
}

describe('pngSize', () => {
  it("reads a real PNG's width and height from its header", () => {
    const icon = readFileSync(path.join(import.meta.dirname, '..', 'public', 'icons', 'icon-192.png'));
    expect(pngSize(icon)).toEqual({ width: 192, height: 192 });
  });

  it('reads them from the 24 header bytes alone', () => {
    expect(pngSize(pngHeader(1249, 1972))).toEqual({ width: 1249, height: 1972 });
  });

  it('refuses a JPEG, a header cut short, and a PNG whose first chunk is not IHDR', () => {
    expect(() => pngSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...pngHeader(1, 1).subarray(4)]))).toThrow(/not a PNG/);
    expect(() => pngSize(pngHeader(1, 1).subarray(0, 23))).toThrow(/not a PNG/);
    const idat = pngHeader(1, 1);
    idat.write('IDAT', 12, 'latin1');
    expect(() => pngSize(idat)).toThrow(/not a PNG/);
  });
});

describe('signoffPath', () => {
  it('is test-results/signoff/<project>/<name>.png', () => {
    expect(signoffPath('/r/test-results', 'fold8-cover-full', 'case-matted')).toBe(
      path.join('/r/test-results', 'signoff', 'fold8-cover-full', 'case-matted.png'),
    );
  });

  it.each(['', 'Case', 'case view', '../case', 'a/b', 'case-', '-case', 'case--matted'])('refuses the name %j', (name) => {
    expect(() => signoffPath('/r', 'desktop', name)).toThrow(/kebab-case/);
  });
});

describe('signoffShot', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fakes(width: number, height: number) {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'signoff-'));
    dirs.push(outputDir);
    const page = {
      screenshot: vi.fn(async (options: { path: string }) => {
        mkdirSync(path.dirname(options.path), { recursive: true });
        writeFileSync(options.path, pngHeader(width, height));
        return Buffer.alloc(0);
      }),
    };
    const testInfo = { project: { outputDir, name: 'fold8-open-full' }, attach: vi.fn(async () => {}) };
    return { outputDir, page, testInfo };
  }

  it('saves the whole frame at device pixels under its name, attaches it, and returns its header size', async () => {
    const { outputDir, page, testInfo } = fakes(2447, 1848);
    const file = path.join(outputDir, 'signoff', 'fold8-open-full', 'case.png');

    const shot = await signoffShot(page as never, testInfo as never, 'case');

    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(page.screenshot).toHaveBeenCalledWith({ path: file, scale: 'device', animations: 'disabled', caret: 'hide' });
    expect(testInfo.attach).toHaveBeenCalledWith('case', { path: file, contentType: 'image/png' });
    expect(shot).toEqual({ path: file, width: 2447, height: 1848 });
  });

  it('refuses a bad name before taking a shot', async () => {
    const { page, testInfo } = fakes(1, 1);
    await expect(signoffShot(page as never, testInfo as never, 'Case View')).rejects.toThrow(/kebab-case/);
    expect(page.screenshot).not.toHaveBeenCalled();
  });
});

describe('SHOT_VIEWPORTS (one Playwright project each)', () => {
  it('are the Fold8 full panels at its pixel ratio, and the desktop window', () => {
    expect(SHOT_VIEWPORTS.map(({ name, width, height, deviceScaleFactor, mobile }) => [name, width, height, deviceScaleFactor, mobile])).toEqual([
      ['fold8-cover-full', 444, 701, 2.8125, true],
      ['fold8-open-full', 870, 657, 2.8125, true],
      ['fold8-open-rotated-full', 657, 870, 2.8125, true],
      ['desktop', 1536, 730, 1, false],
    ]);
  });

  it("put each panel's CSS size times its pixel ratio within tolerance of the panel's real pixels", () => {
    for (const v of SHOT_VIEWPORTS) {
      expect(Math.abs(v.width * v.deviceScaleFactor - v.png.width), v.name).toBeLessThanOrEqual(SHOT_TOLERANCE_PX);
      expect(Math.abs(v.height * v.deviceScaleFactor - v.png.height), v.name).toBeLessThanOrEqual(SHOT_TOLERANCE_PX);
    }
    expect(SHOT_VIEWPORTS.find((v) => v.name === 'fold8-cover-full')?.png).toEqual({ width: 1248, height: 1972 });
    expect(SHOT_VIEWPORTS.find((v) => v.name === 'fold8-open-full')?.png).toEqual({ width: 2448, height: 1848 });
    expect(SHOT_VIEWPORTS.find((v) => v.name === 'fold8-open-rotated-full')?.png).toEqual({ width: 1848, height: 2448 });
  });

  it('share no name with each other, the case viewports or the existing projects', () => {
    const names = [...SHOT_VIEWPORTS.map((v) => v.name), ...CASE_VIEWPORTS.map((v) => v.name), 'chromium', 'mobile-chromium', 'webkit'];
    expect(new Set(names).size).toBe(names.length);
  });
});
