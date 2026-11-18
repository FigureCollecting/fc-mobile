import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// FLIP-LEGACY-REST: the old REST client (src/api/client.ts) had https://figurecollecting.com/api as its base and, on a
// 401, cleared its auth store and sent the page to /login. At the apex that base is the app's own origin, where the
// coordinator answers an unknown /api path 401. The client is gone, with every screen and hook that called it; the
// coordinator's Connect transport (src/api/transport.ts) is the only way to /api. These keep it from coming back.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const isTest = (f: string) => /(^|\/)__tests__\/|\.test\.tsx?$|^src\/test\//.test(f);
const sources = (readdirSync(path.join(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => `src/${f.split(path.sep).join('/')}`)
  .filter((f) => /\.tsx?$/.test(f) && !isTest(f));

const holding = (pattern: RegExp) => sources.filter((f) => pattern.test(read(f)));

describe('the old REST client is gone', () => {
  it('reads the app sources (or every check below passes on nothing)', () => {
    expect(sources.length).toBeGreaterThan(150);
    expect(sources).toContain('src/api/transport.ts');
  });

  it('src/api/client.ts does not exist, and no source imports it', () => {
    expect(existsSync(path.join(ROOT, 'src/api/client.ts'))).toBe(false);
    expect(holding(/['"`](?:\.{1,2}\/)+(?:api\/)?client['"`]/)).toEqual([]);
  });

  it("no source builds fc-shared's REST client", () => {
    expect(holding(/\bcreate(?:Simple)?ApiClient\b/)).toEqual([]);
  });

  it('no source sends the page to /login (Authentik owns sign-in; the app offers it in place)', () => {
    expect(holding(/location\s*\.\s*(?:assign|replace)\(\s*['"`]\/login|location(?:\s*\.\s*href)?\s*=\s*['"`]\/login/)).toEqual([]);
  });

  it('no source reads a base URL for it, from the build or from localStorage', () => {
    expect(holding(/VITE_API_URL|fc\.apiUrl/)).toEqual([]);
  });

  it('no env file sets VITE_API_URL: the API is the origin the app is served from, under /api', () => {
    const envFiles = readdirSync(ROOT).filter((f) => /^\.env(\.|$)/.test(f) && !f.endsWith('.local'));
    expect(envFiles).toEqual(expect.arrayContaining(['.env.production', '.env.test', '.env.development', '.env.stack']));
    for (const f of envFiles) expect(read(f), f).not.toMatch(/^\s*(export\s+)?VITE_API_URL\s*=/m);
  });
});
