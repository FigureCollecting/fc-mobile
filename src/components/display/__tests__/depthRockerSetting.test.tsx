import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, writeCasePrefs } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-ROCKER (Ross 11-14): the depth control is a vertical rocker above the slot by default (a); a View setting switches
// it to a horizontal slider in the slot (b). Kept per device like the other View settings (CC14).

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('the depth control pref', () => {
  it('is the vertical rocker by default, and for a record that does not say', () => {
    expect(DEFAULT_CASE_PREFS.depthRocker).toBe('vertical');
    expect(readCasePrefs().depthRocker).toBe('vertical');
    writeCasePrefs({ view: 'shelf' });
    expect(readCasePrefs().depthRocker).toBe('vertical');
  });

  it('keeps the horizontal slider once chosen, across a fresh read; anything else stored is the vertical rocker', () => {
    writeCasePrefs({ depthRocker: 'horizontal', view: 'shelf' });
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!).depthRocker).toBe('horizontal');
    expect(readCasePrefs()).toMatchObject({ depthRocker: 'horizontal', view: 'shelf' });
    for (const bad of ['Horizontal', 'sideways', 1, null, {}, true]) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ depthRocker: bad, view: 'shelf' }));
      expect(readCasePrefs(), JSON.stringify(bad)).toMatchObject({ depthRocker: 'vertical', view: 'shelf' });
    }
  });
});

describe('the View card: a "Depth control" choice under the estimated-sizes row', () => {
  it('two choices, the vertical rocker picked to begin with; a tap is a patch of the pref', () => {
    const onChange = vi.fn();
    const { unmount } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    const group = screen.getByRole('group', { name: 'Depth control' });
    const vertical = screen.getByRole('radio', { name: /vertical rocker/i });
    const horizontal = screen.getByRole('radio', { name: /horizontal slider/i });
    expect(group.contains(vertical) && group.contains(horizontal)).toBe(true);
    expect(vertical).toBeChecked();
    expect(horizontal).not.toBeChecked();
    fireEvent.click(horizontal);
    expect(onChange).toHaveBeenCalledWith({ depthRocker: 'horizontal' });
    unmount();
    const on = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, depthRocker: 'horizontal' }} onChange={on} onClose={() => {}} />);
    expect(screen.getByRole('radio', { name: /horizontal slider/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /vertical rocker/i }));
    expect(on).toHaveBeenCalledWith({ depthRocker: 'vertical' });
  });

  it('sits right after the estimated-sizes row (NAV-GRAD: no Free camera box between them), always offered', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    const sizes = screen.getByRole('checkbox', { name: 'Show estimated sizes' }).closest('.case-card__sizes')!;
    expect(sizes.nextElementSibling).toBe(screen.getByRole('group', { name: 'Depth control' }));
  });
});
