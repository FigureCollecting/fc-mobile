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

// LGMOB M2: an off owes a device-wide clear of origin_trace. The marker says so until a clear has committed,
// across reloads and whatever the switch says by then.
describe('the clear an off owes', () => {
  const MARK = 'fc-diag-ids-clear-pending';

  it('is owed by no one on a fresh device', () => {
    expect(m.DIAG_IDS_CLEAR_KEY).toBe(MARK);
    expect(m.diagIdsClearPending()).toBeUndefined();
  });

  it('off writes the marker with the choice, and on leaves it', () => {
    m.setDiagIds(false);
    const mark = localStorage.getItem(MARK);
    expect(mark).not.toBeNull();
    expect(m.diagIdsClearPending()).toBe(mark);
    m.setDiagIds(true);
    expect(m.diagIdsOn()).toBe(true);
    expect(m.diagIdsClearPending()).toBe(mark);
  });

  it('survives a reload: a fresh module instance still sees it, with the switch back on', async () => {
    m.setDiagIds(false);
    m.setDiagIds(true);
    const mark = m.diagIdsClearPending();
    vi.resetModules();
    const reloaded: DiagIds = await import('../diagIds');
    expect(reloaded.diagIdsOn()).toBe(true);
    expect(reloaded.diagIdsClearPending()).toBe(mark);
  });

  it('done removes the mark it is given, and only that one: a newer off keeps its own', () => {
    m.setDiagIds(false);
    const first = m.diagIdsClearPending()!;
    m.setDiagIds(false);
    const newer = m.diagIdsClearPending()!;
    expect(newer).not.toBe(first);
    m.diagIdsClearDone(first);
    expect(m.diagIdsClearPending()).toBe(newer);
    m.diagIdsClearDone(newer);
    expect(m.diagIdsClearPending()).toBeUndefined();
    expect(localStorage.getItem(MARK)).toBeNull();
  });

  it("done for an older stored mark leaves a newer one held in memory (that clear began before this page's off)", () => {
    m.setDiagIds(false);
    const older = m.diagIdsClearPending()!;
    const write = refuse('setItem');
    m.setDiagIds(false);
    write.mockRestore();
    const held = m.diagIdsClearPending()!;
    expect(held).not.toBe(older);
    expect(localStorage.getItem(MARK)).toBe(older);
    m.diagIdsClearDone(older);
    expect(localStorage.getItem(MARK)).toBeNull();
    expect(m.diagIdsClearPending()).toBe(held);
  });

  it('storage refuses the marker: it is kept in memory for this page until done', () => {
    refuse('setItem');
    m.setDiagIds(false);
    expect(localStorage.getItem(MARK)).toBeNull();
    const mark = m.diagIdsClearPending();
    expect(mark).toEqual(expect.any(String));
    m.diagIdsClearDone(mark!);
    expect(m.diagIdsClearPending()).toBeUndefined();
  });

  it('storage blocked outright: the page still owes the clear, and done never throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(m.diagIdsClearPending()).toBeUndefined();
    m.setDiagIds(false);
    const mark = m.diagIdsClearPending()!;
    expect(mark).toEqual(expect.any(String));
    expect(() => m.diagIdsClearDone(mark)).not.toThrow();
    expect(m.diagIdsClearPending()).toBeUndefined();
  });

  it('a later saved marker takes over from one held in memory', () => {
    const write = refuse('setItem');
    m.setDiagIds(false);
    const held = m.diagIdsClearPending()!;
    write.mockRestore();
    m.setDiagIds(false);
    const stored = localStorage.getItem(MARK)!;
    expect(stored).not.toBe(held);
    expect(m.diagIdsClearPending()).toBe(stored);
  });

  it('a removal storage refuses leaves the marker set, so the next start or sync clears again', () => {
    m.setDiagIds(false);
    const mark = m.diagIdsClearPending()!;
    refuse('removeItem');
    expect(() => m.diagIdsClearDone(mark)).not.toThrow();
    expect(m.diagIdsClearPending()).toBe(mark);
  });
});
