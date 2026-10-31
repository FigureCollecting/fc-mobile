// The Diagnostic ids switch going off (LGMOB M2): origin_trace leaves every outbox row on this device,
// whatever account wrote it, whatever its state (a frozen batch included, which may never have reached
// the server) and whether or not anyone is signed in, in one transaction that needs no account store.
// A frozen batch retried without its ids is still the same batch: the coordinator leaves origin_trace
// out of replay identity (contract 0.7.0, C3). Nothing is backfilled when the switch comes back on.
import type { LocalDb } from './localDb';
import { runTx } from './tx';

export async function clearOriginTraces(db: LocalDb): Promise<void> {
  await runTx(db, ['outbox'], async (tx) => {
    const outbox = tx.objectStore('outbox');
    for (const entry of await outbox.getAll()) {
      if (entry.origin_trace === undefined) continue;
      delete entry.origin_trace;
      await outbox.put(entry);
    }
  });
}
