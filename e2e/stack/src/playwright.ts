// Playwright globalSetup: reuse a stack that `stack:up --detach` left running,
// otherwise start one for the run and stop it in teardown. Workers find it
// through FC_STACK_ORIGIN and the state file.
import path from 'node:path';
import { degradedMessage, probeRunning } from './lifecycle.js';
import { STACK_ROOT } from './paths.js';
import { optionsFromEnv, startStack, type Stack, type StackOptions } from './stack.js';

export interface GlobalSetupDeps {
  stateDir?: string;
  start?: (options: StackOptions) => Promise<Stack>;
}

export function makeGlobalSetup(deps: GlobalSetupDeps = {}): () => Promise<() => Promise<void>> {
  const stateDir = deps.stateDir ?? optionsFromEnv().stateDir ?? path.join(STACK_ROOT, '.state');
  const start = deps.start ?? startStack;
  return async () => {
    const running = await probeRunning(stateDir);
    if (running.kind === 'up') {
      process.env['FC_STACK_ORIGIN'] = running.state.origin;
      return async () => undefined;
    }
    // A fresh stack would collide with the ports a degraded one still holds.
    if (running.kind === 'degraded') throw new Error(degradedMessage(running));
    const stack = await start({ ...optionsFromEnv(), stateDir });
    process.env['FC_STACK_ORIGIN'] = stack.state.origin;
    return () => stack.stop();
  };
}

export default makeGlobalSetup();
