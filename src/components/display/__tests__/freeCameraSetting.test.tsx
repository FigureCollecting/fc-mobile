import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/preact';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, writeCasePrefs } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';
import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-1A (rulings R0.2): Free camera is a per-device trial setting, off by default; off is today's app. Nothing migrates:
// the swipe mode stays 'pan' | 'camera' and in Free camera the header names them Move and Look around.

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('the Free camera (trial) pref', () => {
  it('is off by default and absent from the stored prefs while off', () => {
    expect(DEFAULT_CASE_PREFS.freeCamera ?? false).toBe(false);
    expect(readCasePrefs().freeCamera ?? false).toBe(false);
    writeCasePrefs({ view: 'shelf' });
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!)).not.toHaveProperty('freeCamera');
  });

  it('is on only when stored exactly true', () => {
    writeCasePrefs({ freeCamera: true });
    expect(readCasePrefs().freeCamera).toBe(true);
    for (const bad of [1, 'true', 'yes', null, {}, false]) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: bad }));
      expect(readCasePrefs().freeCamera ?? false).toBe(false);
    }
  });
});

describe('the View card: a "Free camera (trial)" checkbox beside "Show estimated sizes"', () => {
  it('off to begin with; a tap is a patch of the pref; on when the pref is', () => {
    const onChange = vi.fn();
    const { unmount } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Free camera (trial)' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ freeCamera: true });
    unmount();
    const off = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, freeCamera: true }} onChange={off} onClose={() => {}} />);
    const on = screen.getByRole('checkbox', { name: 'Free camera (trial)' });
    expect(on).toBeChecked();
    fireEvent.click(on);
    expect(off).toHaveBeenCalledWith({ freeCamera: false });
  });

  it('sits right after the estimated-sizes row', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    const boxes = screen.getAllByRole('checkbox').map((b) => b.closest('label')!.textContent!.trim());
    expect(boxes.indexOf('Free camera (trial)')).toBe(boxes.indexOf('Show estimated sizes') + 1);
  });
});

describe('the header swipe button in Free camera: Move and Look around', () => {
  const mount = (freeCamera: boolean | undefined, swipe: 'pan' | 'camera') =>
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" caseView="wall" swipe={swipe} freeCamera={freeCamera} labels={false} onLayout={vi.fn()} onDensity={vi.fn()} onCaseView={vi.fn()} onSwipe={vi.fn()} onLabels={vi.fn()} />,
    ) as ReturnType<typeof renderWithProviders> & { unmount: () => void };

  it('names the modes Move and Look around; off, they stay Pan the wall and Move the camera', () => {
    const names = (free: boolean | undefined) => {
      const { unmount } = mount(free, 'pan');
      const button = screen.getByRole('button', { name: /^Swipe/ });
      const label = button.getAttribute('aria-label');
      fireEvent.click(button);
      const items = within(screen.getByRole('menu', { name: 'Swipe modes' })).getAllByRole('menuitemradio').map((i) => i.textContent);
      unmount();
      return { label, items };
    };
    expect(names(true)).toEqual({ label: 'Swipe, Look around', items: ['Look around', 'Move'] });
    expect(names(false)).toEqual({ label: 'Swipe, Pan the wall', items: ['Pan the wall', 'Move the camera'] });
    expect(names(undefined)).toEqual({ label: 'Swipe, Pan the wall', items: ['Pan the wall', 'Move the camera'] });
  });
});
