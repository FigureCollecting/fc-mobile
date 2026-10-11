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
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';

beforeEach(() => localStorage.clear());

describe('case prefs, kept per device (CC14)', () => {
  it('defaults: the KLINGSBO (Ross 10-11), whole cabinets, the camera walks (CC4 playable), an 8 ft ceiling, IC1-R1 tab order', () => {
    expect(DEFAULT_CASE_PREFS).toEqual({
      pattern: 'ikea-klingsbo',
      view: 'wall',
      swipe: 'camera',
      ceilingMm: 2438.4,
      tabOrder: ['view', 'reserved', 'info', 'refine'],
    });
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
  });

  it('round-trips through localStorage', () => {
    const prefs = {
      pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack',
      view: 'shelf',
      swipe: 'pan',
      ceilingMm: 2700,
      tabOrder: ['refine', 'info', 'reserved', 'view'],
    } as const;
    writeCasePrefs(prefs);
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!)).toEqual(prefs);
    expect(readCasePrefs()).toEqual(prefs);
  });

  it('a partial write keeps the rest', () => {
    writeCasePrefs({ swipe: 'pan' });
    expect(readCasePrefs()).toEqual({ ...DEFAULT_CASE_PREFS, swipe: 'pan' });
  });

  it('anything unknown or broken falls back field by field', () => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ pattern: 'nope', view: 'aerial', swipe: 'fly', ceilingMm: -3, tabOrder: ['view', 'view', 'info', 'refine'] }));
    expect(readCasePrefs()).toEqual(DEFAULT_CASE_PREFS);
    for (const tabOrder of [['view', 'info', 'refine'], 'view', ['view', 'reserved', 'info', 'refine', 'more'], ['view', 'reserved', 'info', 7]]) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ tabOrder }));
      expect(readCasePrefs().tabOrder).toEqual(DEFAULT_CASE_PREFS.tabOrder);
    }
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ ceilingMm: Number.POSITIVE_INFINITY, swipe: 'camera' }));
    expect(readCasePrefs().ceilingMm).toBe(2438.4);
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
  it('every preset alone, and the KLINGSBO with the Detolf and the rack alongside (Ross 10-11)', () => {
    expect(WALL_PATTERNS.map((p) => p.id)).toEqual([
      'ikea-klingsbo',
      'ikea-detolf',
      'open-steel-rack',
      'ikea-klingsbo+ikea-detolf+open-steel-rack',
    ]);
    expect(wallPatternProfiles('ikea-klingsbo+ikea-detolf+open-steel-rack')).toEqual([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(wallPatternProfiles('open-steel-rack')).toEqual([OPEN_STEEL_RACK]);
    expect(wallPatternProfiles('unknown')).toEqual([IKEA_KLINGSBO]);
  });
});
