// The Diagnostic ids switch going off (LGMOB M2): origin_trace leaves every outbox row on this device,
// whatever account wrote it and whether or not anyone is signed in, in one transaction that needs no
// account store. A batch sent and unanswered (IN_FLIGHT) keeps its ids: it has sent them once, and its
// retry must stay byte-identical. Nothing is backfilled when the switch comes back on.
import type { LocalDb } from './localDb';
import { runTx } from './tx';

export async function clearOriginTraces(db: LocalDb): Promise<void> {
  await runTx(db, ['outbox'], async (tx) => {
    const outbox = tx.objectStore('outbox');
    for (const entry of await outbox.getAll()) {
      if (entry.origin_trace === undefined || entry.state === 'IN_FLIGHT') continue;
      delete entry.origin_trace;
      await outbox.put(entry);
    }
  });
}
