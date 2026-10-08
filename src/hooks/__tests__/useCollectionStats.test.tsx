// Collection counts from the local store (WK-15): copies per kind, makers by held figures.
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { useCollectionStats } from '../useCollectionStats';

afterEach(() => {
  localSession.value = undefined;
});

describe('useCollectionStats', () => {
  it('counts every copy per kind, leaves former copies out, and ranks makers', async () => {
    const r = await localRig();
    await seedFigures(r, [
      { title: 'A', manufacturer: 'Alter', copies: 3 },
      { title: 'B', manufacturer: 'Kotobukiya', status: 'ordered' },
      { title: 'C', manufacturer: 'Alter', status: 'wished' },
      { title: 'D', manufacturer: '', status: 'wished' },
      { title: 'E', manufacturer: 'Max', status: 'former', disposal: { reason: 'lost' } },
    ]);
    const { result } = renderHook(() => useCollectionStats(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      owned: 3,
      ordered: 1,
      wished: 2,
      total: 6,
      makers: [
        { name: 'Alter', count: 2 },
        { name: 'Kotobukiya', count: 1 },
      ],
    });
  });

  it('is empty-handed before a session', () => {
    const { result } = renderHook(() => useCollectionStats(), { wrapper: queryWrapper() });
    expect(result.current.data).toBeUndefined();
  });
});
