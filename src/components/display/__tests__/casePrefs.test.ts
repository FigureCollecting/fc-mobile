import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import {
  CASE_PREFS_KEY,
  DEFAULT_CASE_PREFS,
  WALL_PATTERNS,
  readCasePrefs,
  useCasePrefs,
  wallPatternProfiles,
  writeCasePrefs,
} from '../casePrefs';
import { IKEA_DETOLF, OPEN_STEEL_RACK } from '../cabinetPresets';

beforeEach(() => localStorage.clear());

describe('case prefs, kept per device (CC14)', () => {
  it('defaults: the Detolf (CC16), whole cabinets, the camera walks (CC4 playable), an 8 ft ceiling', () => {
    expect(DEFAULT_CASE_PREFS).toEqual({ pattern: 'ikea-detolf', view: 'wall', swipe: 'camera', ceilingMm: 2438.4 });
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
  });

  it('round-trips through localStorage', () => {
    writeCasePrefs({ swipe: 'pan', view: 'shelf', pattern: 'ikea-detolf+open-steel-rack', ceilingMm: 2700 });
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!)).toEqual({ pattern: 'ikea-detolf+open-steel-rack', view: 'shelf', swipe: 'pan', ceilingMm: 2700 });
    expect(readCasePrefs()).toEqual({ pattern: 'ikea-detolf+open-steel-rack', view: 'shelf', swipe: 'pan', ceilingMm: 2700 });
  });

  it('a partial write keeps the rest', () => {
    writeCasePrefs({ swipe: 'pan' });
    expect(readCasePrefs()).toEqual({ ...DEFAULT_CASE_PREFS, swipe: 'pan' });
  });

  it('anything unknown or broken falls back field by field', () => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ pattern: 'nope', view: 'aerial', swipe: 'fly', ceilingMm: -3 }));
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
    localStorage.setItem(CASE_PREFS_KEY, '{not json');
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
    localStorage.setItem(CASE_PREFS_KEY, '7');
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
  });

  it('a storage that throws reads the defaults and drops writes', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
    expect(() => writeCasePrefs({ swipe: 'pan' })).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it('the hook reads, updates and persists', () => {
    const { result } = renderHook(() => useCasePrefs());
    expect(result.current[0].swipe).toBe('camera');
    act(() => result.current[1]({ swipe: 'pan' }));
    expect(result.current[0].swipe).toBe('pan');
    expect(readCasePrefs().swipe).toBe('pan');
  });
});

describe('wall patterns', () => {
  it('every preset alone, and the Detolf with the rack alongside', () => {
    expect(WALL_PATTERNS.map((p) => p.id)).toContain('ikea-detolf+open-steel-rack');
    expect(wallPatternProfiles('ikea-detolf+open-steel-rack')).toEqual([IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(wallPatternProfiles('open-steel-rack')).toEqual([OPEN_STEEL_RACK]);
    expect(wallPatternProfiles('unknown')).toEqual([IKEA_DETOLF]);
  });
});
