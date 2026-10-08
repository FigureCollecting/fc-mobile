import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// WK-15: OIDC is the only sign-in, so the image has no auth-mode switch; the gate asserts the
// bundle carries the OIDC sign-in and that no chunk of the boot import graph carries the legacy one.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const SCRIPT = path.join(ROOT, 'scripts/assert-bundle-auth.sh');

describe('Dockerfile and web-image.yml: no sign-in switch any more', () => {
  it('neither takes nor passes VITE_AUTH_MODE', () => {
    expect(read('Dockerfile')).not.toMatch(/VITE_AUTH_MODE/);
    expect(read('.github/workflows/web-image.yml')).not.toMatch(/VITE_AUTH_MODE/);
  });

  it('asserts the bundle of the tested image and of the published image', () => {
    const workflow = read('.github/workflows/web-image.yml');
    expect(workflow.match(/sh scripts\/assert-bundle-auth\.sh "\$\{RUNNER_TEMP\}\/[\w-]+"\n/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/assert-bundle-auth-mode/);
  });
});

describe('scripts/assert-bundle-auth.sh', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** A directory shaped like the image's html root: index.html and its assets. */
  function html(chunks: Record<string, string>, boot: string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'fc-html-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    for (const [name, body] of Object.entries(chunks)) writeFileSync(path.join(dir, 'assets', name), body);
    const [entry, ...preloads] = boot;
    writeFileSync(
      path.join(dir, 'index.html'),
      `<html><head><script type="module" crossorigin src="/assets/${entry}"></script>${preloads.map((p) => `<link rel="modulepreload" crossorigin href="/assets/${p}">`).join('')}</head></html>`,
    );
    return dir;
  }
  const run = (dir: string) => spawnSync('sh', [SCRIPT, dir], { encoding: 'utf8' });
  const OIDC = 'const a=`${b}/application/o/authorize/`;';
  const LEGACY = 'post(`/auth/login`);post(`/auth/refresh`);';

  it('passes an OIDC bundle whose legacy client is only a lazy chunk', () => {
    const dir = html({ 'index-a.js': 'import("./client-c.js")', 'pre-b.js': '1', 'auth-d.js': OIDC, 'client-c.js': LEGACY }, ['index-a.js', 'pre-b.js']);
    const res = run(dir);
    expect(res.stdout).toMatch(/signs in through OIDC/);
    expect(res.status).toBe(0);
  });

  it('fails a bundle with no OIDC sign-in', () => {
    const res = run(html({ 'index-a.js': '1' }, ['index-a.js']));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no OIDC sign-in/);
  });

  it('fails a bundle that loads the legacy sign-in at boot, in the entry or a preload', () => {
    for (const boot of [['index-a.js'], ['index-x.js', 'index-a.js']]) {
      const res = run(html({ 'index-a.js': LEGACY, 'index-x.js': '1', 'auth-d.js': OIDC }, boot));
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/legacy sign-in loads at boot: .*index-a\.js/);
    }
  });

  // The boot graph: the entry and the preloads, every chunk they import statically, and every
  // chunk they import dynamically but the legacy screens and the legacy client (lazy: a tap loads them).
  it('fails when a chunk the shell imports dynamically at boot imports the legacy client (OidcSession)', () => {
    const chunks = { 'index-a.js': 'const S=lazy(()=>import(`./OidcSession-b.js`));', 'OidcSession-b.js': 'import{a as legacy}from"./client-c.js";globalThis.l=legacy;', 'client-c.js': LEGACY, 'auth-d.js': OIDC };
    const res = run(html(chunks, ['index-a.js']));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/legacy sign-in loads at boot: .*client-c\.js/);
  });

  it('fails on the legacy sign-in in a chunk reached by static imports alone, and in an eager dynamic chunk itself', () => {
    const viaStatic = { 'index-a.js': 'import"./shell-b.js";', 'shell-b.js': 'import{x}from"./util-c.js";', 'util-c.js': LEGACY, 'auth-d.js': OIDC };
    const inDynamic = { 'index-a.js': "import('./OidcSession-b.js');", 'OidcSession-b.js': LEGACY, 'auth-d.js': OIDC };
    for (const [chunks, culprit] of [[viaStatic, 'util-c.js'], [inDynamic, 'OidcSession-b.js']] as const) {
      const res = run(html(chunks, ['index-a.js']));
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(`legacy sign-in loads at boot: `);
      expect(res.stderr).toContain(culprit);
    }
  });

  it('passes a legacy client the boot graph reaches only through the lazy legacy screens', () => {
    const chunks = {
      'index-a.js': 'import"./shell-b.js";import(`./Sync-e.js`);import(`./Export-f.js`);import(`./Notifications-g.js`);import(`./client-c.js`);',
      'shell-b.js': 'import(`./OidcSession-h.js`)',
      'OidcSession-h.js': 'import{a}from"./auth-d.js";',
      'auth-d.js': OIDC,
      'Sync-e.js': 'import{api}from"./client-c.js";',
      'Export-f.js': 'import{api}from"./client-c.js";',
      'Notifications-g.js': 'import{api}from"./client-c.js";',
      'client-c.js': LEGACY,
    };
    const res = run(html(chunks, ['index-a.js']));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('fails when a chunk the boot graph imports is missing', () => {
    const res = run(html({ 'index-a.js': 'import"./gone-b.js";', 'auth-d.js': OIDC }, ['index-a.js']));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/missing: .*gone-b\.js/);
  });

  it('fails on a missing html root or index.html, and without an argument', () => {
    expect(run(path.join(tmpdir(), 'fc-no-such-html')).status).toBe(2);
    const dir = mkdtempSync(path.join(tmpdir(), 'fc-html-'));
    dirs.push(dir);
    expect(run(dir).status).toBe(2);
    expect(() => execFileSync('sh', [SCRIPT], { stdio: 'pipe' })).toThrow();
  });
});
