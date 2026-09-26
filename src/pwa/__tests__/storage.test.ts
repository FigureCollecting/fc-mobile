import { afterEach, describe, expect, it, vi } from 'vitest';
import { markHydrated, readStorageStatus, requestPersistentStorage, resetHydratedForTest } from '../storage';

function fakeStorage(over: Partial<StorageManager> = {}): StorageManager {
  return {
    persisted: vi.fn(async () => false),
    persist: vi.fn(async () => true),
    estimate: vi.fn(async () => ({ usage: 2048, quota: 4096 })),
    getDirectory: vi.fn(),
    ...over,
  } as unknown as StorageManager;
}

afterEach(() => resetHydratedForTest());

describe('requestPersistentStorage', () => {
  it('asks the browser to keep the origin’s data', async () => {
    const s = fakeStorage();
    expect(await requestPersistentStorage(s)).toBe('granted');
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal', async () => {
    expect(await requestPersistentStorage(fakeStorage({ persist: vi.fn(async () => false) }))).toBe('denied');
  });

  it('does not ask again once persisted', async () => {
    const s = fakeStorage({ persisted: vi.fn(async () => true) });
    expect(await requestPersistentStorage(s)).toBe('persisted');
    expect(s.persist).not.toHaveBeenCalled();
  });

  it('copes with a browser without the API, or one that throws', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({} as StorageManager)).toBe('unsupported');
    const throwing = fakeStorage({ persist: vi.fn(async () => Promise.reject(new Error('x'))) });
    expect(await requestPersistentStorage(throwing)).toBe('denied');
  });
});

describe('markHydrated', () => {
  it('requests persistence after the first hydrate, once per page load', async () => {
    const s = fakeStorage();
    await markHydrated(s);
    await markHydrated(s);
    expect(s.persist).toHaveBeenCalledTimes(1);
  });
});

describe('readStorageStatus', () => {
  it('returns usage, quota and whether the data is kept', async () => {
    expect(await readStorageStatus(fakeStorage({ persisted: vi.fn(async () => true) }))).toEqual({
      usage: 2048,
      quota: 4096,
      persisted: true,
    });
  });

  it('returns null without the API or on failure', async () => {
    expect(await readStorageStatus(undefined)).toBeNull();
    expect(await readStorageStatus(fakeStorage({ estimate: vi.fn(async () => Promise.reject(new Error('x'))) }))).toBeNull();
  });

  it('treats a missing persisted() as not persisted', async () => {
    const s = { estimate: vi.fn(async () => ({ usage: 1, quota: 2 })) } as unknown as StorageManager;
    expect(await readStorageStatus(s)).toEqual({ usage: 1, quota: 2, persisted: false });
  });
});
