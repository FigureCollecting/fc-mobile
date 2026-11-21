import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';
import type { Density } from '../density';

const noop = () => {};

function mount(props: Partial<Parameters<typeof DisplayToggle>[0]> = {}) {
  const handlers = { onLayout: vi.fn(), onDensity: vi.fn(), onLabels: vi.fn() };
  const utils = renderWithProviders(
    <DisplayToggle layout="case" density="compact" labels={false} {...handlers} {...props} />,
  ) as ReturnType<typeof renderWithProviders> & { container: HTMLElement; unmount: () => void };
  return Object.assign(utils, handlers);
}

const caseButton = () => screen.getByRole('button', { name: /^Case/ });
const tilesButton = () => screen.getByRole('button', { name: /^Tiles/ });

describe('DisplayToggle: two mode buttons at fixed places, the nameplate toggle beside them (HDR a, SHEETS-FB1 4)', () => {
  it('NAV-2A2: the two mode buttons and the nameplate toggle, in that order, on the case and on the tiles alike: no swipe button', () => {
    const names = (layout: 'case' | 'rows') => {
      const { container, unmount } = mount({ layout });
      const out = Array.from(container.querySelectorAll('button')).map((b) => `${(b as Element).className.split(' ')[0]}:${(b as Element).getAttribute('aria-label')!.split(',')[0]}`);
      unmount();
      return out;
    };
    expect(names('case')).toEqual(['display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    expect(names('rows')).toEqual(names('case'));
  });

  it('NAV-2A2 (Ross 11-04): the old camera\'s props, handed by a caller that still has them, bring back no swipe button and no swipe menu', async () => {
    const user = userEvent.setup();
    const legacy = { swipe: 'pan', onSwipe: vi.fn(), freeCamera: false } as Record<string, unknown>;
    const { container } = mount({ layout: 'rows', ...legacy });
    expect(screen.queryByRole('button', { name: /^Swipe/ })).toBeNull();
    expect(container.querySelector('.display-toggle__swipe')).toBeNull();
    await user.click(tilesButton());
    expect(screen.getByRole('menu', { name: 'Tiles views' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Swipe modes' })).toBeNull();
    expect(screen.queryByText(/pan the wall|move the camera/i)).toBeNull();
  });

  it('NAV-SCOPE: the old case-view props, handed by a caller that still has them, bring back no Case views menu', async () => {
    const user = userEvent.setup();
    const legacy = { caseView: 'shelf', onCaseView: vi.fn() } as Record<string, unknown>;
    mount({ layout: 'case', ...legacy });
    expect(caseButton()).toHaveAttribute('aria-label', 'Case');
    await user.click(caseButton());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(legacy.onCaseView).not.toHaveBeenCalled();
  });

  it('the active mode is pressed; only the active Tiles offers a menu (NAV-SCOPE: the case has one view)', () => {
    const { unmount } = mount({ layout: 'case' });
    expect(caseButton()).toHaveAttribute('aria-pressed', 'true');
    expect(caseButton()).not.toHaveAttribute('aria-haspopup');
    expect(tilesButton()).toHaveAttribute('aria-pressed', 'false');
    expect(tilesButton()).not.toHaveAttribute('aria-haspopup');
    unmount();
    mount({ layout: 'rows' });
    expect(tilesButton()).toHaveAttribute('aria-pressed', 'true');
    expect(tilesButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(tilesButton()).toHaveAttribute('aria-expanded', 'false');
    expect(caseButton()).toHaveAttribute('aria-pressed', 'false');
    expect(caseButton()).not.toHaveAttribute('aria-haspopup');
  });

  it('a tap on the inactive mode switches to it and opens no menu', async () => {
    const user = userEvent.setup();
    const { onLayout, unmount } = mount({ layout: 'case' });
    await user.click(tilesButton());
    expect(onLayout).toHaveBeenCalledWith('rows');
    expect(screen.queryByRole('menu')).toBeNull();
    unmount();
    const rows = mount({ layout: 'rows' });
    await user.click(caseButton());
    expect(rows.onLayout).toHaveBeenCalledWith('case');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap on the inactive Case while the Tiles menu is open switches and closes the menu', async () => {
    const user = userEvent.setup();
    const { onLayout } = mount({ layout: 'rows' });
    await user.click(tilesButton());
    expect(screen.getByRole('menu', { name: 'Tiles views' })).toBeInTheDocument();
    await user.click(caseButton());
    expect(onLayout).toHaveBeenCalledWith('case');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap on the active Tiles opens its views (the densities), the current one ticked; picking one sets it', async () => {
    const user = userEvent.setup();
    const { onDensity } = mount({ layout: 'rows', density: 'gallery' });
    await user.click(tilesButton());
    expect(tilesButton()).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu', { name: 'Tiles views' })).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Comfortable', 'Compact', 'Gallery']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    await user.click(items[0]!);
    expect(onDensity).toHaveBeenCalledWith('comfortable');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the menu closes on a second tap of its button, on Escape, and on a tap outside it', async () => {
    const user = userEvent.setup();
    mount({ layout: 'rows' });
    await user.click(tilesButton());
    await user.click(tilesButton());
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(tilesButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(tilesButton());
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a tap inside the menu is not a tap outside it', async () => {
    const user = userEvent.setup();
    mount({ layout: 'rows' });
    await user.click(tilesButton());
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('the Case button is named Case with its wall icon; the Tiles button\'s icon and name show its density', () => {
    const icon = (props: { density?: Density; layout?: 'case' | 'rows' }) => {
      const { unmount } = mount(props);
      const out = { case: caseButton().innerHTML, tiles: tilesButton().innerHTML, caseName: caseButton().getAttribute('aria-label'), tilesName: tilesButton().getAttribute('aria-label') };
      unmount();
      return out;
    };
    const cases = (['case', 'rows'] as const).map((layout) => icon({ layout }));
    expect(cases.map((c) => c.caseName)).toEqual(['Case', 'Case']);
    expect(cases[0].case).toBe(cases[1].case);
    expect((cases[0].case.match(/<rect/g) ?? []).length).toBe(3);
    const tiles = (['comfortable', 'compact', 'gallery'] as const).map((density) => icon({ density, layout: 'rows' }));
    expect(tiles.map((t) => (t.tiles.match(/<rect/g) ?? []).length)).toEqual([1, 4, 9]);
    expect(tiles.map((t) => t.tilesName)).toEqual(['Tiles, Comfortable', 'Tiles, Compact', 'Tiles, Gallery']);
  });

  it('shows the nameplate labels toggle, off by default, and toggles it', async () => {
    const user = userEvent.setup();
    const onLabels = vi.fn();
    renderWithProviders(<DisplayToggle layout="case" density="compact" onLayout={noop} onDensity={noop} onLabels={onLabels} />);
    expect(screen.getByRole('button', { name: /labels: off/i })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /labels: off/i }));
    expect(onLabels).toHaveBeenCalledWith(true);
  });

  it('reflects labels on when active', () => {
    mount({ labels: true });
    expect(screen.getByRole('button', { name: /labels: on/i })).toHaveAttribute('aria-pressed', 'true');
  });

  // NAV-FLOAT (chal1 S7): the page hides the floating controls while a views menu is open, or the hat would lie over it
  it('tells the page while a views menu is open: on opening, then on each way it closes (a pick, Escape, a tap outside, going away)', async () => {
    const user = userEvent.setup();
    const onMenuOpen = vi.fn();
    const { unmount } = mount({ layout: 'case', onMenuOpen });
    expect(onMenuOpen).not.toHaveBeenCalledWith(true);
    await user.click(caseButton());
    expect(onMenuOpen).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('menuitemradio', { name: 'One shelf' }));
    expect(onMenuOpen).toHaveBeenLastCalledWith(false);
    await user.click(caseButton());
    expect(onMenuOpen).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    expect(onMenuOpen).toHaveBeenLastCalledWith(false);
    await user.click(caseButton());
    fireEvent.pointerDown(document.body);
    expect(onMenuOpen).toHaveBeenLastCalledWith(false);
    await user.click(caseButton());
    expect(onMenuOpen).toHaveBeenLastCalledWith(true);
    const calls = onMenuOpen.mock.calls.length;
    unmount();
    expect(onMenuOpen).toHaveBeenCalledTimes(calls + 1);
    expect(onMenuOpen).toHaveBeenLastCalledWith(false);
  });
});
