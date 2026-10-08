// useSearch on the device (WK-15): an n-gram index over the user's own figures (title, maker,
// character, series, JAN), queried locally, offline included, timed with performance marks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { ProductCardSchema } from '@figurecollecting/fc-api-contract';
import { localRig, queryWrapper, type LocalRig } from '../../local/__tests__/localHarness';
import { headOf, seedCopies } from '../../sync/__tests__/engineSupport';
import { localSession } from '../../local/session';
import { SEARCH_MEASURE, useSearch } from '../useSearch';

afterEach(() => {
  localSession.value = undefined;
  performance.clearMeasures();
});

const AS_OF = '2026-10-01T00:00:00.000000Z';
const text = (value: string) => ({ value, asOf: AS_OF });

async function seeded(): Promise<LocalRig> {
  const r = await localRig();
  seedCopies(r.server, 3);
  const cards = [
    { title: 'Hatsune Miku: Deep Sea Girl', manufacturer: 'Good Smile Company', character: '初音ミク', gtin: '04580416940986' },
    { title: '鹿目まどか 浴衣Ver.', manufacturer: 'アニプレックス', character: '鹿目まどか', gtin: '04534530123456' },
    { title: 'Spike Spiegel', manufacturer: 'Bandai Spirits', character: 'Spike', gtin: '' },
  ];
  cards.forEach((c, i) => {
    r.server.products.set(
      headOf(i),
      create(ProductCardSchema, {
        headId: headOf(i),
        requestedAs: [{ ref: { case: 'headId', value: headOf(i) } }],
        title: text(c.title),
        manufacturer: text(c.manufacturer),
        character: text(c.character),
        series: text('Series'),
        gtin14s: c.gtin === '' ? [] : [c.gtin],
      }),
    );
  });
  await r.engine.trigger('start');
  return r;
}

async function search(result: { current: ReturnType<typeof useSearch> }, q: string) {
  act(() => result.current.updateQuery(q));
  await waitFor(() => expect(result.current.debouncedQuery).toBe(q.trim()));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
}

describe('useSearch', () => {
  it('finds a Latin query, a JAN and a kana query among the local figures', async () => {
    await seeded();
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'deep sea');
    expect(result.current.results.map((r) => r.id)).toEqual([headOf(0)]);
    expect(result.current.results[0]).toMatchObject({ name: 'Hatsune Miku: Deep Sea Girl', manufacturer: 'Good Smile Company', mfcLink: '' });
    expect(result.current.figures[0]!.local.headId).toBe(headOf(0));
    await search(result, '4534530123456');
    expect(result.current.results.map((r) => r.id)).toEqual([headOf(1)]);
    await search(result, 'みく');
    expect(result.current.results.map((r) => r.id)).toEqual([headOf(0)]);
    expect(result.current.hasSearched).toBe(true);
  });

  it('searches offline, with no request made', async () => {
    const r = await seeded();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('manual');
    const calls = r.server.calls.length;
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'spiegel');
    expect(result.current.results.map((r) => r.id)).toEqual([headOf(2)]);
    expect(r.server.calls.length).toBe(calls);
  });

  it('times every search with a performance measure', async () => {
    await seeded();
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'spike');
    const measures = performance.getEntriesByName(SEARCH_MEASURE, 'measure');
    expect(measures.length).toBeGreaterThan(0);
    expect(measures.at(-1)!.duration).toBeGreaterThanOrEqual(0);
  });

  it('counts a single CJK character as a search, and a single Latin letter as none', async () => {
    await seeded();
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, '鹿');
    expect(result.current.hasSearched).toBe(true);
    expect(result.current.results.map((r) => r.id)).toEqual([headOf(1)]);
    await search(result, 's');
    expect(result.current.hasSearched).toBe(false);
    expect(result.current.results).toEqual([]);
  });

  it('follows the store: a figure added later is found', async () => {
    const r = await seeded();
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'Figure');
    expect(result.current.results).toEqual([]);
    await act(async () => {
      await r.engine.write((s) => s.createCopy(headOf(7), 'wished'));
    });
    r.server.seedProducts([headOf(7)]);
    await act(() => r.engine.trigger('manual'));
    await waitFor(() => expect(result.current.results.map((x) => x.id)).toEqual([headOf(7)]));
  });

  it('lists each figure once, whatever kinds it is held in', async () => {
    const r = await seeded();
    await r.engine.write((s) => s.createCopy(headOf(0), 'wished'));
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'miku');
    expect(result.current.results.map((x) => x.id)).toEqual([headOf(0)]);
  });

  it('still searches where performance marks throw', async () => {
    await seeded();
    const spy = vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('no marks here');
    });
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    await search(result, 'spike');
    expect(result.current.results.map((x) => x.id)).toEqual([headOf(2)]);
    expect(spy).toHaveBeenCalled();
  });

  it('reads unreadable recent searches as none, and survives a storage that throws', () => {
    localStorage.setItem('fc-recent-searches', '{not json');
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    expect(result.current.getRecentSearches()).toEqual([]);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => result.current.clearRecentSearches()).not.toThrow();
  });

  it('keeps recent searches, newest first, ten at most, and clears them', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: queryWrapper() });
    act(() => {
      for (let i = 0; i < 12; i++) result.current.saveRecentSearch(`q${i}`);
      result.current.saveRecentSearch('q0');
      result.current.saveRecentSearch('  ');
    });
    expect(result.current.getRecentSearches()).toHaveLength(10);
    expect(result.current.getRecentSearches()[0]).toBe('q0');
    act(() => result.current.clearRecentSearches());
    expect(result.current.getRecentSearches()).toEqual([]);
  });
});
