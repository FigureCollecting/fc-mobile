import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANDS_OFF_DOMAINS } from '../../e2e/handsOff';
import { NGINX_CONF, devServerHeaders, parseCsp, previewHeaders, readNginxHeaders } from '../securityHeaders';

const conf = readFileSync(NGINX_CONF, 'utf8');

describe('nginx security headers', () => {
  const headers = readNginxHeaders(conf);

  it('sends CSP, HSTS, nosniff and Referrer-Policy on every response', () => {
    expect(Object.keys(headers).sort()).toEqual(
      ['Content-Security-Policy', 'Referrer-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options'].sort(),
    );
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}/);
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    // `always`, so a 404 (the /api answer) carries them too.
    for (const name of Object.keys(headers)) {
      expect(conf).toMatch(new RegExp(`add_header ${name} "[^"]+" always;`));
    }
  });

  it('never allows inline or eval, in any directive', () => {
    expect(headers['Content-Security-Policy']).not.toMatch(/unsafe-|strict-dynamic|nonce-|sha(256|384|512)-|\*/);
  });

  it('pins the directives the app needs and nothing wider', () => {
    const csp = parseCsp(headers['Content-Security-Policy'] as string);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['style-src']).toEqual(["'self'"]);
    // Same-origin coordinator under /api plus the IdP's token endpoint.
    expect(csp['connect-src']).toEqual(["'self'", 'https://auth.mindsignals1.com']);
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'https://images.figurecollecting.com']);
    expect(csp['worker-src']).toEqual(["'self'"]);
    expect(csp['manifest-src']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
  });

  it('sets no add_header inside a location, which would drop the server-level ones', () => {
    const code = conf.replace(/#.*$/gm, '');
    const locations = code.match(/^\s*location[^{]*\{[^}]*\}/gm) ?? [];
    expect(locations.length).toBeGreaterThan(0);
    for (const block of locations) expect(block).not.toMatch(/add_header/);
  });
});

describe('previewHeaders (vite preview, for the e2e suite)', () => {
  const nginx = readNginxHeaders(conf);

  it('is the nginx set exactly when the build talks only to its own origin', () => {
    expect(previewHeaders(conf, {})).toEqual(nginx);
    expect(previewHeaders(conf, { VITE_API_URL: '/api' })).toEqual(nginx);
  });

  it("adds a mode's cross-origin API and image hosts to connect-src and img-src, and nothing else", () => {
    const out = previewHeaders(conf, {
      VITE_API_URL: 'http://localhost:5080/api',
      VITE_IMAGE_MANAGER_URL: 'http://localhost:8000',
    });
    const csp = parseCsp(out['Content-Security-Policy'] as string);
    const base = parseCsp(nginx['Content-Security-Policy'] as string);
    expect(csp['connect-src']).toEqual([...(base['connect-src'] as string[]), 'http://localhost:5080']);
    expect(csp['img-src']).toEqual([...(base['img-src'] as string[]), 'http://localhost:8000']);
    for (const name of Object.keys(base).filter((d) => d !== 'connect-src' && d !== 'img-src')) {
      expect(csp[name]).toEqual(base[name]);
    }
  });

  it('does not repeat a host the policy already lists', () => {
    const out = previewHeaders(conf, { VITE_IMAGE_MANAGER_URL: 'https://images.figurecollecting.com/' });
    expect(out).toEqual(nginx);
  });

  it('fails loudly when the nginx file has no CSP', () => {
    expect(() => readNginxHeaders('server { }')).toThrow(/Content-Security-Policy/);
  });

  it('points at the deployed config', () => {
    expect(path.relative(process.cwd(), NGINX_CONF)).toBe(path.join('deploy', 'nginx', 'default.conf'));
  });
});

/** Where `vite` serves the app in dev. */
const DEV_ORIGIN = 'http://localhost:5173';

/**
 * Whether a CSP source list lets a page at DEV_ORIGIN fetch `url`: the source
 * forms CSP3 has, ports ignored, so it errs toward "allows".
 */
function allows(sources: string[], url: string): boolean {
  const u = new URL(url);
  return sources.some((source) => {
    if (source === '*') return !['data:', 'blob:', 'filesystem:'].includes(u.protocol);
    if (source.startsWith("'")) return source === "'self'" && u.origin === DEV_ORIGIN;
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return u.protocol === source || (source === 'http:' && u.protocol === 'https:');
    const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^:/]+)/i.exec(source);
    if (m === null) return false;
    const [, scheme, wildcard, host] = m as unknown as [string, string | undefined, string | undefined, string];
    const hostMatches = wildcard ? u.hostname.endsWith(`.${host}`) : u.hostname === host;
    const schemeMatches = scheme === undefined || u.protocol === `${scheme}:` || (scheme === 'http' && u.protocol === 'https:');
    return hostMatches && schemeMatches;
  });
}

/** Every directive that governs a fetch, each falling back to default-src as CSP does. */
const FETCH_DIRECTIVES = [
  'child-src', 'connect-src', 'font-src', 'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src',
  'script-src', 'script-src-elem', 'style-src', 'style-src-elem', 'worker-src',
];

const HANDS_OFF_URLS = HANDS_OFF_DOMAINS.flatMap((d) => [`https://${d}/x.jpg`, `https://static.${d}/x.jpg`, `http://www.${d}/x.jpg`, `wss://${d}/`]);

describe('the CSP matcher these tests use', () => {
  it('flags every source form that would let a hands-off request through', () => {
    const url = 'https://static.myfigurecollection.net/upload/x.jpg';
    for (const source of ['*', 'https:', 'http:', '*.myfigurecollection.net', 'https://static.myfigurecollection.net', 'static.myfigurecollection.net:443']) {
      expect(allows([source], url), source).toBe(true);
    }
    for (const source of ["'self'", "'none'", 'data:', 'https://images.figurecollecting.com', '*.figurecollecting.com', 'http://localhost:8000']) {
      expect(allows([source], url), source).toBe(false);
    }
    expect(allows(["'self'"], `${DEV_ORIGIN}/favicon.svg`)).toBe(true);
  });
});

describe('devServerHeaders (the vite dev server, and every spike page it serves)', () => {
  const env = { VITE_API_URL: 'http://localhost:5080/api', VITE_IMAGE_MANAGER_URL: 'http://localhost:8000' };
  const preview = parseCsp(previewHeaders(conf, env)['Content-Security-Policy'] as string);

  it("is the mode's preview CSP with inline styles allowed (vite's dev client injects CSS as <style>), and nothing else", () => {
    const headers = devServerHeaders(conf, env);
    expect(Object.keys(headers)).toEqual(['Content-Security-Policy']);
    const dev = parseCsp(headers['Content-Security-Policy'] as string);
    expect(dev).toEqual({ ...preview, 'style-src': [...(preview['style-src'] as string[]), "'unsafe-inline'"] });
  });

  it('lets no page fetch anything from a hands-off host', () => {
    const csp = parseCsp(devServerHeaders(conf, env)['Content-Security-Policy'] as string);
    expect(csp['default-src']).toBeDefined();
    for (const directive of FETCH_DIRECTIVES) {
      const sources = csp[directive] ?? (csp['default-src'] as string[]);
      for (const url of HANDS_OFF_URLS) expect(allows(sources, url), `${directive} ${url}`).toBe(false);
    }
  });
});
