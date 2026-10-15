// The fc-mobile-web image as production runs it (uid 101, read-only root,
// tmpfs /tmp, no capabilities), plus an edge that routes /api to the stack's
// coordinator and can be repointed to a newer image at the same origin.
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'vite';
import { startEdge, type Edge } from '../stack/src/edge.js';
import { hostAddressesSettled } from '../stack/src/hostNetwork.js';

export interface WebContainer {
  id: string;
  image: string;
  url: string;
  stop(): void;
}

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' }).trim();

export function requireImage(name: string): string {
  const image = process.env[name];
  if (image === undefined || image === '') throw new Error(`${name} is not set: build it first (see playwright.pwa.config.ts)`);
  return image;
}

/** The production container flags: uid from the image, read-only root, tmpfs /tmp, no capabilities. */
const RUN_FLAGS = ['--read-only', '--tmpfs', '/tmp:rw,size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'];

const envFlags = (env: Record<string, string>): string[] => Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

/** A container that is expected to stop by itself: its exit code and output, not a server. */
export function runToExit(image: string, env: Record<string, string>): { code: number; out: string } {
  const r = spawnSync('docker', ['run', '--rm', ...RUN_FLAGS, ...envFlags(env), image], { encoding: 'utf8', timeout: 30_000 });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

export async function runWeb(image: string, env: Record<string, string> = {}): Promise<WebContainer> {
  const id = docker('run', '-d', '--rm', ...RUN_FLAGS, ...envFlags(env), '-p', '127.0.0.1::8080', image);
  const port = docker('port', id, '8080/tcp').split('\n')[0]?.split(':').pop();
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${image} did not serve / within 20s:\n${docker('logs', id)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  // A page load as the host announces the container's address would lose its requests (hostNetwork.ts).
  await hostAddressesSettled();
  return { id, image, url, stop: () => void docker('rm', '-f', id) };
}

export function exec(container: WebContainer, ...cmd: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('docker', ['exec', container.id, ...cmd], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { status: number; stderr: string; stdout: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

export function imageUser(image: string): string {
  return docker('image', 'inspect', image, '--format', '{{.Config.User}}');
}

export function openEdge(coordinator: string, web: WebContainer): Promise<Edge> {
  return startEdge({ coordinator, web: web.url });
}

/** The real v2 store and UserStore, bundled so a test can queue edits in the page. */
export function bundleOutboxProbe(): Promise<string> {
  return bundlePageProbe('./outboxProbe.ts', 'fcOutboxProbe');
}

/** The app's own owned-image sync, for the page (e2e/pwa/imageProbe.ts). */
export function bundleImageProbe(): Promise<string> {
  return bundlePageProbe('./imageProbe.ts', 'fcImageProbe');
}

// The app runs React libraries on preact (vite.config.ts); so does a probe that imports one. A library
// build leaves process.env.NODE_ENV in, which a page has no process for: the app's build replaces it.
const PREACT_FOR_REACT = [
  { find: /^react$/, replacement: 'preact/compat' },
  { find: 'react/jsx-runtime', replacement: 'preact/jsx-runtime' },
];
const AS_BUILT = { 'process.env.NODE_ENV': JSON.stringify('production') };

async function bundlePageProbe(entry: string, name: string): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: PREACT_FOR_REACT },
    define: AS_BUILT,
    build: {
      write: false,
      minify: false,
      lib: { entry: new URL(entry, import.meta.url).pathname, formats: ['iife'], name },
    },
  });
  const [bundle] = Array.isArray(out) ? out : [out];
  const chunk = (bundle as { output: Array<{ type: string; code?: string }> }).output.find((o) => o.type === 'chunk');
  if (chunk?.code === undefined) throw new Error(`${entry} did not bundle`);
  return chunk.code;
}
