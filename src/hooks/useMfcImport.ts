// The MFC import (WK-15) through ImportService. ONLINE ONLY (import.proto): the client imports only
// once it has pushed its whole outbox and has every push answered, so the import sees every edit of
// this device; and before it shows the result it pulls until it has applied the import's own
// transaction (its marker imp/mfc/import at the import's number), so the review set it shows is
// what the store holds. The server decides everything; the client only shows the counts.
import { useMutation } from '@tanstack/react-query';
import { importMarkerKey, type ImportMfcExportResponse } from '@figurecollecting/fc-api-contract';
import { requireSession, type LocalSession } from '../local/session';

/** import.proto: csv_text is at most 2 MiB of UTF-8. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_TIMEOUT_MS = 120_000;
/** Pulls after the import before the result shows anyway (the next pass still applies it). */
const MARKER_PULLS = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRefusedError';
  }
}

const changes = (n: number): string => (n === 1 ? '1 change is' : `${n} changes are`);

async function markerNumber(session: LocalSession): Promise<number> {
  const rec = await session.engine.read((store) => store.getFacet(importMarkerKey('mfc')));
  if (rec?.value?.op !== 'upsert') return 0;
  try {
    const n = (JSON.parse(rec.value.payload) as { import?: unknown }).import;
    return typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
}

export async function runImport(session: LocalSession, csvText: string, exportDate: string): Promise<ImportMfcExportResponse> {
  if (new TextEncoder().encode(csvText).byteLength > IMPORT_MAX_BYTES) throw new ImportRefusedError('This file is larger than 2 MiB, the most one import takes.');
  if (!DATE.test(exportDate)) throw new ImportRefusedError('Give the date MFC stamped on the export (YYYY-MM-DD).');
  // Push first: the import must see every edit this device made.
  await session.engine.trigger('manual');
  const state = session.engine.state.peek();
  if (state.pending > 0) throw new ImportRefusedError(`${changes(state.pending)} still waiting to sync. Import once it has synced.`);
  if (state.reachability !== 'reachable') throw new ImportRefusedError("Can't reach the server. Importing needs a connection.");
  const response = await session.clients.import.importMfcExport({ csvText, exportDate }, { signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS) });
  for (let i = 0; i < MARKER_PULLS && (await markerNumber(session)) < response.importNumber; i++) await session.engine.trigger('manual');
  return response;
}

export function useMfcImport() {
  return useMutation({
    mutationFn: ({ csvText, exportDate }: { csvText: string; exportDate: string }) => runImport(requireSession(), csvText, exportDate),
  });
}
