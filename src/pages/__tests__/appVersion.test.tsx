import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
// One version for every screen: whatever the build injects, Settings and Profile both show it.
vi.mock('../../config/version', () => ({ APP_VERSION: '9.9.9-test' }));

import { Profile } from '../Profile';
import { Settings } from '../Settings';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';

afterEach(() => {
  localSession.value = undefined;
});

describe('the app version on screen', () => {
  it('Settings shows the injected version beside the build', () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getByText(`9.9.9-test (${import.meta.env.VITE_BUILD_ID})`)).toBeInTheDocument();
  });

  it('Profile shows it to a guest and in the signed-in footer', async () => {
    await localRig({ status: 'signed-out' });
    const guest = renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText('9.9.9-test')).toBeInTheDocument();
    guest.unmount();

    await localRig();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText('Figure Collector v9.9.9-test')).toBeInTheDocument();
  });
});
