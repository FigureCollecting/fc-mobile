import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { Callback } from '../Callback';
import { renderWithProviders } from '../../test/testUtils';
import { LoginError } from '../../auth/errors';
import type { AuthStatus } from '../../auth/session';

const URL_IN = 'http://localhost:8480/callback?code=c&state=s';

function session(complete: () => Promise<{ sub: string; returnTo: string }>, started: AuthStatus = 'signed-out') {
  return {
    status: signal<AuthStatus>('loading'),
    completeSignIn: vi.fn(complete),
    signIn: vi.fn(async () => undefined),
    start: vi.fn(async () => started),
  };
}

describe('Callback', () => {
  it('finishes the sign-in and replaces /callback with where the user started', async () => {
    const s = session(async () => ({ sub: 'a', returnTo: '/figure/7' }));
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    expect(screen.getByText(/signing you in/i)).toBeInTheDocument();
    await waitFor(() => expect(view.currentPath()).toBe('/figure/7'));
    expect(s.completeSignIn).toHaveBeenCalledWith(URL_IN);
  });

  it('goes home when the callback is reloaded after a sign-in that already finished', async () => {
    const s = session(async () => {
      throw new LoginError('unknown_state');
    }, 'signed-in');
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await waitFor(() => expect(view.currentPath()).toBe('/'));
  });

  it('shows the failure and offers to try again without leaving by itself', async () => {
    const s = session(async () => {
      throw new LoginError('access_denied');
    });
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText(/access_denied/)).toBeInTheDocument();
    expect(view.currentPath()).toBe('/callback');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(s.signIn).toHaveBeenCalledWith('/');
  });

  it('names a network failure plainly', async () => {
    const s = session(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it('does nothing once the page has gone away', async () => {
    for (const outcome of ['ok', 'spent', 'failed'] as const) {
      let settle!: () => void;
      const gate = new Promise<void>((resolve) => (settle = resolve));
      const s = session(async () => {
        await gate;
        if (outcome === 'ok') return { sub: 'a', returnTo: '/figure/7' };
        throw new LoginError(outcome === 'spent' ? 'unknown_state' : 'access_denied');
      }, 'signed-in');
      const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
      view.unmount();
      settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.currentPath()).toBe('/callback');
    }
  });
});
