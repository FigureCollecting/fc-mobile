import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/preact';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

afterEach(() => cleanup());

// PACK1 (Ross 10-26): the case's arrangement is chosen in the View card, with the cabinets it fills
describe('the View card: Arrange by', () => {
  const group = () => screen.getByRole('group', { name: 'Arrange by' });

  it('six choices in plain words, series, then scale, then name chosen on a fresh device', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent!.trim())).toEqual([
      'Series, then scale, then name',
      'Scale, then series, then name',
      'Series, then name',
      'Scale, then name',
      'Name',
      'Date added, oldest first',
    ]);
    expect(radios.filter((r) => (r as HTMLInputElement).checked).map((r) => r.closest('label')!.textContent!.trim())).toEqual(['Series, then scale, then name']);
  });

  it('a tap is a patch of the pref; the stored choice is the one shown', () => {
    const onChange = vi.fn();
    const { unmount } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    fireEvent.click(within(group()).getByRole('radio', { name: 'Date added, oldest first' }));
    expect(onChange).toHaveBeenCalledWith({ arrange: 'date-added' });
    unmount();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, arrange: 'scale-name' }} onChange={vi.fn()} onClose={() => {}} />);
    expect(within(group()).getByRole('radio', { name: 'Scale, then name' })).toBeChecked();
    expect(within(group()).getByRole('radio', { name: 'Series, then scale, then name' })).not.toBeChecked();
  });

  it('stands right after the cabinets it fills', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    const legends = screen.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent);
    expect(legends.indexOf('Arrange by')).toBe(legends.indexOf('Cabinets') + 1);
  });
});
