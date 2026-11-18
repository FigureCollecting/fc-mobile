import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const fake = vi.hoisted(() => ({ session: undefined as unknown, sync: undefined as unknown, sessions: 0, syncs: 0 }));
vi.mock('../auth', () => ({
  getAuthSession: () => {
    fake.sessions += 1;
    return fake.session;
  },
}));
vi.mock('../sync/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/browser')>()),
  startBrowserSync: () => {
    fake.syncs += 1;
    return fake.sync;
  },
}));

import { App } from '../app';
import { renderWithProviders, flushAll } from '../test/testUtils';
import { fakeAuthSession, fakeBrowserSync, type FakeAuthSession } from '../test/appSession';
import { localSession } from '../local/session';

const heading = () => screen.queryByRole('heading', { level: 1, name: 'Privacy' });

beforeEach(async () => {
  fake.session = fakeAuthSession('signed-out');
  fake.sync = await fakeBrowserSync();
  fake.sessions = 0;
  fake.syncs = 0;
  localStorage.clear();
});

afterEach(() => {
  localSession.value = undefined;
});

// P1: /privacy is readable by anyone, at any time: no account, no onboarding, no session.
describe('/privacy opened by its address', () => {
  it('a first-time visitor reads the page, not the onboarding, and nothing is marked as seen', async () => {
    const view = renderWithProviders(<App />, { initialPath: '/privacy' });
    expect(heading()).toBeInTheDocument();
    expect(screen.queryByText(/your collection, anywhere/i)).toBeNull();
    expect(view.currentPath()).toBe('/privacy');
    expect(localStorage.getItem('onboarding_complete')).toBeNull();
  });

  it('starts no session and no sync, and shows no sign-in prompt, signed out', async () => {
    localStorage.setItem('onboarding_complete', '1');
    const view = renderWithProviders(<App />, { initialPath: '/privacy' });
    expect(heading()).toBeInTheDocument();
    await flushAll();
    await flushAll();
    expect(fake.sessions).toBe(0);
    expect(fake.syncs).toBe(0);
    expect((fake.session as FakeAuthSession).boot).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(view.history).toEqual(['/privacy']);
  });

  it('leaving it starts the app: the onboarding for a first-time visitor', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<App />, { initialPath: '/privacy' });
    await user.click(screen.getByRole('link', { name: 'Open FigureCollecting' }));
    expect(view.currentPath()).toBe('/');
    expect(heading()).toBeNull();
    expect(screen.getByText(/your collection, anywhere/i)).toBeInTheDocument();
  });

  it('leaving it starts the app: the collection and its session for a returning one', async () => {
    localStorage.setItem('onboarding_complete', '1');
    const user = userEvent.setup();
    renderWithProviders(<App />, { initialPath: '/privacy' });
    await user.click(screen.getByRole('link', { name: 'Open FigureCollecting' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(fake.syncs).toBe(1);
  });
});

describe('/privacy reached inside the app', () => {
  it('from the onboarding: the link opens the page alone, and its link back returns to the onboarding', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<App />, { initialPath: '/' });
    await user.click(screen.getByRole('link', { name: 'How we use your data' }));
    expect(view.currentPath()).toBe('/privacy');
    expect(heading()).toBeInTheDocument();
    expect(screen.queryByText(/your collection, anywhere/i)).toBeNull();
    expect(localStorage.getItem('onboarding_complete')).toBeNull();
    expect(fake.syncs).toBe(0);
    await user.click(screen.getByRole('link', { name: 'Open FigureCollecting' }));
    await waitFor(() => expect(screen.getByText(/your collection, anywhere/i)).toBeInTheDocument());
    expect(view.currentPath()).toBe('/');
  });

  it('from Settings: the page shows in the app, and the running session is neither stopped nor started twice', async () => {
    localStorage.setItem('onboarding_complete', '1');
    fake.session = fakeAuthSession('signed-in');
    const user = userEvent.setup();
    const view = renderWithProviders(<App />, { initialPath: '/settings' });
    await waitFor(() => expect(fake.syncs).toBe(1));
    await user.click(await screen.findByRole('link', { name: 'How we use your data' }));
    expect(view.currentPath()).toBe('/privacy');
    await waitFor(() => expect(heading()).toBeInTheDocument());
    // In the app's frame: the tab bar is still there.
    expect(screen.getByRole('button', { name: 'Collection' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open FigureCollecting' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    view.navigate('/settings');
    await waitFor(() => expect(heading()).toBeNull());
    expect(fake.syncs).toBe(1);
    expect((fake.session as FakeAuthSession).boot).toHaveBeenCalledTimes(1);
  });
});
