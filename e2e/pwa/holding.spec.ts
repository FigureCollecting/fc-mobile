// R-1(b): the image's HOLDING switch, against the image as production runs it
// (read-only root, tmpfs /tmp, uid 101). HOLDING=1 serves the holding page for
// every navigation; unset or 0 serves the PWA exactly as before.
import { readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { requireImage, runToExit, runWeb } from './web';

const IMAGE = requireImage('FC_WEB_IMAGE');
const NAVIGATE = { accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate' };
const FETCH = { accept: '*/*', 'sec-fetch-mode': 'cors' };
const TEXT = 'Returning soon and in greater form.';
const CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(
  readFileSync(new URL('../../deploy/nginx/default.conf', import.meta.url), 'utf8'),
)?.[1];

const NAVIGATIONS = ['/', '/index.html', '/discover', '/figure/abc', '/collection?tab=owned', '/login', '/auth/login', '/a/b/c/d'];

// Playwright's request context, not fetch(): fetch drops the forbidden Sec-Fetch-Mode header, which is
// what the image's navigation check keys on.
async function get(request: APIRequestContext, url: string, headers: Record<string, string>) {
  const res = await request.get(url, { headers, maxRedirects: 0 });
  return { res: { status: res.status(), headers: { get: (k: string) => res.headers()[k.toLowerCase()] ?? null } }, body: await res.text() };
}

test.describe('HOLDING=1', () => {
  test('every navigation gets holding.html with 200, text/html and the CSP', async ({ request }) => {
    expect(CSP, 'CSP in default.conf').toBeTruthy();
    const web = await runWeb(IMAGE, { HOLDING: '1' });
    try {
      for (const path of NAVIGATIONS) {
        const { res, body } = await get(request, `${web.url}${path}`, NAVIGATE);
        expect(res.status, path).toBe(200);
        expect(res.headers.get('content-type'), path).toMatch(/^text\/html/);
        expect(body, path).toContain(TEXT);
        expect(body, path).not.toContain('fc-build');
        expect(res.headers.get('content-security-policy'), path).toBe(CSP);
        expect(res.headers.get('strict-transport-security'), path).toMatch(/^max-age=\d+/);
        expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
        expect(res.headers.get('cache-control'), path).toBe('no-cache');
      }
      const direct = await get(request, `${web.url}/holding.html`, FETCH);
      expect([direct.res.status, direct.body.includes(TEXT)]).toEqual([200, true]);
    } finally {
      web.stop();
    }
  });

  test('/api is still a 404 that is never HTML, and a non-navigation fetch of an unknown path is a 404', async ({ request }) => {
    const web = await runWeb(IMAGE, { HOLDING: '1' });
    try {
      for (const [path, headers] of [['/api', NAVIGATE], ['/api/x', NAVIGATE], ['/api/x', FETCH], ['/figure/abc', FETCH]] as const) {
        const { res, body } = await get(request, `${web.url}${path}`, headers);
        expect(res.status, `${path} ${headers['sec-fetch-mode']}`).toBe(404);
        expect(body, path).not.toContain(TEXT);
        expect(res.headers.get('content-security-policy'), path).toBe(CSP);
      }
    } finally {
      web.stop();
    }
  });
});

for (const env of [{}, { HOLDING: '0' }] as Array<Record<string, string>>) {
  test(`HOLDING ${JSON.stringify(env)}: the PWA is served, never the holding page`, async ({ request }) => {
    const web = await runWeb(IMAGE, env);
    try {
      for (const path of NAVIGATIONS.filter((p) => !p.includes('login'))) {
        const { res, body } = await get(request, `${web.url}${path}`, NAVIGATE);
        expect(res.status, path).toBe(200);
        expect(body, path).toContain('name="fc-build"');
        expect(body, path).not.toContain(TEXT);
        expect(res.headers.get('content-security-policy'), path).toBe(CSP);
      }
      expect((await get(request, `${web.url}/figure/abc`, FETCH)).res.status).toBe(404);
      expect((await get(request, `${web.url}/api/x`, NAVIGATE)).res.status).toBe(404);
    } finally {
      web.stop();
    }
  });
}

test('any other HOLDING value stops the container with an error instead of guessing', () => {
  for (const value of ['yes', 'true', '2']) {
    const r = runToExit(IMAGE, { HOLDING: value });
    expect(r.code, value).toBe(1);
    expect(r.out, value).toContain('HOLDING must be 0 or 1');
  }
});
