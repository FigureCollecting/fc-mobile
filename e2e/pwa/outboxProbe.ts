// Runs in the page (bundled by web.ts): queues edits through the app's own
// v2 store and reads back what is still pending.
import { openLocalDb } from '../../src/storage/localDb';
import { UserStore } from '../../src/storage/userStore';

export async function queueEdits(sub: string, deviceId: string, headIds: string[]): Promise<string[]> {
  const db = await openLocalDb();
  try {
    const store = await UserStore.open(db, { sub, deviceId });
    const versions: string[] = [];
    for (const head of headIds) versions.push((await store.writeFacet(head, 'status', 'owned')).version);
    return versions;
  } finally {
    db.close();
  }
}

export async function pendingEdits(sub: string): Promise<string[]> {
  const db = await openLocalDb();
  try {
    const rows = await db.getAll('outbox');
    return rows.filter((r) => r.sub === sub && r.state === 'PENDING').map((r) => r.edit_version);
  } finally {
    db.close();
  }
}

// Init scripts may be wrapped in a function scope; publish explicitly.
(globalThis as unknown as { fcOutboxProbe: unknown }).fcOutboxProbe = { queueEdits, pendingEdits };
