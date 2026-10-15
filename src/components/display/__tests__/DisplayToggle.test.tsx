import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';
import type { CaseView } from '../casePrefs';
import type { Density } from '../density';

const noop = () => {};

function mount(props: Partial<Parameters<typeof DisplayToggle>[0]> = {}) {
  const handlers = { onLayout: vi.fn(), onDensity: vi.fn(), onCaseView: vi.fn(), onLabels: vi.fn() };
  const utils = renderWithProviders(
    <DisplayToggle layout="case" density="compact" caseView="wall" labels={false} {...handlers} {...props} />,
  );
  return { ...handlers, ...utils };
}

const caseButton = () => screen.getByRole('button', { name: /^Case/ });
const tilesButton = () => screen.getByRole('button', { name: /^Tiles/ });

describe('DisplayToggle: two mode buttons at fixed places, the nameplate toggle beside them (HDR a, SHEETS-FB1 4)', () => {
  it('exactly the two mode buttons and the nameplate toggle, in the same order, in either mode', () => {
    const names = (layout: 'case' | 'rows') => {
      const { container, unmount } = mount({ layout });
      const out = Array.from(container.querySelectorAll('button')).map((b) => `${b.className.split(' ')[0]}:${b.getAttribute('aria-label')!.split(',')[0]}`);
      unmount();
      return out;
    };
    expect(names('case')).toEqual(['display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    expect(names('rows')).toEqual(names('case'));
  });

  it('the active mode is pressed and offers its views; the other is not', () => {
    mount({ layout: 'case' });
    expect(caseButton()).toHaveAttribute('aria-pressed', 'true');
    expect(caseButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(tilesButton()).toHaveAttribute('aria-pressed', 'false');
    expect(tilesButton()).not.toHaveAttribute('aria-haspopup');
  });

  it('a tap on the inactive mode switches to it and opens no menu', async () => {
    const user = userEvent.setup();
    const { onLayout } = mount({ layout: 'case' });
    await user.click(tilesButton());
    expect(onLayout).toHaveBeenCalledWith('rows');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap on the active Case opens its views, the current one ticked; picking one sets it and closes the menu', async () => {
    const user = userEvent.setup();
    const { onCaseView, onLayout } = mount({ layout: 'case', caseView: 'cabinet' });
    await user.click(caseButton());
    expect(onLayout).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu', { name: 'Case views' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Whole cabinets', 'One cabinet', 'One shelf']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(caseButton()).toHaveAttribute('aria-expanded', 'true');
    await user.click(items[2]!);
    expect(onCaseView).toHaveBeenCalledWith('shelf');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap on the active Tiles opens its views (the densities), the current one ticked; picking one sets it', async () => {
    const user = userEvent.setup();
    const { onDensity } = mount({ layout: 'rows', density: 'gallery' });
    await user.click(tilesButton());
    const items = within(screen.getByRole('menu', { name: 'Tiles views' })).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Comfortable', 'Compact', 'Gallery']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    await user.click(items[0]!);
    expect(onDensity).toHaveBeenCalledWith('comfortable');
  });

  it('the menu closes on a second tap of its button, on Escape, and on a tap outside it', async () => {
    const user = userEvent.setup();
    mount({ layout: 'case' });
    await user.click(caseButton());
    await user.click(caseButton());
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(caseButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(caseButton());
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap inside the menu is not a tap outside it', async () => {
    const user = userEvent.setup();
    mount({ layout: 'case' });
    await user.click(caseButton());
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it("each mode button's icon shows that mode's current view, and its name says it", () => {
    const icon = (props: { caseView?: CaseView; density?: Density; layout?: 'case' | 'rows' }) => {
      const { unmount } = mount(props);
      const out = { case: caseButton().innerHTML, tiles: tilesButton().innerHTML, caseName: caseButton().getAttribute('aria-label'), tilesName: tilesButton().getAttribute('aria-label') };
      unmount();
      return out;
    };
    const views = (['wall', 'cabinet', 'shelf'] as const).map((caseView) => icon({ caseView }));
    expect(new Set(views.map((v) => v.case)).size).toBe(3);
    expect(views.map((v) => v.caseName)).toEqual(['Case, Whole cabinets', 'Case, One cabinet', 'Case, One shelf']);
    const tiles = (['comfortable', 'compact', 'gallery'] as const).map((density) => icon({ density, layout: 'rows' }));
    expect(tiles.map((t) => (t.tiles.match(/<rect/g) ?? []).length)).toEqual([1, 4, 9]);
    expect(tiles.map((t) => t.tilesName)).toEqual(['Tiles, Comfortable', 'Tiles, Compact', 'Tiles, Gallery']);
  });

  it('shows the nameplate labels toggle, off by default, and toggles it', async () => {
    const user = userEvent.setup();
    const onLabels = vi.fn();
    renderWithProviders(<DisplayToggle layout="case" density="compact" caseView="wall" onLayout={noop} onDensity={noop} onCaseView={noop} onLabels={onLabels} />);
    expect(screen.getByRole('button', { name: /labels: off/i })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /labels: off/i }));
    expect(onLabels).toHaveBeenCalledWith(true);
  });

  it('reflects labels on when active', () => {
    mount({ labels: true });
    expect(screen.getByRole('button', { name: /labels: on/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
