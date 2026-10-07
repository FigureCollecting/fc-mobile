import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const SCRIPT = path.join(ROOT, 'scripts/assert-bundle-auth-mode.sh');

describe('Dockerfile: the web image signs in through OIDC unless told otherwise', () => {
  const dockerfile = read('Dockerfile');
  const build = dockerfile.slice(0, dockerfile.indexOf(' AS web'));

  it('defaults VITE_AUTH_MODE to oidc in the build stage and exports it to the build', () => {
    expect(build).toMatch(/^ARG VITE_AUTH_MODE=oidc$/m);
    expect(build).toMatch(/^ENV VITE_AUTH_MODE=\$\{VITE_AUTH_MODE\}$/m);
  });

  it('sets it before `npm run build`, so the bundle sees it', () => {
    expect(build.indexOf('ENV VITE_AUTH_MODE=')).toBeGreaterThan(-1);
    expect(build.indexOf('ENV VITE_AUTH_MODE=')).toBeLessThan(build.indexOf('RUN npm run build'));
  });

  it('keeps the legacy sign-in reachable only as an explicit value, and refuses anything else', () => {
    const guard = /case "\$VITE_AUTH_MODE" in[\s\\]+oidc\|legacy\)[\s\S]*?exit 1/;
    expect(build).toMatch(guard);
    expect(build.search(guard)).toBeLessThan(build.indexOf('RUN npm run build'));
  });
});

describe('web-image.yml: every image build passes the mode explicitly', () => {
  const workflow = read('.github/workflows/web-image.yml');

  it('passes VITE_AUTH_MODE=oidc to the CI image builds', () => {
    const builds = workflow.match(/docker build[\s\S]*?-t "\$\{pair%%=\*\}" \./g) ?? [];
    expect(builds).toHaveLength(1);
    expect(builds[0]).toContain('--build-arg "VITE_AUTH_MODE=oidc"');
  });

  it('passes VITE_AUTH_MODE=oidc to the published build', () => {
    const buildArgs = /build-args: \|\n((?: {12,}\S.*\n)+)/.exec(workflow)?.[1] ?? '';
    expect(buildArgs).toContain('VITE_AUTH_MODE=oidc');
  });

  it('asserts the bundle of the tested image and of the published image', () => {
    expect(workflow.match(/scripts\/assert-bundle-auth-mode\.sh [^\n]*\boidc\b/g)).toHaveLength(2);
  });
});

describe('scripts/assert-bundle-auth-mode.sh', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** A directory shaped like dist/assets: one chunk with the env object a build inlines. */
  function assets(env: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'fc-assets-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets/auth-abc.js'), `var e={BASE_URL:\`/\`,PROD:!0,VITE_API_URL:\`https://x/api\`${env},VITE_BUILD_ID:\`dev\`};`);
    writeFileSync(path.join(dir, 'assets/index-abc.js'), 'console.log(1);');
    return path.join(dir, 'assets');
  }
  const run = (dir: string, mode: string) => spawnSync('sh', [SCRIPT, dir, mode], { encoding: 'utf8' });

  it('passes an OIDC bundle for oidc and fails it for legacy', () => {
    const dir = assets(',VITE_AUTH_MODE:`oidc`');
    expect(run(dir, 'oidc').status).toBe(0);
    expect(run(dir, 'legacy').status).toBe(1);
  });

  it('fails a bundle built without the flag for oidc and passes it for legacy', () => {
    const dir = assets('');
    const res = run(dir, 'oidc');
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/not the oidc build/i);
    expect(run(dir, 'legacy').status).toBe(0);
  });

  it('fails a bundle that sets another mode value', () => {
    expect(run(assets(',VITE_AUTH_MODE:`OIDC`'), 'oidc').status).toBe(1);
  });

  it('fails on an empty or missing assets directory and on an unknown mode', () => {
    expect(run(path.join(tmpdir(), 'fc-no-such-assets'), 'oidc').status).toBe(2);
    expect(run(assets(',VITE_AUTH_MODE:`oidc`'), 'both').status).toBe(2);
    expect(() => execFileSync('sh', [SCRIPT], { stdio: 'pipe' })).toThrow();
  });
});
