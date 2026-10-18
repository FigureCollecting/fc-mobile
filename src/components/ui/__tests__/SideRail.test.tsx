import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { RAIL_INSET_PX, RAIL_ITEM_HEIGHT_PX, RAIL_WIDTH_PX, SideRail, railHeightPx } from '../SideRail';

// SIDE-RAIL-1 (Ross 10-17/10-18): frequent selections live on a RIGHT-side rail, not the top (an Android banner there
// steals the tap), about 24 px in from the edge so the back-swipe never fires, as stacked icon + short label buttons,
// never sideways text.

const Icon = ({ n }: { n: string }) => <svg data-icon={n} width="20" height="20" />;
const ITEMS = [
  { id: 'a', label: 'Details', icon: <Icon n="a" /> },
  { id: 'b', label: 'Copies', icon: <Icon n="b" /> },
];

describe('SideRail', () => {
  it('is a labelled navigation of buttons, each an icon over its short label', () => {
    render(<SideRail label="Figure sections" items={ITEMS} onSelect={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Figure sections' });
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Details', 'Copies']);
    for (const b of buttons) {
      // stacked: the icon first, then the label, in one column
      expect(b.firstElementChild?.tagName.toLowerCase()).toBe('svg');
      expect(b.lastElementChild?.tagName.toLowerCase()).toBe('span');
    }
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('tells the section chosen to its caller, and which one is current', () => {
    const onSelect = vi.fn();
    render(<SideRail label="Sections" items={ITEMS} current="b" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Copies' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Details' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('a disabled section cannot be chosen', async () => {
    const onSelect = vi.fn();
    render(<SideRail label="Sections" items={[{ ...ITEMS[0]!, disabled: true }]} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Details' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stacks icon over label (a column), never sideways text, and keeps the label at a readable size', () => {
    render(<SideRail label="Sections" items={ITEMS} onSelect={() => {}} />);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    const item = css.match(/\.side-rail__item\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(item).toMatch(/flex-direction:\s*column/);
    expect(css).not.toMatch(/writing-mode/);
    expect(css).toMatch(/\.side-rail__label\s*\{[^}]*font-size:\s*var\(--font-xs\)/);
  });

  it('is 24 px in from the screen edge (the back-swipe never fires) and a fixed width, the room the page leaves beside it', () => {
    expect(RAIL_INSET_PX).toBe(24);
    expect(RAIL_WIDTH_PX).toBeGreaterThanOrEqual(48);
    render(<SideRail label="Sections" items={ITEMS} onSelect={() => {}} />);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(new RegExp(`\\.side-rail\\s*\\{[^}]*width:\\s*${RAIL_WIDTH_PX}px`));
  });

  it('railHeightPx: its items and the gaps between them', () => {
    expect(railHeightPx(0)).toBe(0);
    expect(railHeightPx(1)).toBe(RAIL_ITEM_HEIGHT_PX);
    expect(railHeightPx(3)).toBeGreaterThan(3 * RAIL_ITEM_HEIGHT_PX);
  });
});
