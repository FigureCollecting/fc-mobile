import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { SyncOp, importItemKey } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Profile } from '../Profile';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf, serverVersion } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';

afterEach(() => {
  localSession.value = undefined;
});

describe('Profile page', () => {
  it('shows the signed-in account and its collection counts from the local store', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'A', copies: 3 }]);
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.collection-stats__count')?.textContent).toBe('3'));
  });

  it('prompts sign-in for guests', async () => {
    await localRig({ status: 'signed-out' });
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText('Sign in to sync your data')).toBeInTheDocument();
  });

  it('hides quick actions for screens with no backend (notifications, export, MFC sync)', async () => {
    await localRig();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.queryByText(/^notifications$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export & share/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^mfc sync$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
  });

  it('links to the import review while items wait for an answer', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'A' }]);
    const payload = JSON.stringify({
      rev: 'r1',
      kind: 'conflict',
      import: 1,
      counts: { owned: { base: 0, app: 1, mfc: 0 }, ordered: { base: 0, app: 0, mfc: 1 }, wished: { base: 0, app: 0, mfc: 0 } },
      fields: { score: { status: 'nochange' }, note: { status: 'nochange' }, wishability: { status: 'nochange' } },
      copies: [],
      mfc_rows: [],
      preview: { keep: { copies: [], fields: [] }, take: { copies: [], fields: [] } },
    });
    r.server.write([{ facetKey: importItemKey('mfc', 'figure', headOf(0)), version: serverVersion(T0, 77, '00000000000000000000000000000000'), op: SyncOp.UPSERT, payload }]);
    await r.engine.trigger('manual');
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(await screen.findByRole('button', { name: /review import \(1\)/i }));
    expect(currentPath()).toBe('/review');
  });

  it('signs out through the session', async () => {
    const r = await localRig();
    const user = userEvent.setup();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    await user.click(await screen.findByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(r.session.signOut).toHaveBeenCalled());
  });
});
