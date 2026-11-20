// The image's nginx as production runs it (uid 101, read-only root, tmpfs /tmp, no capabilities):
// a version the vendor lists as fixed, every process uid 101, and every file it writes under /tmp.
// A config that needs root or a writable root stops the container instead of serving.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '../fixtures';
import { nginxFixed } from '../../deploy/nginxAdvisory';
import { RUN_FLAGS, exec, requireImage, runWeb } from './web';

const IMAGE = requireImage('FC_WEB_IMAGE');
const conf = (f: string) => readFileSync(new URL(`../../deploy/nginx/${f}`, import.meta.url), 'utf8');

test('nginx is a release the vendor lists as fixed, and every nginx process runs as uid 101', async () => {
  const web = await runWeb(IMAGE);
  try {
    const version = /nginx version: nginx\/(\S+)/.exec(exec(web, 'sh', '-c', 'nginx -v 2>&1').out)?.[1] ?? '';
    expect(nginxFixed(version), version).toBe(true);

    const uids = exec(web, 'sh', '-c', 'for s in /proc/[0-9]*/status; do grep -q "^Name:\tnginx$" "$s" && grep "^Uid:" "$s"; done').out;
    const lines = uids.trim().split('\n');
    expect(lines.length, uids).toBeGreaterThanOrEqual(2); // the master and at least one worker
    for (const line of lines) expect(line, uids).toMatch(/^Uid:\t101\t101\t101\t101$/);

    expect(exec(web, 'cat', '/tmp/nginx.pid').out.trim()).toMatch(/^\d+$/);
    expect(exec(web, 'sh', '-c', 'nginx -T 2>/dev/null | grep -E "^\\s*(pid|\\w+_temp_path)\\s"').out.trim().split('\n').map((l) => l.trim()).sort()).toEqual([
      'client_body_temp_path /tmp/client_temp;',
      'fastcgi_temp_path /tmp/fastcgi_temp;',
      'pid        /tmp/nginx.pid;',
      'proxy_temp_path /tmp/proxy_temp;',
      'scgi_temp_path /tmp/scgi_temp;',
      'uwsgi_temp_path /tmp/uwsgi_temp;',
    ]);
  } finally {
    web.stop();
  }
});

/** Starts the image with one config file replaced and waits for it to stop: its exit code and log. */
function startWith(file: string, content: string, extra: string[] = []): { code: number; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-web-conf-'));
  const host = path.join(dir, path.basename(file));
  writeFileSync(host, content);
  chmodSync(host, 0o644); // uid 101 must read it whatever the umask
  const id = execFileSync('docker', ['run', '-d', ...RUN_FLAGS, ...extra, '-v', `${host}:${file}:ro`, IMAGE], { encoding: 'utf8' }).trim();
  try {
    const exited = spawnSync('docker', ['wait', id], { encoding: 'utf8', timeout: 20_000 });
    const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8' });
    return { code: exited.status === 0 ? Number(exited.stdout.trim()) : -1, out: `${logs.stdout}${logs.stderr}` };
  } finally {
    spawnSync('docker', ['rm', '-f', id]);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a server that listens on port 80 stops the container: binding below 1024 needs root', () => {
  const port80 = conf('default.conf').replaceAll('listen 8080;', 'listen 80;').replaceAll('listen [::]:8080;', 'listen [::]:80;');
  expect(port80).toContain('listen 80;');
  // Docker lowers this to 0 in a container's network namespace; 1024 is the kernel's own default.
  const r = startWith('/etc/nginx/conf.d/default.conf', port80, ['--sysctl', 'net.ipv4.ip_unprivileged_port_start=1024']);
  expect(r.code, r.out).not.toBe(0);
  expect(r.out).toMatch(/bind\(\) to .*:80 failed \(13: Permission denied\)/);
});

test('a pid file outside /tmp stops the container: the root filesystem is read-only', () => {
  const pidInRun = conf('nginx.conf').replace(/^pid\s+\/tmp\/nginx\.pid;$/m, 'pid /run/nginx.pid;');
  expect(pidInRun).toContain('pid /run/nginx.pid;');
  const r = startWith('/etc/nginx/nginx.conf', pidInRun);
  expect(r.code, r.out).not.toBe(0);
  expect(r.out).toMatch(/open\(\) "\/run\/nginx\.pid" failed \(\d+: (Read-only file system|Permission denied)\)/);
});
