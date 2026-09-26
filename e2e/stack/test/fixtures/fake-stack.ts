// A stand-in for `cli.ts up` that upDetached can spawn without Docker.
// FAKE_STACK=ok writes a state file naming its own pid; fail exits with a
// message; hang never comes up. Exits on SIGTERM and after two minutes.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const stateDir = process.env['FC_STACK_STATE_DIR'] as string;
console.log(`started ${process.pid}`);
process.on('SIGTERM', () => process.exit(0));
setTimeout(() => process.exit(0), 120_000).unref();
const mode = process.env['FAKE_STACK'];
if (mode === 'fail') {
  console.error('boom: docker is not running');
  process.exit(1);
}
if (mode === 'ok') {
  writeFileSync(path.join(stateDir, 'stack.json'), JSON.stringify({ pid: process.pid, origin: 'http://localhost:1', controlUrl: 'http://127.0.0.1:9' }));
}
setInterval(() => {}, 1000);
