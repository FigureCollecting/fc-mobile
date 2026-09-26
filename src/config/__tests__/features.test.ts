import { describe, it, expect } from 'vitest';
import { LEGACY_SCREENS_ENABLED } from '../features';

describe('LEGACY_SCREENS_ENABLED', () => {
  it('is off unless VITE_ENABLE_LEGACY_SCREENS is explicitly "true"', () => {
    // Neither CI nor a production build sets this var, so the default build
    // must never wire up the no-backend screens.
    expect(LEGACY_SCREENS_ENABLED).toBe(import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true');
    expect(LEGACY_SCREENS_ENABLED).toBe(false);
  });
});
