// runImport's guards: what it refuses before anything is sent, and how long it pulls for the
// import's own transaction.
import { afterEach, describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { ImportMfcExportResponseSchema, SyncOp, importMarkerKey } from '@figurecollecting/fc-api-contract';
import { localRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';
import { serverVersion } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';
import { runImport } from '../useMfcImport';

afterEach(() => {
  localSession.value = undefined;
});

describe('runImport', () => {
  it('refuses an export date that is not YYYY-MM-DD, sending nothing', async () => {
    const r = await localRig();
    await expect(runImport(r.session, 'ID,Status\n', '10/05/2026')).rejects.toThrow(/YYYY-MM-DD/);
    expect(r.server.calls).toEqual([]);
  });

  it('refuses when the server cannot be reached, with nothing waiting', async () => {
    const r = await localRig();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await expect(runImport(r.session, 'ID,Status\n', '2026-10-05')).rejects.toThrow(/can't reach the server/i);
    expect(r.clients.importMfcExport).not.toHaveBeenCalled();
  });

  it('pulls until the marker reaches the import, and at most five times past it', async () => {
    const r = await localRig();
    r.clients.importMfcExport.mockResolvedValue(create(ImportMfcExportResponseSchema, { importNumber: 3 }));
    const statusesBefore = () => r.server.count('status');
    await runImport(r.session, 'ID,Status\n', '2026-10-05');
    // No marker ever came: one sync before the import, then five pulls.
    expect(statusesBefore()).toBe(6);
  });

  it('reads an unreadable marker as no import yet', async () => {
    const r = await localRig();
    r.server.write([{ facetKey: importMarkerKey('mfc'), version: serverVersion(T0, 1, '00000000000000000000000000000000'), op: SyncOp.UPSERT, payload: '{not json' }]);
    r.clients.importMfcExport.mockResolvedValue(create(ImportMfcExportResponseSchema, { importNumber: 1 }));
    await runImport(r.session, 'ID,Status\n', '2026-10-05');
    expect(r.server.count('status')).toBe(6);
  });
});
