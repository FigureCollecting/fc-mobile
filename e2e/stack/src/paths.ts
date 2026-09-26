import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(STACK_ROOT, '..', '..');
/** Where ref checkouts of fc-coordinator live; under node_modules so no test runner collects their tests. */
export const CACHE_DIR = path.join(STACK_ROOT, 'node_modules', '.cache', 'fc-mobile-stack');
