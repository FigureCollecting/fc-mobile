import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Mock the shared login helper before importing the page.
vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    loginUser: vi.fn(),
  };
});

import { loginUser } from '@figurecollecting/fc-shared';
import { Login } from '../Login';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedLogin = loginUser as unknown as ReturnType<typeof vi.fn>;

function renderLogin(initialPath = '/login') {
  return renderWithProviders(<Login />, { initialPath });
}

describe('Login page', () => {
  beforeEach(() => {
    mockedLogin.mockReset();
  });

  it('renders the sign-in form', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it('shows inline error when email is invalid on blur', async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = screen.getByLabelText(/email address/i);
    await user.click(email);
    await user.type(email, 'not-an-email');
    // Shift focus to the password field so the email input's focusout fires.
    await user.click(screen.getByLabelText(/^password$/i));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
  });

  it('shows a submit-level error when password is missing', async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = screen.getByLabelText(/email address/i);
    fireEvent.input(email, { target: { value: 'a@b.co' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/please enter your password/i)).toBeInTheDocument();
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('calls loginUser on valid submit and navigates home on success', async () => {
    const user = userEvent.setup();
    mockedLogin.mockResolvedValueOnce({
      _id: 'u1',
      username: 'tester',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      refreshToken: 'ref',
      tokenExpiresAt: Date.now() + 60_000,
    });

    const { currentPath } = renderLogin();
    fireEvent.input(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'hunter22!' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledWith(expect.anything(), 'a@b.co', 'hunter22!'));
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('navigates to /2fa when login indicates 2FA required', async () => {
    const user = userEvent.setup();
    mockedLogin.mockResolvedValueOnce({
      requiresTwoFactor: true,
      sessionId: 'sess-1',
      methods: ['totp'],
    });

    const { currentPath } = renderLogin();
    fireEvent.input(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'hunter22!' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(currentPath()).toBe('/2fa'));
    expect(useAuthStore.getState().twoFactorPending?.sessionId).toBe('sess-1');
  });

  it('shows server-side error message when login fails', async () => {
    const user = userEvent.setup();
    mockedLogin.mockRejectedValueOnce({
      response: { data: { message: 'Bad credentials' } },
    });

    renderLogin();
    fireEvent.input(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'whatever' } });
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/bad credentials/i)).toBeInTheDocument();
  });
});
