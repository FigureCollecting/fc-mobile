// The nginx config is the one source of the response headers. `vite preview`
// (the e2e server) reads them from it, so the suite runs under the shipped CSP.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NGINX_CONF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nginx', 'default.conf');

export type Headers = Record<string, string>;

/** Every `add_header Name "value" always;` at server level (Cache-Control is per-path and omitted). */
export function readNginxHeaders(conf: string): Headers {
  const out: Headers = {};
  for (const m of conf.matchAll(/^\s*add_header\s+([\w-]+)\s+"([^"]+)"\s+always;/gm)) {
    out[m[1] as string] = m[2] as string;
  }
  if (out['Content-Security-Policy'] === undefined) throw new Error('nginx config sets no Content-Security-Policy');
  return out;
}

export function parseCsp(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

function formatCsp(csp: Record<string, string[]>): string {
  return Object.entries(csp)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

function crossOrigin(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined; // relative, so same-origin
  }
}

/**
 * The nginx headers, with a build mode's cross-origin API and image hosts
 * added to connect-src and img-src (the test build mocks a legacy API on
 * :5080). Nothing else is widened.
 */
export function previewHeaders(conf: string, env: Record<string, string | undefined>): Headers {
  const headers = readNginxHeaders(conf);
  const csp = parseCsp(headers['Content-Security-Policy'] as string);
  const add = (directive: string, origin: string | undefined): void => {
    const sources = csp[directive] as string[];
    if (origin !== undefined && !sources.includes(origin)) sources.push(origin);
  };
  add('connect-src', crossOrigin(env['VITE_API_URL']));
  add('img-src', crossOrigin(env['VITE_IMAGE_MANAGER_URL']));
  return { ...headers, 'Content-Security-Policy': formatCsp(csp) };
}
