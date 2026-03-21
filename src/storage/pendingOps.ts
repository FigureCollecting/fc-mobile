import { updateFigure, deleteFigure } from '@figurecollecting/fc-shared';
import { getDb } from './db';
import type { PendingOp } from './db';
import type { api } from '../api/client';

type ApiClient = typeof api;

export async function queueOperation(op: Omit<PendingOp, 'createdAt'>): Promise<void> {
  const db = await getDb();
  await db.add('pendingOps', { ...op, createdAt: Date.now() });
}

export async function getPendingOps(): Promise<PendingOp[]> {
  const db = await getDb();
  return db.getAll('pendingOps');
}

export async function getPendingOpsCount(): Promise<number> {
  const db = await getDb();
  return db.count('pendingOps');
}

export async function clearPendingOps(): Promise<void> {
  const db = await getDb();
  await db.clear('pendingOps');
}

export async function flushPendingOps(
  apiClient: ApiClient,
): Promise<{ success: number; failed: number }> {
  const ops = await getPendingOps();
  let success = 0;
  let failed = 0;

  for (const op of ops) {
    try {
      if (op.type === 'update' && op.figureId && op.data) {
        await updateFigure(apiClient, op.figureId, op.data as never);
      } else if (op.type === 'delete' && op.figureId) {
        await deleteFigure(apiClient, op.figureId);
      }
      success++;
    } catch {
      failed++;
    }
  }

  if (success > 0) {
    await clearPendingOps();
  }

  return { success, failed };
}
