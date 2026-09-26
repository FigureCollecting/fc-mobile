import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { ErrorBoundary } from '../ErrorBoundary';
import { renderWithProviders } from '../../../test/testUtils';
import { getDb } from '../../../storage/db';

function Bomb(): never {
  throw new Error('boom');
}

/** Minimal fake of the Cache Storage API, just enough to assert on. */
function installFakeCaches(names: string[]) {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: vi.fn().mockResolvedValue(names),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  });
  return deleted;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('reloads immediately when there are no unsynced edits', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    installFakeCaches(['workbox-precache-v2-abc']);

    const user = userEvent.setup();
    renderWithProviders(<ErrorBoundary><Bomb /></ErrorBoundary>);

    await user.click(screen.getByRole('button', { name: /clear cache & reload/i }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('asks for confirmation with pending ops, and leaves the outbox and precache intact on confirm', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const deleted = installFakeCaches(['workbox-precache-v2-abc', 'runtime-cache-1']);

    const db = await getDb();
    await db.put('figures', { _id: 'f1' });
    await db.add('pendingOps', { type: 'create', createdAt: Date.now() });
    await db.add('pendingOps', { type: 'update', createdAt: Date.now() });
    await db.add('pendingOps', { type: 'delete', createdAt: Date.now() });

    const user = userEvent.setup();
    renderWithProviders(<ErrorBoundary><Bomb /></ErrorBoundary>);

    await user.click(screen.getByRole('button', { name: /clear cache & reload/i }));
    // First click only asks for confirmation — no reload yet.
    await screen.findByText(/3 unsynced changes/i);
    expect(reload).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /clear anyway & reload/i }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    expect(await db.count('pendingOps')).toBe(3);
    expect(await db.count('figures')).toBe(0);
    expect(deleted).toContain('runtime-cache-1');
    expect(deleted).not.toContain('workbox-precache-v2-abc');
  });

  it('cancel leaves the error screen without reloading', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    installFakeCaches([]);

    const db = await getDb();
    await db.add('pendingOps', { type: 'create', createdAt: Date.now() });

    const user = userEvent.setup();
    renderWithProviders(<ErrorBoundary><Bomb /></ErrorBoundary>);

    await user.click(screen.getByRole('button', { name: /clear cache & reload/i }));
    await screen.findByText(/1 unsynced change\b/i);

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/unsynced change/i)).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
