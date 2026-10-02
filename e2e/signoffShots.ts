import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/** A sign-off PNG may differ from the panel's real size by this many device pixels. */
export const SHOT_TOLERANCE_PX = 3;

export interface PngSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The width and height in a PNG file's header (its IHDR chunk); throws on anything else. */
export function pngSize(bytes: Uint8Array): PngSize {
  const buf = Buffer.from(bytes);
  if (buf.length < 24 || PNG_SIGNATURE.some((b, i) => buf[i] !== b) || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG file header');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** test-results/signoff/<project>/<name>.png: one file per shot and project, kept until the next run. */
export function signoffPath(outputDir: string, project: string, name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`sign-off shot names are kebab-case: ${JSON.stringify(name)}`);
  return path.join(outputDir, 'signoff', project, `${name}.png`);
}

/**
 * Saves the full frame (the whole viewport, at the device pixel ratio) as the
 * named sign-off PNG, attaches it to the report, and returns where it is and
 * the size its header gives.
 */
export async function signoffShot(
  page: Pick<Page, 'screenshot'>,
  testInfo: Pick<TestInfo, 'project' | 'attach'>,
  name: string,
): Promise<PngSize & { path: string }> {
  const file = signoffPath(testInfo.project.outputDir, testInfo.project.name, name);
  await page.screenshot({ path: file, scale: 'device', animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  return { path: file, ...pngSize(readFileSync(file)) };
}

/** Why a sign-off PNG is not its panel's size (more than SHOT_TOLERANCE_PX off either way), or undefined when it is. */
export function shotSizeError(png: PngSize, panel: PngSize): string | undefined {
  const off: string[] = [];
  if (Math.abs(png.width - panel.width) > SHOT_TOLERANCE_PX) off.push(`${png.width} wide, the panel is ${panel.width}`);
  if (Math.abs(png.height - panel.height) > SHOT_TOLERANCE_PX) off.push(`${png.height} high, the panel is ${panel.height}`);
  return off.length === 0 ? undefined : off.join('; ');
}
