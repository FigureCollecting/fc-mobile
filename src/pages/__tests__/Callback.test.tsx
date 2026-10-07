import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { Callback } from '../Callback';
import { renderWithProviders } from '../../test/testUtils';
import { LoginError, ReloadRequiredError } from '../../auth/errors';
import type { AuthStatus } from '../../auth/session';
import { reloadToLatest } from '../../pwa/updates';

vi.mock('../../pwa/updates', () => ({ reloadToLatest: vi.fn(async () => undefined) }));

const URL_IN = 'http://localhost:8480/callback?code=c&state=s';

/** Rejections nothing handled while `run` and a following macrotask ran. */
async function unhandledDuring(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => void seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

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

  it('offers a way back to where the user started, replacing /callback in history', async () => {
    const s = session(async () => {
      throw new LoginError('access_denied', 'User cancelled', '/figure/7');
    });
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText('access_denied: User cancelled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(s.signIn).toHaveBeenCalledWith('/figure/7');
    fireEvent.click(screen.getByRole('button', { name: /back to your collection/i }));
    expect(view.history).toEqual(['/figure/7']);
  });

  it('goes back home from a failure that has no pending login, saying nothing the link said', async () => {
    const s = session(async () => {
      throw new LoginError('unknown_state');
    });
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText(/link has expired or was already used/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to your collection/i }));
    expect(view.history).toEqual(['/']);
  });

  it('names a network failure plainly', async () => {
    const s = session(async () => {
      throw new TypeError('Failed to fetch');
    });
    const view = renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to your collection/i }));
    expect(view.history).toEqual(['/']);
  });

  it('asks for a reload, not another sign-in, when a newer build owns the local store', async () => {
    const s = session(async () => {
      throw new ReloadRequiredError();
    });
    const reload = vi.fn();
    const view = renderWithProviders(<Callback session={s} url={URL_IN} reload={reload} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.getByText(/needs a reload/i)).toBeInTheDocument();
    expect(screen.getByText(/kept on this device/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(s.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /back to your collection/i }));
    expect(view.history).toEqual(['/']);
  });

  it('reloads into the newest build when no reload is given', async () => {
    const s = session(async () => {
      throw new ReloadRequiredError();
    });
    renderWithProviders(<Callback session={s} url={URL_IN} />, { initialPath: '/callback' });
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(reloadToLatest).toHaveBeenCalledTimes(1);
  });

  it('offers no reload for a sign-in that only failed', async () => {
    const s = session(async () => {
      throw new LoginError('access_denied');
    });
    renderWithProviders(<Callback session={s} url={URL_IN} reload={vi.fn()} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('shows why a try again could not start, and leaves no unhandled rejection', async () => {
    const s = session(async () => {
      throw new LoginError('access_denied');
    });
    // A plain function: a vi.fn would itself handle the rejection it returns.
    const tries: (string | undefined)[] = [];
    const signIn = (returnTo?: string): Promise<void> => {
      tries.push(returnTo);
      return Promise.reject(new ReloadRequiredError());
    };
    renderWithProviders(<Callback session={{ ...s, signIn }} url={URL_IN} reload={vi.fn()} />, { initialPath: '/callback' });
    await screen.findByText(/sign-in did not finish/i);
    const unhandled = await unhandledDuring(async () => {
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      await screen.findByRole('button', { name: 'Reload' });
    });
    expect(tries).toEqual(['/']);
    expect(unhandled).toEqual([]);
    expect(screen.getByText(/needs a reload/i)).toBeInTheDocument();
  });

  it('asks for a reload when a spent link meets a store this page can no longer open, leaving no unhandled rejection', async () => {
    const s = {
      ...session(async () => {
        throw new LoginError('unknown_state');
      }),
      // A plain function: a vi.fn would itself handle the rejection it returns.
      start: (): Promise<AuthStatus> => Promise.reject(new ReloadRequiredError()),
    };
    const reload = vi.fn();
    const unhandled = await unhandledDuring(async () => {
      renderWithProviders(<Callback session={s} url={URL_IN} reload={reload} />, { initialPath: '/callback' });
      await screen.findByText(/sign-in did not finish/i);
    });
    expect(unhandled).toEqual([]);
    expect(screen.getByText(/needs a reload/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
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
