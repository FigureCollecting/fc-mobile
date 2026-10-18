import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CaseTabs } from '../CaseTabs';
import { CaseViewCard } from '../CaseViewCard';
import { DEFAULT_CASE_PREFS } from '../casePrefs';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

const slots = (_root: ParentNode, root: ParentNode = document.body) => Array.from(root.querySelectorAll<HTMLElement>('.case-tabs > [data-tab]')).map((el) => el.dataset.tab);

describe('CaseTabs (IC1-R1: View, Reserved | raised + | Info, Refine)', () => {
  it('lays the four slots out around the dock of the raised +', () => {
    const { container } = render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    expect(slots(container)).toEqual(['view', 'reserved', 'dock', 'info', 'refine']);
  });

  it('sits in document.body, so the page\'s own transforms never carry the fixed bar away from the tab bar', () => {
    const { container } = render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    expect(container.querySelector('.case-tabs')).toBeNull();
    expect(document.body.querySelector(':scope > .case-tabs')).not.toBeNull();
  });

  it('IC1-R3: the Reserved slot is held empty, with nothing to press or read', () => {
    render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    const reserved = document.body.querySelector('[data-tab="reserved"]') as HTMLElement;
    expect(reserved.tagName).toBe('SPAN');
    expect(reserved.textContent).toBe('');
    expect(reserved.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['View', 'Info', 'Refine']);
  });

  it('follows the order kept on this device (CC14), e.g. swapped sides', () => {
    const { container } = render(<CaseTabs order={['refine', 'info', 'reserved', 'view']} infoEnabled onTab={() => {}} open={null} />);
    expect(slots(container)).toEqual(['refine', 'info', 'dock', 'reserved', 'view']);
  });

  it('opens a card on tap and marks the open one; Info waits for a tapped figure', () => {
    const onTab = vi.fn();
    render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled={false} onTab={onTab} open="view" />);
    expect(screen.getByRole('button', { name: 'View' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Refine' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Info' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));
    expect(onTab).toHaveBeenCalledWith('refine');
  });
});

describe('CaseViewCard (the View tab: view, cabinets, ceiling, tab sides)', () => {
  function card() {
    const onChange = vi.fn();
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    return onChange;
  }

  it('switches among whole cabinets, one cabinet and one shelf', () => {
    const onChange = card();
    expect(screen.getByRole('radio', { name: 'Whole cabinets' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'One shelf' }));
    expect(onChange).toHaveBeenCalledWith({ view: 'shelf' });
  });

  it('lists the three cabinets and the comparison wall, the KLINGSBO first, and offers no buy link', () => {
    const onChange = card();
    const names = screen.getAllByRole('radio', { name: /IKEA|rack|KLINGSBO with/ }).map((r) => r.getAttribute('aria-label') ?? (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(names[0]).toMatch(/KLINGSBO/);
    expect(screen.getByRole('radio', { name: /^IKEA KLINGSBO glass-door cabinet/ })).toBeChecked();
    expect(screen.getAllByText(/no longer sold/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(screen.getByRole('radio', { name: /^IKEA DETOLF/ }));
    expect(onChange).toHaveBeenCalledWith({ pattern: 'ikea-detolf' });
  });

  it('CAM1: the swipe mode is not in the View card any more: it lives in the header, beside the display modes', () => {
    card();
    expect(screen.queryByText('Swipe')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Move the camera' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Pan the wall' })).toBeNull();
    // what stays: the view, the cabinets, the ceiling and the tab sides
    expect(screen.getAllByRole('radio', { name: /Whole cabinets|One cabinet|One shelf/ })).toHaveLength(3);
    expect(screen.getByRole('spinbutton', { name: /ceiling/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap tab sides' })).toBeInTheDocument();
  });

  it('CC5: the card fits its content above the raised + of the tab bar and scrolls its body, never running under the bar', () => {
    card();
    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    expect(sheet.classList.contains('bottom-sheet--fit')).toBe(true);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.bottom-sheet--fit\s*\{[^}]*bottom:\s*calc\(var\(--fab-size\) \/ 1\.25 \+ 4px\);[^}]*height:\s*auto;[^}]*max-height:\s*min\(85%, calc\(100% - var\(--fab-size\) \/ 1\.25 - 4px - 8px\)\);/);
    expect(css).toMatch(/\.bottom-sheet--fit \.bottom-sheet__content\s*\{[^}]*min-height:\s*0;/);
  });

  it('CC9: the room ceiling in inches, kept in mm; nonsense is ignored', () => {
    const onChange = card();
    const input = screen.getByRole('spinbutton', { name: /ceiling/i }) as HTMLInputElement;
    expect(input.value).toBe('96');
    fireEvent.change(input, { target: { value: '108' } });
    expect(onChange).toHaveBeenCalledWith({ ceilingMm: 2743.2 });
    onChange.mockClear();
    fireEvent.change(input, { target: { value: '-4' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swaps the tab sides', () => {
    const onChange = card();
    fireEvent.click(screen.getByRole('button', { name: /swap tab sides/i }));
    expect(onChange).toHaveBeenCalledWith({ tabOrder: ['refine', 'info', 'reserved', 'view'] });
  });
});
