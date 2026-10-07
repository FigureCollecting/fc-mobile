import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const SCRIPT = path.join(ROOT, 'deploy/nginx/40-fc-holding.sh');

describe('deploy/nginx/40-fc-holding.sh', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  function run(env: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), 'fc-mode-'));
    dirs.push(dir);
    const result = spawnSync('sh', [SCRIPT], { env: { PATH: process.env.PATH ?? '', FC_MODE_DIR: dir, ...env }, encoding: 'utf8' });
    return { ...result, conf: path.join(dir, 'holding.conf') };
  }

  it('is executable, because nginx-unprivileged runs only executable files in /docker-entrypoint.d', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it.each([[{}], [{ HOLDING: '0' }], [{ HOLDING: '' }]])('writes no rewrite when HOLDING is %j: the app is served', (env) => {
    const r = run(env);
    expect(r.status).toBe(0);
    expect(existsSync(r.conf)).toBe(false);
  });

  it('writes the navigation rewrite and the bare-origin rewrite for HOLDING=1, never touching /api', () => {
    const r = run({ HOLDING: '1' });
    expect(r.status).toBe(0);
    const conf = readFileSync(r.conf, 'utf8');
    expect(conf).toContain('if ($fc_navigation) { rewrite "^/(?!api(?:/|$))" /holding.html last; }');
    expect(conf).toContain('rewrite "^/$" /holding.html last;');
  });

  it.each(['yes', 'true', '2'])('stops the container for HOLDING=%j instead of guessing', (value) => {
    const r = run({ HOLDING: value });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('HOLDING must be 0 or 1');
    expect(existsSync(r.conf)).toBe(false);
  });
});

describe('the image wires holding mode in', () => {
  const dockerfile = read('Dockerfile');
  const web = dockerfile.slice(dockerfile.indexOf(' AS web'));

  it('installs the entrypoint script, executable, and defaults HOLDING to 0', () => {
    expect(web).toMatch(/COPY --chown=root:root --chmod=0755 deploy\/nginx\/40-fc-holding\.sh \/docker-entrypoint\.d\/40-fc-holding\.sh/);
    expect(web).toMatch(/^ENV HOLDING=0$/m);
  });

  it('ships holding.html root-owned and read-only next to the app', () => {
    expect(web).toMatch(/COPY --chown=root:root --chmod=0644 deploy\/nginx\/holding\.html \/usr\/share\/nginx\/html\/holding\.html/);
  });

  it('adds both before the image drops to uid 101', () => {
    const user = web.indexOf('USER 101');
    expect(web.indexOf('40-fc-holding.sh')).toBeGreaterThan(-1);
    expect(web.indexOf('40-fc-holding.sh')).toBeLessThan(user);
    expect(web.indexOf('holding.html')).toBeGreaterThan(-1);
    expect(web.indexOf('holding.html')).toBeLessThan(user);
  });

  it('includes the generated rewrite at server level, after the shared headers', () => {
    const conf = read('deploy/nginx/default.conf');
    expect(conf).toMatch(/^ {4}include \/tmp\/fc-mode\/\*\.conf;$/m);
    expect(conf.indexOf('include /tmp/fc-mode/')).toBeGreaterThan(conf.indexOf('add_header Cache-Control'));
    expect(conf.indexOf('include /tmp/fc-mode/')).toBeLessThan(conf.indexOf('location = /api'));
  });
});

describe('deploy/nginx/holding.html', () => {
  const html = existsSync(path.join(ROOT, 'deploy/nginx/holding.html')) ? read('deploy/nginx/holding.html') : '';

  it('says what Ross asked for', () => {
    expect(html).toContain('Returning soon and in greater form.');
  });

  it('is a plain document the app CSP (script-src and style-src self) lets render', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).not.toMatch(/<script|<style|\sstyle=|\son[a-z]+=|<link|<img/i);
  });
});
