import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, writeCasePrefs } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-2A (NAVDEF a, Ross 10-31): Free camera is on by default on every device; the View card keeps the box that turns it
// off on this one. NAV-2A2 (Ross 11-04): no swipe mode on either camera; a stored one is not read (casePrefs.test.ts).

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('the Free camera pref', () => {
  it('is on by default, and on for a record that does not say', () => {
    expect(DEFAULT_CASE_PREFS.freeCamera).toBe(true);
    expect(readCasePrefs().freeCamera).toBe(true);
    writeCasePrefs({ view: 'shelf' });
    expect(readCasePrefs().freeCamera).toBe(true);
  });

  it('is off only when stored exactly false', () => {
    writeCasePrefs({ freeCamera: false, view: 'shelf' });
    expect(readCasePrefs()).toMatchObject({ freeCamera: false, view: 'shelf' });
    for (const bad of [0, 'false', 'no', null, {}, true]) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: bad, view: 'shelf' }));
      expect(readCasePrefs(), JSON.stringify(bad)).toMatchObject({ freeCamera: true, view: 'shelf' });
    }
  });
});

describe('the View card: a "Free camera" checkbox beside "Show estimated sizes"', () => {
  it('ticked to begin with; a tap is a patch of the pref; unticked when the pref is off', () => {
    const onChange = vi.fn();
    const { unmount } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Free camera' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ freeCamera: false });
    unmount();
    const on = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, freeCamera: false }} onChange={on} onClose={() => {}} />);
    const off = screen.getByRole('checkbox', { name: 'Free camera' });
    expect(off).not.toBeChecked();
    fireEvent.click(off);
    expect(on).toHaveBeenCalledWith({ freeCamera: true });
  });

  it('sits right after the estimated-sizes row', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    const boxes = screen.getAllByRole('checkbox').map((b) => b.closest('label')!.textContent!.trim());
    expect(boxes.indexOf('Free camera')).toBe(boxes.indexOf('Show estimated sizes') + 1);
  });
});
