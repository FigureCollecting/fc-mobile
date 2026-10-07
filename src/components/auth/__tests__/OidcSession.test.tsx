import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserSession } from '../../../auth';
import { LOCAL_DB_VERSION } from '../../../storage/localDb';
import type { AuthSession } from '../../../auth/session';
import { renderWithProviders } from '../../../test/testUtils';
import OidcSession from '../OidcSession';

const h = vi.hoisted(() => ({ session: undefined as AuthSession | undefined, reloadToLatest: vi.fn(async () => undefined) }));
vi.mock('../../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../auth')>()),
  getAuthSession: () => h.session,
}));
vi.mock('../../../pwa/updates', () => ({ reloadToLatest: h.reloadToLatest }));

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
});
