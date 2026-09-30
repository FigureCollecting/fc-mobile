import type { Page, TestInfo } from '@playwright/test';

/** A sign-off PNG may differ from the panel's real size by this many device pixels. */
export const SHOT_TOLERANCE_PX = 3;

export interface PngSize {
  width: number;
  height: number;
}

export function pngSize(_bytes: Uint8Array): PngSize {
  throw new Error('not implemented');
}

export function signoffPath(_outputDir: string, _project: string, _name: string): string {
  throw new Error('not implemented');
}

export async function signoffShot(
  _page: Pick<Page, 'screenshot'>,
  _testInfo: Pick<TestInfo, 'project' | 'attach'>,
  _name: string,
): Promise<PngSize & { path: string }> {
  throw new Error('not implemented');
}
