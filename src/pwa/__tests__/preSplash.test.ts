import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissPreSplash } from '../preSplash';

describe('dismissPreSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="pre-splash" class="pre-splash"></div><div id="app"></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('fades the static splash after the app mounts, then removes it', () => {
    dismissPreSplash();
    const el = document.getElementById('pre-splash');
    expect(el?.classList.contains('pre-splash--hidden')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(el?.classList.contains('pre-splash--hidden')).toBe(true);
    expect(document.getElementById('pre-splash')).not.toBeNull();
    vi.advanceTimersByTime(500);
    expect(document.getElementById('pre-splash')).toBeNull();
  });

  it('does nothing when there is no splash', () => {
    document.body.innerHTML = '';
    dismissPreSplash();
    vi.runAllTimers();
    expect(document.body.innerHTML).toBe('');
  });
});
