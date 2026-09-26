// npm run stack:up [-- --detach] [-- --build]   /   npm run stack:down
// Foreground `up` runs until Ctrl-C or a control /shutdown; `--detach` starts
// it in the background and returns once the stack answers.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readStackState, stackClient } from './client.js';
import { REPO_ROOT, STACK_ROOT } from './paths.js';
import { optionsFromEnv, startStack, type StackState } from './stack.js';

const STATE_DIR = process.env['FC_STACK_STATE_DIR'] ?? path.join(STACK_ROOT, '.state');
const STACK_LOG = path.join(STATE_DIR, 'logs', 'stack.log');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function summary(state: StackState): string {
  return [
    `fc-mobile stack is up (pid ${state.pid})`,
    `  app        ${state.origin}   (/api -> coordinator, else -> nginx)`,
    `  issuer     ${state.issuer.issuer}`,
    `  users      ${state.users.map((u) => `${u.preferredUsername} ${u.sub}`).join(', ')}`,
    `  coordinator ${state.coordinator.url}  ${state.coordinator.ref ?? state.coordinator.dir}  spine wire ${state.coordinator.spineWire}`,
    `  postgres   ${state.postgres.databaseUrl}  ${state.postgres.locale.collate}`,
    `  control    ${state.controlUrl}`,
    `  catalog    ${state.catalog.file}`,
    `  logs       ${state.logs.coordinator}`,
  ].join('\n');
}

async function upForeground(): Promise<void> {
  const stack = await startStack({ ...optionsFromEnv(), stateDir: STATE_DIR });
  const stop = stack.stop;
  stack.stop = async () => {
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stack.stop());
  process.on('SIGTERM', () => void stack.stop());
  console.log(summary(stack.state));
}

async function upDetached(): Promise<void> {
  const running = readStackState(STATE_DIR);
  if (running !== undefined && alive(running.pid)) {
    console.log(summary(running));
    return;
  }
  mkdirSync(path.dirname(STACK_LOG), { recursive: true });
  const fd = openSync(STACK_LOG, 'w');
  // tsx as a loader, not its CLI: the CLI forks a second node, and the pid the
  // stack records must be the one this process waits for and `down` signals.
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(STACK_ROOT, 'src', 'cli.ts'), 'up'], {
    cwd: STACK_ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  });
  closeSync(fd);
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.unref();
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    if (exited) break;
    const state = readStackState(STATE_DIR);
    if (state !== undefined && state.pid === child.pid) {
      console.log(summary(state));
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`stack did not come up; last lines of ${STACK_LOG}:`);
  console.error(readFileSync(STACK_LOG, 'utf8').trimEnd().split('\n').slice(-40).join('\n'));
  if (!exited && child.pid !== undefined) process.kill(child.pid, 'SIGTERM');
  process.exit(1);
}

async function down(): Promise<void> {
  const state = readStackState(STATE_DIR);
  if (state === undefined) {
    console.log('no stack is running');
    return;
  }
  try {
    await stackClient(state.controlUrl).shutdown();
  } catch {
    if (alive(state.pid)) process.kill(state.pid, 'SIGTERM');
  }
  const deadline = Date.now() + 60_000;
  while (alive(state.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  if (alive(state.pid)) process.kill(state.pid, 'SIGKILL');
  const file = path.join(STATE_DIR, 'stack.json');
  if (existsSync(file)) rmSync(file);
  console.log('stack is down');
}

const [command, ...flags] = process.argv.slice(2);
if (command === 'up') {
  if (flags.includes('--build')) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  await (flags.includes('--detach') ? upDetached() : upForeground());
} else if (command === 'down') {
  await down();
} else {
  console.error('usage: cli.ts up [--detach] [--build] | down');
  process.exit(2);
}
