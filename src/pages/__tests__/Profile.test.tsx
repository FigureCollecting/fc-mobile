import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/preact';
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

  it('opens fc-password-change for a password change and the user settings for two-factor, in this tab', async () => {
    await localRig();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    const account = screen.getByRole('heading', { level: 3, name: 'Account' }).parentElement as HTMLElement;
    const rows = within(account).getAllByRole('link');
    expect(rows.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Change Password', 'https://auth.mindsignals1.com/if/flow/fc-password-change/'],
      ['Two-Factor Authentication', 'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D'],
    ]);
    for (const a of rows) expect(a).not.toHaveAttribute('target');
    // The email change waits for the sign-in server to offer it on that page (its settings flow changes the name only).
    expect(within(account).queryByText(/change email/i)).not.toBeInTheDocument();
  });

  it.each(['reauth-required', 'offline'] as const)('keeps the same rows while the session is %s: the app session does not gate them', async (status) => {
    await localRig({ status });
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    const account = screen.getByRole('heading', { level: 3, name: 'Account' }).parentElement as HTMLElement;
    expect(within(account).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      'https://auth.mindsignals1.com/if/flow/fc-password-change/',
      'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D',
    ]);
  });

  it('offers no account change to a guest', async () => {
    await localRig({ status: 'signed-out' });
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.queryByRole('link', { name: /change password|change email|two-factor/i })).not.toBeInTheDocument();
  });

  it('signs out through the session', async () => {
    const r = await localRig();
    const user = userEvent.setup();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    const confirm = (await screen.findByText('Sign Out?')).closest('.sign-out-confirm') as HTMLElement;
    await user.click(within(confirm).getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(r.session.signOut).toHaveBeenCalled());
  });
});
