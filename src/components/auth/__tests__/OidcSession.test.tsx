import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { signal } from '@preact/signals';
import type { SyncState } from '../../../sync/engine';
import { createBrowserSession } from '../../../auth';
import { LOCAL_DB_VERSION } from '../../../storage/localDb';
import type { AuthSession } from '../../../auth/session';
import { renderWithProviders } from '../../../test/testUtils';
import OidcSession from '../OidcSession';

const h = vi.hoisted(() => ({
  session: undefined as AuthSession | undefined,
  reloadToLatest: vi.fn(async () => undefined),
  startBrowserSync: vi.fn(),
}));
vi.mock('../../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../auth')>()),
  getAuthSession: () => h.session,
}));
vi.mock('../../../pwa/updates', () => ({ reloadToLatest: h.reloadToLatest }));
vi.mock('../../../sync/browser', () => ({ startBrowserSync: h.startBrowserSync }));

function fakeSync(patch: Partial<SyncState> = {}) {
  const state = signal<SyncState>({ reachability: 'unknown', phase: 'idle', pending: 0, rejected: [], overwritten: 0, lastSyncedAt: null, lastError: null, ...patch });
  const engine = { state, dismissRejected: vi.fn(async () => undefined) };
  return { engine, dispose: vi.fn() };
}

const settle = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function sessionOn(factory: IDBFactory): AuthSession {
  return createBrowserSession({
    location: { origin: 'https://app.test', assign: vi.fn() },
    fetch: vi.fn(async () => new Response(null, { status: 500 })),
    indexedDB: factory,
  });
}

describe('OidcSession', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);

  beforeEach(() => {
    rejections.length = 0;
    h.reloadToLatest.mockClear();
    h.startBrowserSync.mockReset();
    h.startBrowserSync.mockImplementation(() => fakeSync());
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });

  it('boots into a reload banner, not loading forever, when a newer build owns the store', async () => {
    const factory = new IDBFactory();
    (await settle(factory.open('fc-mobile', LOCAL_DB_VERSION + 1))).close();
    h.session = sessionOn(factory);
    renderWithProviders(<OidcSession />);
    await waitFor(() => expect(h.session!.status.value).toBe('reload-required'));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(rejections).toEqual([]);
  });

  it('reloads into the newest build from the banner', async () => {
    const factory = new IDBFactory();
    (await settle(factory.open('fc-mobile', LOCAL_DB_VERSION + 1))).close();
    h.session = sessionOn(factory);
    renderWithProviders(<OidcSession />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(h.reloadToLatest).toHaveBeenCalledTimes(1);
  });

  it('boots a fresh device into the sign-in banner', async () => {
    h.session = sessionOn(new IDBFactory());
    renderWithProviders(<OidcSession />);
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(h.session.status.value).toBe('signed-out');
  });

  it('shows nothing on /callback, which has its own screen', async () => {
    h.session = sessionOn(new IDBFactory());
    renderWithProviders(<OidcSession />, { initialPath: '/callback' });
    await waitFor(() => expect(h.session!.status.value).toBe('signed-out'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("starts the page's sync with the session and shows what it reports, never a toast", async () => {
    h.session = sessionOn(new IDBFactory());
    const sync = fakeSync({ reachability: 'unreachable', pending: 4, rejected: [{ id: 1, facet_key: 'uf/x/note', reason: 'payload_invalid' }] });
    h.startBrowserSync.mockImplementation(() => sync);
    renderWithProviders(<OidcSession />);
    expect(await screen.findByText(/Can't reach server\. 4 changes waiting to sync\./)).toBeInTheDocument();
    expect(h.startBrowserSync.mock.calls[0]![0]).toBe(h.session);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(sync.engine.dismissRejected).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('shows no sync line on /callback', async () => {
    h.session = sessionOn(new IDBFactory());
    h.startBrowserSync.mockImplementation(() => fakeSync({ reachability: 'unreachable' }));
    renderWithProviders(<OidcSession />, { initialPath: '/callback' });
    await waitFor(() => expect(h.startBrowserSync).toHaveBeenCalled());
    expect(screen.queryByText(/Can't reach server/)).toBeNull();
  });

  it("leaves sync off in an e2e build when the suite asks (the auth suite counts the edge's requests exactly)", async () => {
    vi.stubEnv('VITE_E2E_HOOKS', 'true');
    localStorage.setItem('fc.e2e.sync', 'off');
    try {
      h.session = sessionOn(new IDBFactory());
      renderWithProviders(<OidcSession />);
      await waitFor(() => expect(h.session!.status.value).toBe('signed-out'));
      expect(h.startBrowserSync).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('fc.e2e.sync');
      vi.unstubAllEnvs();
    }
  });

  it('ignores that switch in any other build', async () => {
    localStorage.setItem('fc.e2e.sync', 'off');
    try {
      h.session = sessionOn(new IDBFactory());
      renderWithProviders(<OidcSession />);
      await waitFor(() => expect(h.startBrowserSync).toHaveBeenCalled());
    } finally {
      localStorage.removeItem('fc.e2e.sync');
    }
  });
});
