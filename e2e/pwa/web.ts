// The fc-mobile-web image as production runs it (uid 101, read-only root,
// tmpfs /tmp, no capabilities), plus an edge that routes /api to the stack's
// coordinator and can be repointed to a newer image at the same origin.
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { startEdge, type Edge } from '../stack/src/edge.js';

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

export async function runWeb(image: string): Promise<WebContainer> {
  const id = docker(
    'run', '-d', '--rm',
    '--read-only', '--tmpfs', '/tmp:rw,size=16m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-p', '127.0.0.1::8080',
    image,
  );
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
export async function bundleOutboxProbe(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: new URL('./outboxProbe.ts', import.meta.url).pathname, formats: ['iife'], name: 'fcOutboxProbe' },
    },
  });
  const [bundle] = Array.isArray(out) ? out : [out];
  const chunk = (bundle as { output: Array<{ type: string; code?: string }> }).output.find((o) => o.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('outbox probe did not bundle');
  return chunk.code;
}
