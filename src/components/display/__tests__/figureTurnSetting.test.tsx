import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, writeCasePrefs } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-FLAT (Ross 11-15): how far the figures turn toward where you stand is a View setting, off, subtle (the default) or
// strong, kept per device with the other case prefs (CC14), as the depth control is.

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('the figure turn pref', () => {
  it('is subtle by default, and for a record that does not say', () => {
    expect(DEFAULT_CASE_PREFS.figureTurn).toBe('subtle');
    expect(readCasePrefs().figureTurn).toBe('subtle');
    writeCasePrefs({ view: 'shelf' });
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!).figureTurn).toBe('subtle');
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view: 'shelf', depthRocker: 'horizontal' }));
    expect(readCasePrefs()).toMatchObject({ figureTurn: 'subtle', view: 'shelf', depthRocker: 'horizontal' });
  });

  it('keeps off and strong once chosen, across a fresh read; anything else stored is subtle', () => {
    for (const turn of ['off', 'strong', 'subtle'] as const) {
      writeCasePrefs({ figureTurn: turn, view: 'cabinet' });
      expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!).figureTurn).toBe(turn);
      expect(readCasePrefs()).toMatchObject({ figureTurn: turn, view: 'cabinet' });
    }
    for (const bad of ['Strong', 'none', 0, 0.8, null, {}, true, false]) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ figureTurn: bad, view: 'cabinet' }));
      expect(readCasePrefs(), JSON.stringify(bad)).toMatchObject({ figureTurn: 'subtle', view: 'cabinet' });
    }
  });
});

describe('the View card: a "Turn figures toward you" choice', () => {
  it('three choices, subtle picked to begin with; a tap is a patch of the pref', () => {
    const onChange = vi.fn();
    const { unmount } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    const group = screen.getByRole('group', { name: 'Turn figures toward you' });
    const off = screen.getByRole('radio', { name: 'Off' });
    const subtle = screen.getByRole('radio', { name: 'Subtle' });
    const strong = screen.getByRole('radio', { name: 'Strong' });
    expect([off, subtle, strong].every((r) => group.contains(r))).toBe(true);
    expect(subtle).toBeChecked();
    expect(off).not.toBeChecked();
    expect(strong).not.toBeChecked();
    fireEvent.click(strong);
    expect(onChange).toHaveBeenCalledWith({ figureTurn: 'strong' });
    fireEvent.click(off);
    expect(onChange).toHaveBeenCalledWith({ figureTurn: 'off' });
    unmount();
    const on = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, figureTurn: 'off' }} onChange={on} onClose={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Subtle' }));
    expect(on).toHaveBeenCalledWith({ figureTurn: 'subtle' });
  });

  it('is offered with the Classic camera too (it knows where the eye stands as well)', () => {
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, freeCamera: false }} onChange={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole('group', { name: 'Turn figures toward you' })).toBeInTheDocument();
  });
});
