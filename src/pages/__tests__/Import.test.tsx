// The Import screen (WK-15): the MFC export CSV goes to ImportService (online only, after the
// outbox has drained), and the screen shows the counts the server returned.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { ImportMfcExportResponseSchema, SyncOp, importMarkerKey } from '@figurecollecting/fc-api-contract';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Import } from '../Import';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';
import { headOf, serverVersion } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { IMPORT_MAX_BYTES } from '../../hooks/useMfcImport';

afterEach(() => {
  localSession.value = undefined;
});

const CSV = 'ID,Status,Count\n12345,Owned,1\n67890,Wished,1\n99999,Owned,1\n';

/** The server answers the import and writes its marker, as the coordinator's one transaction does. */
function answering(r: LocalRig, number = 1, extra: Record<string, unknown> = {}) {
  r.clients.importMfcExport.mockImplementation(async () => {
    r.server.write([
      { facetKey: importMarkerKey('mfc'), version: serverVersion(T0, 900 + number, '00000000000000000000000000000000'), op: SyncOp.UPSERT, payload: JSON.stringify({ import: number, export_date: '2026-10-05' }) },
    ]);
    return create(ImportMfcExportResponseSchema, {
      resolved: 2,
      added: 2,
      unresolved: [{ mfcId: '99999', status: 'Owned', line: 4, reason: 'no_product' }],
      occurrencesAdded: 2,
      facetsWritten: 5,
      importNumber: number,
      ...extra,
    });
  });
}

async function pick(user: ReturnType<typeof userEvent.setup>, text = CSV) {
  await user.upload(screen.getByLabelText('MFC export (CSV)'), new File([text], 'mfc-export.csv', { type: 'text/csv' }));
}

describe('Import page', () => {
  it('asks for the export and its date, and imports nothing until a file is chosen', async () => {
    await localRig();
    renderWithProviders(<Import />, { initialPath: '/import' });
    expect(screen.getByLabelText('MFC export (CSV)')).toBeInTheDocument();
    expect((screen.getByLabelText('Export date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('sends the CSV to ImportService after a sync, and shows the counts the server returned', async () => {
    const r = await localRig();
    answering(r);
    renderWithProviders(<Import />, { initialPath: '/import' });
    const user = userEvent.setup();
    await pick(user);
    const date = screen.getByLabelText('Export date');
    await user.clear(date);
    await user.type(date, '2026-10-05');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const result = await screen.findByRole('region', { name: 'Import result' });
    expect(r.clients.importMfcExport).toHaveBeenCalledWith({ csvText: CSV, exportDate: '2026-10-05' }, expect.anything());
    expect(r.server.count('status')).toBeGreaterThan(0); // a sync ran first
    expect(within(result).getByText('Rows found')).toBeInTheDocument();
    const count = (label: string) => within(result).getByText(label).nextElementSibling?.textContent;
    expect(count('Rows found')).toBe('2');
    expect(count('New figures')).toBe('2');
    expect(count('Copies added')).toBe('2');
    expect(count('Not found')).toBe('1');
    expect(within(result).getByText(/99999.*line 4.*no product/i)).toBeInTheDocument();
    // The import's transaction was pulled before the counts showed.
    expect(await r.store.getFacet(importMarkerKey('mfc'))).toBeDefined();
  });

  it('links to the conflict review when the import left conflicts', async () => {
    const r = await localRig();
    answering(r, 1, { conflictsPending: 2, keptNewer: 2 });
    const { currentPath } = renderWithProviders(<Import />, { initialPath: '/import' });
    const user = userEvent.setup();
    await pick(user);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(await screen.findByRole('button', { name: 'Review 2 conflicts' }));
    expect(currentPath()).toBe('/review');
  });

  it('does not import while edits still wait to sync', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(1), 'owned'));
    r.server.fault('push', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    renderWithProviders(<Import />, { initialPath: '/import' });
    const user = userEvent.setup();
    await pick(user);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/1 change is still waiting to sync/i)).toBeInTheDocument();
    expect(r.clients.importMfcExport).not.toHaveBeenCalled();
  });

  it('reports a refused import', async () => {
    const r = await localRig();
    r.clients.importMfcExport.mockRejectedValue(new ConnectError('missing ID column', Code.InvalidArgument));
    renderWithProviders(<Import />, { initialPath: '/import' });
    const user = userEvent.setup();
    await pick(user);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/import failed: .*missing ID column/i)).toBeInTheDocument();
  });

  it('refuses a file over 2 MiB before sending anything', async () => {
    const r = await localRig();
    renderWithProviders(<Import />, { initialPath: '/import' });
    const user = userEvent.setup();
    await pick(user, 'ID,Status\n' + 'x'.repeat(IMPORT_MAX_BYTES));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/larger than 2 MiB/i)).toBeInTheDocument();
    expect(r.clients.importMfcExport).not.toHaveBeenCalled();
  });

  it('is off while offline', async () => {
    await localRig();
    renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    try {
      renderWithProviders(<Import />, { initialPath: '/import' });
      expect(screen.getByText('Importing needs a connection.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    } finally {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('asks a signed-out visitor to sign in', async () => {
    await localRig({ status: 'signed-out' });
    renderWithProviders(<Import />, { initialPath: '/import' });
    expect(screen.getByText('Sign in to import your MFC collection.')).toBeInTheDocument();
  });
});
