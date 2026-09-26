import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { SyncAuthBanner } from '../SyncAuthBanner';
import { renderWithProviders } from '../../../test/testUtils';
import type { AuthStatus } from '../../../auth/session';

function setup(status: AuthStatus, path = '/') {
  const session = { status: signal<AuthStatus>(status), signIn: vi.fn(async () => undefined) };
  const view = renderWithProviders(<SyncAuthBanner session={session} />, { initialPath: path });
  return { session, view };
}

describe('SyncAuthBanner', () => {
  it.each<AuthStatus>(['loading', 'signed-in', 'offline'])('stays out of the way while %s', (status) => {
    setup(status);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('offers sign-in to sync when no one is signed in, returning to the current screen', () => {
    const { session, view } = setup('signed-out', '/figure/7');
    expect(screen.getByText(/sign in to sync/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(session.signIn).toHaveBeenCalledWith('/figure/7');
    expect(view.currentPath()).toBe('/figure/7');
  });

  it('says local changes are kept when the session needs signing in again', async () => {
    const { session } = setup('reauth-required');
    expect(screen.getByRole('status')).toHaveTextContent(/sign in to sync/i);
    expect(screen.getByRole('status')).toHaveTextContent(/kept on this device/i);
    session.status.value = 'signed-in';
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
