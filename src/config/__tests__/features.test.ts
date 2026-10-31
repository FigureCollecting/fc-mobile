import { afterEach, describe, it, expect, vi } from 'vitest';
import * as features from '../features';

describe('LEGACY_SCREENS_ENABLED', () => {
  it('is off unless VITE_ENABLE_LEGACY_SCREENS is explicitly "true"', () => {
    // Neither CI nor a production build sets this var, so the default build
    // must never wire up the no-backend screens.
    expect(features.LEGACY_SCREENS_ENABLED).toBe(import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true');
    expect(features.LEGACY_SCREENS_ENABLED).toBe(false);
  });
});

// LGMOB: diagnostic ids reach users only together with the /privacy page (P1), so a build has them
// only when VITE_DIAG_IDS is exactly "true". The build fixes it; tests stub it per test.
describe('diagIdsEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off when VITE_DIAG_IDS is unset, as in every committed env file and the web image', () => {
    vi.stubEnv('VITE_DIAG_IDS', undefined);
    expect(features.diagIdsEnabled()).toBe(false);
  });

  it.each(['', 'false', '0', '1', 'TRUE', 'True', 'yes', 'on', ' true'])('is off for %j', (value) => {
    vi.stubEnv('VITE_DIAG_IDS', value);
    expect(features.diagIdsEnabled()).toBe(false);
  });

  it('is on for "true" alone, read at each call', () => {
    vi.stubEnv('VITE_DIAG_IDS', 'true');
    expect(features.diagIdsEnabled()).toBe(true);
    vi.stubEnv('VITE_DIAG_IDS', undefined);
    expect(features.diagIdsEnabled()).toBe(false);
  });
});

describe('sign-in', () => {
  it('is not a build switch: OIDC is the only sign-in (WK-15)', () => {
    expect(Object.keys(features).sort()).toEqual(['LEGACY_SCREENS_ENABLED', 'diagIdsEnabled']);
  });
});
