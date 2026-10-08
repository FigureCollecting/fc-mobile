import { describe, it, expect } from 'vitest';
import * as features from '../features';

describe('LEGACY_SCREENS_ENABLED', () => {
  it('is off unless VITE_ENABLE_LEGACY_SCREENS is explicitly "true"', () => {
    // Neither CI nor a production build sets this var, so the default build
    // must never wire up the no-backend screens.
    expect(features.LEGACY_SCREENS_ENABLED).toBe(import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true');
    expect(features.LEGACY_SCREENS_ENABLED).toBe(false);
  });
});

describe('sign-in', () => {
  it('is not a build switch: OIDC is the only sign-in (WK-15)', () => {
    expect(Object.keys(features)).toEqual(['LEGACY_SCREENS_ENABLED']);
  });
});
