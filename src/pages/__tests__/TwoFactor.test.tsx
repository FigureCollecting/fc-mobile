import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, verify2FA: vi.fn() };
});

import { verify2FA } from '@figurecollecting/fc-shared';
import { TwoFactor } from '../TwoFactor';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedVerify = verify2FA as unknown as ReturnType<typeof vi.fn>;

function seedPending() {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    lastActivity: 0,
    twoFactorPending: { sessionId: 'sess-1', methods: ['totp'] },
  });
}

describe('TwoFactor page', () => {
  beforeEach(() => mockedVerify.mockReset());

  it('redirects to /login when there is no pending 2FA session', async () => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      lastActivity: 0,
      twoFactorPending: null,
    });
    const { currentPath } = renderWithProviders(<TwoFactor />, { initialPath: '/2fa' });
    await waitFor(() => expect(currentPath()).toBe('/login'));
  });

  it('renders the code input when a pending session exists', () => {
    seedPending();
    renderWithProviders(<TwoFactor />, { initialPath: '/2fa' });
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('verifies the code, updates auth state, and navigates home', async () => {
    seedPending();
    mockedVerify.mockResolvedValueOnce({
      success: true,
      data: {
        _id: 'u1',
        username: 't',
        email: 'a@b.co',
        isAdmin: false,
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
      },
    });

    const { currentPath } = renderWithProviders(<TwoFactor />, { initialPath: '/2fa' });
    const input = screen.getByLabelText(/verification code/i);
    fireEvent.input(input, { target: { value: '123456' } });

    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith(
      expect.anything(), 'sess-1', 'totp', '123456',
    ));
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.token).toBe('new-token');
  });

  it('shows an error when the verification code is wrong', async () => {
    const user = userEvent.setup();
    seedPending();
    mockedVerify.mockRejectedValueOnce({
      response: { data: { message: 'Invalid verification code' } },
    });

    renderWithProviders(<TwoFactor />, { initialPath: '/2fa' });
    const input = screen.getByLabelText(/verification code/i);
    fireEvent.input(input, { target: { value: '654321' } });

    // Wait for the auto-submit path to fail and display the error.
    expect(await screen.findByText(/invalid verification code/i)).toBeInTheDocument();

    // Cancel should bounce us back to /login and clear pending.
    const cancel = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancel);
    expect(useAuthStore.getState().twoFactorPending).toBeNull();
  });
});
