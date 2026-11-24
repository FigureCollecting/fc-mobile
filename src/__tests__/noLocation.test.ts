// NAV-LOGPOSE (plan U8 (i); handoff FINAL section 6): the orb's fine Look is relative orientation only. Nothing in the app
// asks for a location or for the compass-referenced orientation: neither appears in any source the bundle is built from.
// (e2e/nav-logpose.spec.ts checks the built bundle the browser loads, dependencies included.)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'test' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('no location and no absolute orientation', () => {
  it('no source names geolocation or deviceorientationabsolute (comments included)', () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/geolocation|deviceorientationabsolute|AbsoluteOrientationSensor/i.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it('the relative source does read orientation (the scan would see it)', () => {
    expect(readFileSync(path.join(SRC, 'sensors/relativeOrientation.ts'), 'utf8')).toMatch(/'deviceorientation'/);
  });
});
