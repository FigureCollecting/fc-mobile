import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_WEB_IMAGE, startWeb, type StackWeb } from '../src/web.js';
import { request } from './helpers.js';

function fakeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stack-dist-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="app">fc-mobile shell</div>');
  writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  return dir;
}

describe('web (nginx-unprivileged serving the production build)', () => {
  let web: StackWeb;

  beforeAll(async () => {
    web = await startWeb({ dist: fakeDist() });
  });
  afterAll(async () => {
    await web.stop();
  });

  it('runs the pinned unprivileged image', () => {
    expect(web.image).toBe(DEFAULT_WEB_IMAGE);
    expect(web.image).toMatch(/^nginxinc\/nginx-unprivileged:/);
  });

  it('serves the shell at / and as the fallback for deep links', async () => {
    const root = await request(`${web.url}/`);
    expect(root.status).toBe(200);
    expect(root.body).toContain('fc-mobile shell');
    const deep = await request(`${web.url}/figure/123`);
    expect(deep.status).toBe(200);
    expect(deep.body).toContain('fc-mobile shell');
  });

  it('never answers /api with the shell', async () => {
    for (const p of ['/api', '/api/x', '/api/coordinator.v1.CompareService/Compare']) {
      const reply = await request(`${web.url}${p}`);
      expect(reply.status).toBe(404);
      expect(reply.body).not.toContain('fc-mobile shell');
    }
  });

  it('marks index.html and sw.js no-cache and hashed assets immutable, and 404s a missing asset', async () => {
    expect((await request(`${web.url}/index.html`)).headers['cache-control']).toBe('no-cache');
    expect((await request(`${web.url}/sw.js`)).headers['cache-control']).toBe('no-cache');
    const asset = await request(`${web.url}/assets/index-abc123.js`);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await request(`${web.url}/assets/missing.js`)).status).toBe(404);
  });

  it('refuses a dist without index.html', async () => {
    await expect(startWeb({ dist: mkdtempSync(path.join(tmpdir(), 'stack-empty-')) })).rejects.toThrow(/index\.html/);
  });

  it('comes back on a new port after a stop', async () => {
    const other = await startWeb({ dist: fakeDist() });
    await other.stop();
    await other.start();
    expect((await request(`${other.url}/`)).status).toBe(200);
    await other.stop();
  });

  it('runs a prebuilt image as is, without copying a dist or a config', async () => {
    const prebuilt = await startWeb({ image: DEFAULT_WEB_IMAGE });
    try {
      expect(prebuilt.image).toBe(DEFAULT_WEB_IMAGE);
      const root = await request(`${prebuilt.url}/`);
      expect(root.status).toBe(200);
      expect(root.body).toContain('Welcome to nginx');
    } finally {
      await prebuilt.stop();
    }
  });
});
