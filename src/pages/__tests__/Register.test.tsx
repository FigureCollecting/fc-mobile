import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, registerUser: vi.fn() };
});

import { registerUser } from '@figurecollecting/fc-shared';
import { Register } from '../Register';
import { renderWithProviders } from '../../test/testUtils';

const mockedRegister = registerUser as unknown as ReturnType<typeof vi.fn>;

function renderRegister() {
  return renderWithProviders(<Register />, { initialPath: '/register' });
}

describe('Register page', () => {
  beforeEach(() => mockedRegister.mockReset());

  it('renders the registration fields', () => {
    renderRegister();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('shows password strength indicator once typing begins — before submit', async () => {
    const user = userEvent.setup();
    renderRegister();
    const pw = screen.getByLabelText(/^password$/i);
    await user.click(pw);
    await user.type(pw, 'abc');
    // Strength meter renders rule labels immediately.
    expect(screen.getByText(/8\+ characters/i)).toBeInTheDocument();
    expect(screen.getByText(/uppercase letter/i)).toBeInTheDocument();
  });

  it('keeps submit disabled while a request is in flight', async () => {
    const user = userEvent.setup();
    // Long-running promise so we can observe the disabled state.
    let resolver: (v: unknown) => void = () => {};
    const pending = new Promise((res) => { resolver = res; });
    mockedRegister.mockImplementation(() => pending);

    renderRegister();
    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'tester' } });
    fireEvent.input(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'Longpass!1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'Longpass!1' } });

    const submit = screen.getByRole('button', { name: /create account/i });
    // Don't await — the request is hanging intentionally.
    void user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    // Click the button again while disabled; the second attempt should be a
    // no-op (the handler bails out via the `if (loading) return` guard).
    fireEvent.click(submit);
    expect(mockedRegister).toHaveBeenCalledTimes(1);

    // Resolve the pending promise so teardown completes cleanly.
    resolver({
      _id: 'u1',
      username: 'tester',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      tokenExpiresAt: Date.now() + 60_000,
    });
  });

  it('maps duplicate-email server errors onto the email field', async () => {
    const user = userEvent.setup();
    mockedRegister.mockRejectedValueOnce({
      response: { data: { message: 'Email already exists' } },
    });

    renderRegister();
    fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'tester' } });
    fireEvent.input(screen.getByLabelText(/email address/i), { target: { value: 'a@b.co' } });
    fireEvent.input(screen.getByLabelText(/^password$/i), { target: { value: 'Longpass!1' } });
    fireEvent.input(screen.getByLabelText(/confirm password/i), { target: { value: 'Longpass!1' } });

    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/account with this email already exists/i)).toBeInTheDocument();
  });

  it('shows an inline email error on blur when the address is malformed', async () => {
    const user = userEvent.setup();
    renderRegister();
    const email = screen.getByLabelText(/email address/i);
    await user.click(email);
    await user.type(email, 'nope');
    await user.click(screen.getByLabelText(/^password$/i));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
  });
});
