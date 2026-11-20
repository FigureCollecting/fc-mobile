import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nginxFixed } from '../nginxAdvisory';

// The web stage runs nginx as uid 101 on a read-only root with only /tmp writable (fc-infra
// edge/fc-mobile-web.yaml). These guard the image config that makes that work; e2e/pwa/runtime.spec.ts
// proves it on the built image.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const dockerfile = read('Dockerfile');
const web = dockerfile.slice(dockerfile.indexOf(' AS web'));
const fromWeb = /^FROM (\S+) AS web$/m.exec(dockerfile)?.[1] ?? '';

describe('nginxFixed (the vendor advisory range)', () => {
  it.each([
    ['1.30.6', false],
    ['1.30.7', true],
    ['1.30.12', true],
    ['1.31.7', false],
    ['1.31.8', false],
    ['1.31.9', true],
    ['1.29.9', false],
    // Another line is not read as fixed until this module learns it.
    ['1.32.0', false],
    ['2.0.0', false],
    ['0.9.9', false],
    ['1.30', false],
    ['latest', false],
  ])('%s -> %s', (version, fixed) => {
    expect(nginxFixed(version)).toBe(fixed);
  });
});

describe('the web stage base image', () => {
  it('is the official nginx alpine image, pinned by digest', () => {
    expect(fromWeb).toMatch(/^nginx:\d+\.\d+\.\d+-alpine(-slim)?@sha256:[0-9a-f]{64}$/);
  });

  it('carries an nginx the vendor lists as fixed', () => {
    const version = /^nginx:(\d+\.\d+\.\d+)-/.exec(fromWeb)?.[1] ?? '';
    expect(nginxFixed(version), fromWeb).toBe(true);
  });
});

describe('the image runs as uid 101 with only /tmp writable', () => {
  const nginxConf = existsSync(path.join(ROOT, 'deploy/nginx/nginx.conf')) ? read('deploy/nginx/nginx.conf') : '';
  const directives = (name: string) => [...nginxConf.matchAll(new RegExp(`^\\s*${name}\\s+([^;]+);`, 'gm'))].map((m) => m[1].trim());

  it('installs its own nginx.conf root-owned and read-only, before dropping to uid 101', () => {
    const copy = 'COPY --chown=root:root --chmod=0644 deploy/nginx/nginx.conf /etc/nginx/nginx.conf';
    expect(web).toContain(copy);
    expect(web.indexOf(copy)).toBeLessThan(web.lastIndexOf('USER 101'));
  });

  it('ends as USER 101 and exposes 8080 only', () => {
    expect([...web.matchAll(/^USER (\S+)$/gm)].map((m) => m[1]).pop()).toBe('101');
    expect([...web.matchAll(/^EXPOSE (.+)$/gm)].map((m) => m[1])).toEqual(['8080']);
  });

  it('has no user directive: a non-root master cannot switch users', () => {
    expect(directives('user')).toEqual([]);
  });

  it.each(['pid', 'client_body_temp_path', 'proxy_temp_path', 'fastcgi_temp_path', 'uwsgi_temp_path', 'scgi_temp_path'])(
    'writes %s under /tmp, once',
    (name) => {
      const values = directives(name);
      expect(values).toHaveLength(1);
      expect(values[0]).toMatch(/^\/tmp\/[\w.]+$/);
    },
  );

  it('loads the server config from conf.d', () => {
    expect(directives('include')).toContain('/etc/nginx/conf.d/*.conf');
  });

  it('listens on 8080 only: a port below 1024 needs root or a capability the pod drops', () => {
    const listens = [...read('deploy/nginx/default.conf').matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1].trim());
    expect(listens).toEqual(['8080', '[::]:8080']);
  });
});
