import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DiagIds = typeof import('../diagIds');

// The module holds the session's unsaved choice, so each test starts from a fresh copy of it.
let m: DiagIds;
beforeEach(async () => {
  vi.resetModules();
  m = await import('../diagIds');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const refuse = (method: 'getItem' | 'setItem' | 'removeItem') =>
  vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });

describe('the Diagnostic ids choice, kept per device', () => {
  it("stores under 'fc-diag-ids', and the default is on", () => {
    expect(m.DIAG_IDS_KEY).toBe('fc-diag-ids');
    expect(m.diagIdsDefault()).toBe(true);
  });

  it("reads absent as the default (on) and 'off' as off", () => {
    expect(localStorage.getItem('fc-diag-ids')).toBeNull();
    expect(m.diagIdsOn()).toBe(true);
    localStorage.setItem('fc-diag-ids', 'off');
    expect(m.diagIdsOn()).toBe(false);
  });

  it("reads 'on' as on, and a value it never writes as the default", () => {
    localStorage.setItem('fc-diag-ids', 'on');
    expect(m.diagIdsOn()).toBe(true);
    localStorage.setItem('fc-diag-ids', 'false');
    expect(m.diagIdsOn()).toBe(m.diagIdsDefault());
  });

  it("stores only the choice that differs from the default: off writes 'off', on removes the key", () => {
    m.setDiagIds(false);
    expect(localStorage.getItem('fc-diag-ids')).toBe('off');
    expect(m.diagIdsOn()).toBe(false);
    m.setDiagIds(true);
    expect(localStorage.getItem('fc-diag-ids')).toBeNull();
    expect(m.diagIdsOn()).toBe(true);
    expect(m.diagIdsSaved()).toBe(true);
  });

  it('reads storage on every call, so a change another tab makes applies to the next call here', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(m.diagIdsOn()).toBe(true);
    localStorage.setItem('fc-diag-ids', 'off');
    expect(m.diagIdsOn()).toBe(false);
    localStorage.removeItem('fc-diag-ids');
    expect(m.diagIdsOn()).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('a browser that will not keep the choice', () => {
  it('reads the default when getItem throws, and a choice made then holds for the session', () => {
    refuse('getItem');
    expect(m.diagIdsOn()).toBe(true);
    m.setDiagIds(false);
    expect(m.diagIdsOn()).toBe(false);
    expect(m.diagIdsOn()).toBe(false);
    m.setDiagIds(true);
    expect(m.diagIdsOn()).toBe(true);
  });

  it('reads the default when the localStorage getter itself throws (storage blocked), and holds a choice for the session', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(m.diagIdsOn()).toBe(true);
    m.setDiagIds(false);
    expect(m.diagIdsOn()).toBe(false);
    expect(m.diagIdsSaved()).toBe(false);
  });

  it('keeps the choice in memory when setItem throws, and flags it as not saved', () => {
    refuse('setItem');
    expect(m.diagIdsSaved()).toBe(true);
    m.setDiagIds(false);
    expect(localStorage.getItem('fc-diag-ids')).toBeNull();
    expect(m.diagIdsOn()).toBe(false);
    expect(m.diagIdsSaved()).toBe(false);
  });

  it('keeps the choice in memory when removeItem throws, and flags it as not saved', () => {
    localStorage.setItem('fc-diag-ids', 'off');
    refuse('removeItem');
    m.setDiagIds(true);
    expect(localStorage.getItem('fc-diag-ids')).toBe('off');
    expect(m.diagIdsOn()).toBe(true);
    expect(m.diagIdsSaved()).toBe(false);
  });

  it('lets storage decide again once a later choice is saved', () => {
    const write = refuse('setItem');
    m.setDiagIds(false);
    expect(m.diagIdsSaved()).toBe(false);
    write.mockRestore();
    m.setDiagIds(false);
    expect(m.diagIdsSaved()).toBe(true);
    expect(localStorage.getItem('fc-diag-ids')).toBe('off');
    localStorage.removeItem('fc-diag-ids');
    expect(m.diagIdsOn()).toBe(true);
  });

  it('never throws to the caller', () => {
    refuse('getItem');
    refuse('setItem');
    refuse('removeItem');
    expect(() => m.diagIdsOn()).not.toThrow();
    expect(() => m.setDiagIds(false)).not.toThrow();
    expect(() => m.setDiagIds(true)).not.toThrow();
    expect(() => m.diagIdsSaved()).not.toThrow();
  });
});
