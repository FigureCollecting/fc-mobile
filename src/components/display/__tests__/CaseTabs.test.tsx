import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/preact';
import { CASE_TABS_HEIGHT_PX, CaseTabs } from '../CaseTabs';
import { CaseViewCard } from '../CaseViewCard';
import { DEFAULT_CASE_PREFS } from '../casePrefs';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

const slots = (_root: ParentNode, root: ParentNode = document.body) => Array.from(root.querySelectorAll<HTMLElement>('.case-tabs > [data-tab]')).map((el) => el.dataset.tab);

describe('CaseTabs (IC1-R1; NAV-FLOAT: View, Info, Refine together at the centre)', () => {
  it('lays the three headers out side by side: no Reserved slot and no dock for a raised + between them', () => {
    const { container } = render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    expect(slots(container)).toEqual(['view', 'info', 'refine']);
    expect(document.body.querySelector('.case-tabs__dock, [data-tab="dock"], [data-tab="reserved"]')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['View', 'Info', 'Refine']);
  });

  it('sits in document.body, so the page\'s own transforms never carry the fixed bar away from the tab bar', () => {
    const { container } = render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    expect(container.querySelector('.case-tabs')).toBeNull();
    expect(document.body.querySelector(':scope > .case-tabs')).not.toBeNull();
  });

  it('the headers stand centred, each 112 px at most and free to narrow, so a fourth and a fifth still fit the strip', () => {
    render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} infoEnabled onTab={() => {}} open={null} />);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.case-tabs\s*\{[^}]*justify-content:\s*center;/);
    expect(css).toMatch(new RegExp(`\\.case-tabs__slot\\s*\\{\\s*flex:\\s*0 1 112px;\\s*min-width:\\s*0;\\s*height:\\s*${CASE_TABS_HEIGHT_PX}px;`));
    expect(css).not.toMatch(/case-tabs__dock|case-tabs__slot--rocker/);
  });

  it('the tiles: the View slot stays, empty, with nothing to press or read, so the others never move', () => {
    render(<CaseTabs order={DEFAULT_CASE_PREFS.tabOrder} viewEnabled={false} infoEnabled onTab={() => {}} open={null} />);
    const view = document.body.querySelector('[data-tab="view"]') as HTMLElement;
    expect(view.tagName).toBe('SPAN');
    expect(view.textContent).toBe('');
    expect(view.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Info', 'Refine']);
  });

  it('follows the order kept on this device (CC14), e.g. swapped sides', () => {
    const { container } = render(<CaseTabs order={['refine', 'info', 'view']} infoEnabled onTab={() => {}} open={null} />);
    expect(slots(container)).toEqual(['refine', 'info', 'view']);
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

describe('CaseViewCard (the View tab: back wall, cabinets, ceiling, tab sides)', () => {
  function card() {
    const onChange = vi.fn();
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    return onChange;
  }

  // VIEWCARD-1 (Ross 10-20): the header's Case menu chooses the view; the card no longer repeats it
  it('has no View radios: the header chooses whole cabinets, one cabinet or one shelf', () => {
    card();
    expect(screen.queryByRole('radio', { name: 'Whole cabinets' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'One cabinet' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'One shelf' })).toBeNull();
    expect(screen.queryByText('View', { selector: 'legend' })).toBeNull();
  });

  // WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the group is called Wall
  it('offers the wall colours: Cream (the default), Off-white, White, Seafoam and a custom colour', () => {
    const onChange = card();
    const group = screen.getByRole('group', { name: 'Wall' });
    const names = within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent?.trim());
    expect(names).toEqual(['Cream', 'Off-white', 'White', 'Seafoam', 'Custom']);
    expect(within(group).getByRole('radio', { name: 'Cream' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'White' }));
    expect(onChange).toHaveBeenCalledWith({ wall: 'white' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Seafoam' }));
    expect(onChange).toHaveBeenLastCalledWith({ wall: 'seafoam' });
  });

  it('a custom colour: the picker chooses it and picking one selects Custom; the saved choice shows checked', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={onChange} onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText('Custom wall colour'), { target: { value: '#336699' } });
    expect(onChange).toHaveBeenCalledWith({ wall: 'custom', wallCustom: '#336699' });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(onChange).toHaveBeenLastCalledWith({ wall: 'custom' });
    rerender(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, wall: 'custom', wallCustom: '#336699' }} onChange={onChange} onClose={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
    expect((screen.getByLabelText('Custom wall colour') as HTMLInputElement).value).toBe('#336699');
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

  it('MISFIT-CHIP-1: a "Doesn\'t fit (N)" entry opens the list of the figures that do not fit, whether or not the chip is hidden', () => {
    const onShowMisfits = vi.fn();
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} misfitCount={16} onShowMisfits={onShowMisfits} />);
    fireEvent.click(screen.getByRole('button', { name: "Doesn't fit (16)" }));
    expect(onShowMisfits).toHaveBeenCalledTimes(1);
  });

  it('MISFIT-CHIP-1: no entry when every figure fits', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} misfitCount={0} onShowMisfits={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /fit \(/ })).toBeNull();
    cleanup();
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /fit \(/ })).toBeNull();
  });

  // SIZE-BASIS-1 (Ross 10-18): see which sizes are guesses
  it('SIZE-BASIS-1: "Show estimated sizes" is off to begin with, and turning it on is a patch of the pref', () => {
    const onChange = card();
    const box = screen.getByRole('checkbox', { name: 'Show estimated sizes' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ showEstimated: true });
  });

  it('SIZE-BASIS-1: it shows on when the pref is on, and turning it off is a patch', () => {
    const onChange = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, showEstimated: true }} onChange={onChange} onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Show estimated sizes' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ showEstimated: false });
  });

  it.each([
    [22, '22 figures sized from estimates'],
    [1, '1 figure sized from an estimate'],
  ])('SIZE-BASIS-1: says how many figures are sized from estimates: %i', (count, line) => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={() => {}} onClose={() => {}} estimatedCount={count} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('SIZE-BASIS-1: says nothing of it when no figure is sized from an estimate (or the count is not known)', () => {
    const { rerender } = render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={() => {}} onClose={() => {}} estimatedCount={0} />);
    expect(screen.queryByText(/sized from/)).toBeNull();
    rerender(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/sized from/)).toBeNull();
  });

  it('CLEAR-1: the clearance above a figure is set here with the ceiling: inches, 0 to 2 in in quarter inches, 1 in to begin with', () => {
    const onChange = card();
    const input = screen.getByRole('spinbutton', { name: /clearance above a figure/i }) as HTMLInputElement;
    expect(input.value).toBe('1');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '2');
    expect(input).toHaveAttribute('step', '0.25');
    fireEvent.change(input, { target: { value: '0.25' } });
    expect(onChange).toHaveBeenCalledWith({ clearanceMm: 6.35 });
    fireEvent.change(input, { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ clearanceMm: 50.8 });
    onChange.mockClear();
    for (const bad of ['3', '-1', '']) fireEvent.change(input, { target: { value: bad } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CAM1: the swipe mode is not in the View card any more: it lives in the header, beside the display modes', () => {
    card();
    expect(screen.queryByText('Swipe')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Move the camera' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Pan the wall' })).toBeNull();
    // what stays: the back wall, the cabinets, the ceiling and the tab sides
    expect(screen.getAllByRole('radio', { name: /^IKEA|rack|KLINGSBO with/ }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('spinbutton', { name: /ceiling/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap tab sides' })).toBeInTheDocument();
  });

  it('CC5: the card fits its content above the pull-up tabs (NAV-FLOAT: no raised + among them) and scrolls its body, never running under the bar', () => {
    card();
    const sheet = document.querySelector('.bottom-sheet') as HTMLElement;
    expect(sheet.classList.contains('bottom-sheet--fit')).toBe(true);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.bottom-sheet--fit\s*\{[^}]*bottom:\s*calc\(32px \+ 4px\);[^}]*height:\s*auto;[^}]*max-height:\s*min\(85%, calc\(100% - 32px - 4px - 8px\)\);/);
    expect(CASE_TABS_HEIGHT_PX).toBe(32);
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
    expect(onChange).toHaveBeenCalledWith({ tabOrder: ['refine', 'info', 'view'] });
  });

  // NAV-FLOAT: the depth control is the floating Z, vertical only: the card offers no shape for it
  it('offers no "Depth control" choice any more', () => {
    card();
    expect(screen.queryByRole('group', { name: 'Depth control' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /rocker|slider/i })).toBeNull();
  });
});
