import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChromeStore, createScrollChromeHandler } from '../chrome';

beforeEach(() => useChromeStore.setState({ hidden: false }));

describe('chrome visibility store', () => {
  it('hides chrome on a sustained scroll down', () => {
    const handler = createScrollChromeHandler();
    handler(0);
    handler(120);
    expect(useChromeStore.getState().hidden).toBe(true);
  });

  it('shows chrome again on scroll up', () => {
    const handler = createScrollChromeHandler();
    handler(300);
    expect(useChromeStore.getState().hidden).toBe(true);
    handler(240);
    expect(useChromeStore.getState().hidden).toBe(false);
  });

  it('always shows chrome near the top regardless of direction', () => {
    const handler = createScrollChromeHandler();
    handler(300);
    expect(useChromeStore.getState().hidden).toBe(true);
    handler(10); // jumped near top
    expect(useChromeStore.getState().hidden).toBe(false);
  });

  it('ignores sub-threshold jitter', () => {
    const set = vi.fn();
    const handler = createScrollChromeHandler(set);
    handler(100);
    set.mockClear();
    handler(103); // +3px: below threshold, no state flip
    expect(set).not.toHaveBeenCalled();
  });
});
