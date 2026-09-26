// npm run stack:up [-- --detach] [-- --build]   /   npm run stack:down
// npm --prefix e2e/stack run checkout   (fetch + install the coordinator only)
// Argument parsing and exit codes only; what each command does is lifecycle.ts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { stackDown, summary, upDetached, upForeground } from './lifecycle.js';
import { REPO_ROOT, STACK_ROOT } from './paths.js';
import { optionsFromEnv, prepareCoordinator } from './stack.js';

const STATE_DIR = process.env['FC_STACK_STATE_DIR'] ?? path.join(STACK_ROOT, '.state');

const [command, ...flags] = process.argv.slice(2);
if (command === 'up') {
  if (flags.includes('--build')) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  if (flags.includes('--detach')) {
    const result = await upDetached({ stateDir: STATE_DIR });
    if (result.ok) console.log(summary(result.state));
    else console.error(result.message);
    process.exit(result.ok ? 0 : 1);
  }
  const stack = await upForeground({ ...optionsFromEnv(), stateDir: STATE_DIR });
  console.log(summary(stack.state));
} else if (command === 'down') {
  const result = await stackDown(STATE_DIR);
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  process.exitCode = result.ok ? 0 : 1;
} else if (command === 'checkout') {
  prepareCoordinator(optionsFromEnv());
} else {
  console.error('usage: cli.ts up [--detach] [--build] | down | checkout');
  process.exit(2);
}
