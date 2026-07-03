import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useMultiSelect } from '../useMultiSelect';

describe('useMultiSelect', () => {
  it('starts with nothing selected', () => {
    const { result } = renderHook(() => useMultiSelect());
    expect(result.current.selected.size).toBe(0);
    expect(result.current.isSelecting).toBe(false);
  });

  it('enters select mode with an initial id and toggles more', () => {
    const { result } = renderHook(() => useMultiSelect());
    act(() => result.current.enterSelectMode('a'));
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.selected.has('a')).toBe(true);

    act(() => result.current.toggle('b'));
    expect(result.current.selected.has('b')).toBe(true);

    act(() => result.current.toggle('a'));
    expect(result.current.selected.has('a')).toBe(false);
  });

  it('selectAll replaces the set with the given ids', () => {
    const { result } = renderHook(() => useMultiSelect());
    act(() => result.current.enterSelectMode('a'));
    act(() => result.current.selectAll(['x', 'y', 'z']));
    expect(result.current.selected.size).toBe(3);
  });

  it('exitSelectMode clears everything', () => {
    const { result } = renderHook(() => useMultiSelect());
    act(() => result.current.enterSelectMode('a'));
    act(() => result.current.exitSelectMode());
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });
});
