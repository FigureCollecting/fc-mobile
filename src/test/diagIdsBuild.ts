import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Runs the tests of the file or describe it is called in as a build with diagnostic ids
 * (VITE_DIAG_IDS=true, src/config/features.ts). The LGMOB suites call it: they test the behaviour
 * a build with ids has, while every committed env file leaves the flag unset (off).
 */
export function inDiagIdsBuild(): void {
  beforeEach(() => {
    vi.stubEnv('VITE_DIAG_IDS', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
}
