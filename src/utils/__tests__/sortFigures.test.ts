import { describe, it, expect } from 'vitest';
import { sortFigures } from '../sortFigures';
import type { Figure } from '@figurecollecting/fc-shared';

const figs = [
  { _id: 'b', name: 'Beta', createdAt: '2026-02-01' },
  { _id: 'a', name: 'alpha', createdAt: '2026-03-01' },
  { _id: 'c', name: 'Gamma', createdAt: '2026-01-01' },
] as Figure[];

describe('sortFigures', () => {
  it('sorts by name case-insensitively', () => {
    expect(sortFigures(figs, 'name', 'asc').map((f) => f._id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by activity (createdAt) descending', () => {
    expect(sortFigures(figs, 'activity', 'desc').map((f) => f._id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input list', () => {
    const before = figs.map((f) => f._id);
    sortFigures(figs, 'name', 'desc');
    expect(figs.map((f) => f._id)).toEqual(before);
  });
});
