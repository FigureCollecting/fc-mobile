import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

const auth = vi.hoisted(() => ({ signIn: vi.fn(async () => undefined) }));
vi.mock('../../auth', async () => {
  const { fakeAuthSession } = await import('../../test/appSession');
  const session = { ...fakeAuthSession('signed-out'), signIn: auth.signIn };
  return { getAuthSession: () => session };
});
vi.mock('../../sync/browser', async () => {
  const { fakeBrowserSync } = await import('../../test/appSession');
  const sync = await fakeBrowserSync();
  return { startBrowserSync: () => sync };
});

import { Onboarding } from '../Onboarding';
import { App } from '../../app';
import { renderWithProviders } from '../../test/testUtils';

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

  it('is not shown once completed, and its sign-in and create-account choices start the Authentik sign-in', async () => {
    localStorage.setItem('onboarding_complete', '1');
    const first = renderWithProviders(<App />, { initialPath: '/' });
    expect(screen.queryByText(/your collection, anywhere/i)).not.toBeInTheDocument();
    first.unmount();

    for (const choice of [/^sign in$/i, /create account/i]) {
      localStorage.removeItem('onboarding_complete');
      auth.signIn.mockClear();
      const user = userEvent.setup();
      const view = renderWithProviders(<App />, { initialPath: '/discover' });
      await user.click(screen.getAllByRole('tab')[3]!);
      await user.click(await screen.findByRole('button', { name: choice }));
      await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('/'));
      expect(view.currentPath()).toBe('/');
      expect(localStorage.getItem('onboarding_complete')).toBe('1');
      view.unmount();
    }
  });
});
