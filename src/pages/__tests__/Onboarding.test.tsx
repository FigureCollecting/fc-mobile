import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Onboarding } from '../Onboarding';
import { App } from '../../app';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

describe('Onboarding page', () => {
  it('renders the first screen with a Skip button', () => {
    renderWithProviders(<Onboarding onComplete={() => {}} />, { initialPath: '/' });
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    expect(screen.getByText(/your collection, anywhere/i)).toBeInTheDocument();
  });

  it('calls onComplete("guest") when Skip is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onComplete).toHaveBeenCalledWith('guest');
  });

  it('advances through screens when dot indicators are clicked and lands on CTA buttons', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    // PageDots renders 4 dot buttons; jump to the last (index 3).
    const dots = screen.getAllByRole('tab');
    expect(dots.length).toBeGreaterThanOrEqual(4);
    await user.click(dots[3]);
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(onComplete).toHaveBeenCalledWith('register');
  });

  it('routes to login when Sign In is chosen on the last screen', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    const dots = screen.getAllByRole('tab');
    await user.click(dots[3]);
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));
    expect(onComplete).toHaveBeenCalledWith('login');
  });

  it('routes to "guest" via the Browse as Guest button on the last screen', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    const dots = screen.getAllByRole('tab');
    await user.click(dots[3]);
    await user.click(await screen.findByRole('button', { name: /browse as guest/i }));
    expect(onComplete).toHaveBeenCalledWith('guest');
  });

  it('is NOT shown when the user already has a token', () => {
    // Seed the auth store with a logged-in user.
    useAuthStore.setState({
      user: {
        _id: 'u1',
        username: 'x',
        email: 'x@y.z',
        isAdmin: false,
        token: 'preexisting-token',
        tokenExpiresAt: Date.now() + 60_000,
      },
      isAuthenticated: true,
      lastActivity: Date.now(),
      twoFactorPending: null,
    });

    renderWithProviders(<App />, { initialPath: '/' });
    // Onboarding's title should NOT be on the page; instead we should see
    // AppShell chrome. The onboarding copy is the most distinctive string.
    expect(screen.queryByText(/your collection, anywhere/i)).not.toBeInTheDocument();
    // Also the "onboarding complete" flag should have been persisted as a
    // side effect so the user doesn't see it on next launch.
    expect(localStorage.getItem('onboarding_complete')).toBe('1');
  });
});
