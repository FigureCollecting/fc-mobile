import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAST_BUILD_KEY, markHydrated, readStorageStatus, recordBuild, requestPersistentStorage, resetHydratedForTest } from '../storage';

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

describe('recordBuild', () => {
  function memory(): Pick<Storage, 'getItem' | 'setItem'> {
    const items = new Map<string, string>();
    return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) };
  }

  it('is no update on the first run here (nothing recorded yet), and records the build', () => {
    const s = memory();
    expect(recordBuild('build-41', s)).toBe(false);
    expect(s.getItem(LAST_BUILD_KEY)).toBe('build-41');
  });

  it('is an update once, when the build differs from the last one seen here', () => {
    const s = memory();
    recordBuild('build-41', s);
    expect(recordBuild('build-42', s)).toBe(true);
    expect(s.getItem(LAST_BUILD_KEY)).toBe('build-42');
    expect(recordBuild('build-42', s)).toBe(false);
  });

  it('names a rollback too: any build other than the last one seen here is a change', () => {
    const s = memory();
    s.setItem(LAST_BUILD_KEY, 'build-42');
    expect(recordBuild('build-41', s)).toBe(true);
    expect(s.getItem(LAST_BUILD_KEY)).toBe('build-41');
  });

  it('is no update when the build is unchanged', () => {
    const s = memory();
    s.setItem(LAST_BUILD_KEY, 'build-41');
    expect(recordBuild('build-41', s)).toBe(false);
  });

  it('records nothing for a build with no id', () => {
    const s = memory();
    s.setItem(LAST_BUILD_KEY, 'build-41');
    expect(recordBuild(undefined, s)).toBe(false);
    expect(recordBuild('', s)).toBe(false);
    expect(s.getItem(LAST_BUILD_KEY)).toBe('build-41');
  });

  it('keeps the last build seen in localStorage', () => {
    localStorage.setItem(LAST_BUILD_KEY, 'build-41');
    expect(recordBuild('build-42')).toBe(true);
    expect(localStorage.getItem(LAST_BUILD_KEY)).toBe('build-42');
  });

  it('never throws: storage that refuses a read or a write is no update', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(recordBuild('build-42', { getItem: refuse, setItem: () => {} })).toBe(false);
    expect(recordBuild('build-42', { getItem: () => 'build-41', setItem: refuse })).toBe(false);
  });
});
