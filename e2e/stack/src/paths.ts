import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(STACK_ROOT, '..', '..');
