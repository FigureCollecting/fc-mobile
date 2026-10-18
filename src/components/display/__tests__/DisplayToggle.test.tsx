import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';
import type { CaseView, SwipeMode } from '../casePrefs';
import type { Density } from '../density';

const noop = () => {};

function mount(props: Partial<Parameters<typeof DisplayToggle>[0]> = {}) {
  const handlers = { onLayout: vi.fn(), onDensity: vi.fn(), onCaseView: vi.fn(), onLabels: vi.fn(), onSwipe: vi.fn() };
  const utils = renderWithProviders(
    <DisplayToggle layout="case" density="compact" caseView="wall" swipe="camera" labels={false} {...handlers} {...props} />,
  ) as ReturnType<typeof renderWithProviders> & { container: HTMLElement; unmount: () => void };
  return Object.assign(utils, handlers);
}

const caseButton = () => screen.getByRole('button', { name: /^Case/ });
const tilesButton = () => screen.getByRole('button', { name: /^Tiles/ });
const swipeButton = () => screen.getByRole('button', { name: /^Swipe/ });

describe('DisplayToggle: two mode buttons at fixed places, the nameplate toggle beside them (HDR a, SHEETS-FB1 4)', () => {
  it('the case\'s swipe button, the two mode buttons and the nameplate toggle, in that order; on the tiles the swipe button is gone and the rest hold their order (CAM1)', () => {
    const names = (layout: 'case' | 'rows') => {
      const { container, unmount } = mount({ layout });
      const out = Array.from(container.querySelectorAll('button')).map((b) => `${(b as Element).className.split(' ')[0]}:${(b as Element).getAttribute('aria-label')!.split(',')[0]}`);
      unmount();
      return out;
    };
    expect(names('case')).toEqual(['display-toggle__swipe:Swipe', 'display-toggle__btn:Case', 'display-toggle__btn:Tiles', 'display-toggle__cycle:Labels: off']);
    expect(names('rows')).toEqual(names('case').slice(1));
  });

  it('CAM1: the swipe button sits at the top right, just left of the two mode buttons, in their own row', () => {
    const { container } = mount({ layout: 'case' });
    const toggle = container.querySelector('.display-toggle') as HTMLElement;
    expect(swipeButton().parentElement).toBe(toggle);
    expect(swipeButton().nextElementSibling).toBe(container.querySelector('.display-toggle__group'));
  });

  it('CAM1: a tap opens a small menu of the two swipe modes, the current one ticked; picking one sets it and closes the menu', async () => {
    const user = userEvent.setup();
    const { onSwipe, onCaseView, onLayout } = mount({ layout: 'case', swipe: 'camera' });
    expect(swipeButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(swipeButton()).toHaveAttribute('aria-expanded', 'false');
    await user.click(swipeButton());
    expect(swipeButton()).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu', { name: 'Swipe modes' })).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Pan the wall', 'Move the camera']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    await user.click(items[0]!);
    expect(onSwipe).toHaveBeenCalledWith('pan');
    expect(screen.queryByRole('menu')).toBeNull();
    // never the case's views or the layout
    expect(onCaseView).not.toHaveBeenCalled();
    expect(onLayout).not.toHaveBeenCalled();
  });

  it('CAM1: the two modes are exclusive, the tick on whichever is current', () => {
    for (const swipe of ['pan', 'camera'] as const satisfies readonly SwipeMode[]) {
      const { unmount } = mount({ layout: 'case', swipe });
      fireEvent.click(swipeButton());
      const items = within(screen.getByRole('menu', { name: 'Swipe modes' })).getAllByRole('menuitemradio');
      expect(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent)).toEqual([swipe === 'pan' ? 'Pan the wall' : 'Move the camera']);
      unmount();
    }
  });

  it("CAM1: the button's icon shows the current mode, and its name says it", () => {
    const icon = (swipe: SwipeMode) => {
      const { unmount } = mount({ swipe });
      const out = { html: swipeButton().innerHTML, name: swipeButton().getAttribute('aria-label') };
      unmount();
      return out;
    };
    const [pan, camera] = [icon('pan'), icon('camera')];
    expect(pan.html).not.toBe(camera.html);
    expect([pan.name, camera.name]).toEqual(['Swipe, Pan the wall', 'Swipe, Move the camera']);
  });

  it('CAM1: one menu at a time: opening the swipe menu closes the case\'s, and closes again on Escape and on a tap outside it', async () => {
    const user = userEvent.setup();
    mount({ layout: 'case' });
    await user.click(caseButton());
    expect(screen.getByRole('menu', { name: 'Case views' })).toBeInTheDocument();
    await user.click(swipeButton());
    expect(screen.queryByRole('menu', { name: 'Case views' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Swipe modes' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(swipeButton());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(swipeButton());
    await user.click(swipeButton());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('CAM1: with no swipe handler (a caller that has no case) there is no swipe button', () => {
    const { container } = mount({ layout: 'case', onSwipe: undefined });
    expect(container.querySelector('.display-toggle__swipe')).toBeNull();
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
    renderWithProviders(<DisplayToggle layout="case" density="compact" caseView="wall" swipe="camera" onLayout={noop} onDensity={noop} onCaseView={noop} onLabels={onLabels} />);
    expect(screen.getByRole('button', { name: /labels: off/i })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /labels: off/i }));
    expect(onLabels).toHaveBeenCalledWith(true);
  });

  it('reflects labels on when active', () => {
    mount({ labels: true });
    expect(screen.getByRole('button', { name: /labels: on/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
