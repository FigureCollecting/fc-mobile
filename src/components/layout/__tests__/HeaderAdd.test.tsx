import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
import { HeaderAdd } from '../HeaderAdd';
import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';
import { useAddStore } from '../../../stores/add';
import { localSession } from '../../../local/session';
import { stubSessionStatus } from '../../../test/sessionStatus';

// ADDFAB b (plan section 7): on the collection, Add sits in the header beside Case / Tiles; the raised + leaves the tab
// bar while it does, and the Add sheet it opens is the tab bar's own.
beforeEach(() => {
  useAddStore.setState({ open: false, inHeader: 0 });
  stubSessionStatus('signed-in');
});
afterEach(() => {
  localSession.value = undefined;
});

describe('HeaderAdd', () => {
  // SIGNED-OUT-ADD: no Add for a visitor with no account, in a header or in the bar; nor while the session loads.
  it.each(['signed-out', 'loading'] as const)('%s: no header Add, and the bar has no + either', (status) => {
    stubSessionStatus(status);
    const bar = renderWithProviders(<TabBar />);
    const header = renderWithProviders(<HeaderAdd />);
    expect(header.container.querySelector('.header-add')).toBeNull();
    expect(bar.container.querySelector('.tab-bar__add')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add figures' })).toBeNull();
    expect(useAddStore.getState().inHeader).toBe(0);
  });

  it('a session that signs in while the header shows: Add arrives in the header and the bar stays clear', () => {
    const status = stubSessionStatus('loading');
    const bar = renderWithProviders(<TabBar />);
    const header = renderWithProviders(<HeaderAdd />);
    expect(header.container.querySelector('.header-add')).toBeNull();
    act(() => {
      status.value = 'signed-in';
    });
    expect(header.container.querySelector('.header-add')).not.toBeNull();
    expect(bar.container.querySelector('.tab-bar__add')).toBeNull();
    expect(useAddStore.getState().inHeader).toBe(1);
    act(() => {
      status.value = 'signed-out';
    });
    expect(header.container.querySelector('.header-add')).toBeNull();
    expect(useAddStore.getState().inHeader).toBe(0);
  });

  it('is the one Add button while it shows: the tab bar\'s raised + is gone, and back when it leaves', async () => {
    const bar = renderWithProviders(<TabBar />);
    expect(bar.container.querySelector('.tab-bar__add')).not.toBeNull();
    const header = renderWithProviders(<HeaderAdd />);
    expect(bar.container.querySelector('.tab-bar__add')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add figures' })).toEqual([header.container.querySelector('.header-add')]);
    header.unmount();
    await waitFor(() => expect(bar.container.querySelector('.tab-bar__add')).not.toBeNull());
    expect(useAddStore.getState().inHeader).toBe(0);
  });

  it('a tap opens the Add sheet with the import and the barcode lookup', async () => {
    const user = userEvent.setup();
    const bar = renderWithProviders(<TabBar />);
    renderWithProviders(<HeaderAdd />);
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add figures' }));
    await user.click(screen.getByText(/import your mfc export/i));
    expect(bar.currentPath()).toBe('/import');
  });
});
