// A stand-in stack process: starts a (fake) coordinator the way startStack
// does, writes the state file, then waits to be killed.
// Usage: node --import tsx host.ts <checkout> <port> <stateDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startCoordinator } from '../../../src/coordinator.js';

const [dir, port, stateDir] = process.argv.slice(2) as [string, string, string];
mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
await startCoordinator({
  dir,
  port: Number(port),
  env: { PATH: process.env['PATH'] ?? '', COORDINATOR_PORT: port },
  logFile: path.join(stateDir, 'logs', 'coordinator.log'),
  pidFile: path.join(stateDir, 'coordinator.pid'),
});
// Nothing listens on the control port: the stack is gone once this process is.
writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid: process.pid, controlUrl: 'http://127.0.0.1:9' }));
console.log('up');
setInterval(() => {}, 1000);
