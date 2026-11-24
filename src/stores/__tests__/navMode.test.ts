import { describe, it, expect, vi, beforeEach } from 'vitest';
import { navModeNow, setTempLook, toggleNavMode, useNavMode } from '../navMode';

// NAV-EYE (plan section 3): the hat's mode, latched for the session (a card opened and closed, a Go-to, the case left
// and come back to keep it) and Move again on a reload: it lives in memory only, never in storage.

beforeEach(() => useNavMode.setState({ latched: 'move', temp: false }));

describe('the hat\'s mode', () => {
  it('starts in Move; a toggle latches Look, another Move', () => {
    expect(navModeNow()).toBe('move');
    toggleNavMode();
    expect(useNavMode.getState().latched).toBe('look');
    expect(navModeNow()).toBe('look');
    toggleNavMode();
    expect(navModeNow()).toBe('move');
  });

  it('a temporary Look (NAVLOOK 2a) is Look while it lasts and leaves the latched mode as it was', () => {
    setTempLook(true);
    expect(navModeNow()).toBe('look');
    expect(useNavMode.getState().latched).toBe('move');
    setTempLook(false);
    expect(navModeNow()).toBe('move');
  });

  it('(g) a reload starts in Move: a fresh module is Move, and nothing was stored', async () => {
    toggleNavMode();
    expect(navModeNow()).toBe('look');
    vi.resetModules();
    const fresh = await import('../navMode');
    expect(fresh.navModeNow()).toBe('move');
    expect(fresh.useNavMode.getState()).toMatchObject({ latched: 'move', temp: false });
    expect(Object.keys(localStorage).filter((k) => /nav|mode|look/i.test(k))).toEqual([]);
    expect(Object.keys(sessionStorage).filter((k) => /nav|mode|look/i.test(k))).toEqual([]);
  });
});
