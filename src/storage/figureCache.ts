import type { Figure } from '@figurecollecting/fc-shared';
import { getDb } from './db';

export async function cacheFigures(figures: Figure[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('figures', 'readwrite');
  for (const figure of figures) {
    await tx.store.put(figure as never);
  }
  await tx.done;
}

export async function getCachedFigures(status?: string): Promise<Figure[]> {
  const db = await getDb();
  if (status) {
    return db.getAllFromIndex('figures', 'by-status', status) as unknown as Promise<Figure[]>;
  }
  return db.getAll('figures') as unknown as Promise<Figure[]>;
}

export async function getCachedFigure(id: string): Promise<Figure | undefined> {
  const db = await getDb();
  return db.get('figures', id) as unknown as Promise<Figure | undefined>;
}

export async function clearCache(): Promise<void> {
  const db = await getDb();
  await db.clear('figures');
  await db.clear('metadata');
}

export async function setMetadata(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put('metadata', value, key);
}

export async function getMetadata(key: string): Promise<unknown> {
  const db = await getDb();
  return db.get('metadata', key);
}
