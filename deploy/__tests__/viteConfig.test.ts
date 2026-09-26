import { readFileSync } from 'node:fs';
import type { ProxyOptions, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';
import { NGINX_CONF, previewHeaders } from '../securityHeaders';

const resolve = (mode: string, env: Record<string, string> = {}): UserConfig => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return (config as (e: { mode: string; command: 'serve' | 'build' }) => UserConfig)({ mode, command: 'serve' });
  } finally {
    process.env = saved;
  }
};

describe('vite dev proxy', () => {
  it('sends /api to a local coordinator with the path and Host untouched (DPoP htu = http://localhost:5173/api/...)', () => {
    const proxy = resolve('development').server?.proxy?.['/api'] as ProxyOptions;
    expect(proxy.target).toBe('http://127.0.0.1:5052');
    expect(proxy.changeOrigin).toBe(false);
    expect(proxy.rewrite).toBeUndefined();
  });

  it('can point at another coordinator', () => {
    const proxy = resolve('development', { FC_COORDINATOR_URL: 'http://127.0.0.1:8482' }).server?.proxy?.['/api'] as ProxyOptions;
    expect(proxy.target).toBe('http://127.0.0.1:8482');
  });
});

describe('vite preview', () => {
  it("serves the mode's build under the nginx headers", () => {
    const conf = readFileSync(NGINX_CONF, 'utf8');
    expect(resolve('test').preview?.headers).toEqual(
      previewHeaders(conf, { VITE_API_URL: 'http://localhost:5080/api', VITE_IMAGE_MANAGER_URL: 'http://localhost:8000' }),
    );
  });
});
