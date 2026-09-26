// Playwright globalSetup: reuse a stack that `stack:up --detach` left running,
// otherwise start one for the run and stop it in teardown. Workers find it
// through FC_STACK_ORIGIN and the state file.
import path from 'node:path';
import { readStackState, stackClient } from './client.js';
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
    const running = readStackState(stateDir);
    if (running !== undefined) {
      const up = await stackClient(running.controlUrl).health().then(
        (h) => h.edge && h.coordinator,
        () => false,
      );
      if (up) {
        process.env['FC_STACK_ORIGIN'] = running.origin;
        return async () => undefined;
      }
    }
    const stack = await start({ ...optionsFromEnv(), stateDir });
    process.env['FC_STACK_ORIGIN'] = stack.state.origin;
    return () => stack.stop();
  };
}

export default makeGlobalSetup();
