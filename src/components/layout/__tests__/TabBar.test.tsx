import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { act, fireEvent, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';
import { useChromeStore } from '../../../stores/chrome';
import { offerJog, useJogStore, type JogTarget } from '../../../stores/jog';

beforeEach(() => useChromeStore.setState({ hidden: false }));

describe('TabBar', () => {
  it('renders the 4 tab slots and the docked Add action', () => {
    renderWithProviders(<TabBar />);
    for (const label of ['Collection', 'Search', 'Stats', 'Profile']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /add figures/i })).toBeInTheDocument();
  });

  it('navigates when a tab is pressed', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(currentPath()).toBe('/stats');
  });

  it('opens the Add sheet with the import and the barcode lookup', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    // MFC Sync has no backend (src/config/features.ts) and is off by default.
    expect(screen.queryByText(/sync from mfc/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    await user.click(screen.getByText(/look up a barcode/i));
    expect(currentPath()).toBe('/discover');
  });

  it('carries no notification badge: notifications have no backend', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('slides away when chrome is hidden', () => {
    useChromeStore.setState({ hidden: true });
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.tab-bar--hidden')).not.toBeNull();
  });
});

// NAV-JOG (Ross 10-28): where a Free camera case offers a jog, the bottom-centre button is it: press, hold and drag moves
// the camera the way the thumb goes, faster the farther (the scene's jogStep), and the lift stops it; a quick tap opens
// the menu (the Add sheet) and its close is the jog again. Nothing offered, the button is today's to the byte.
describe('TabBar: the jog (NAV-JOG)', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const offered = () => {
    const t: JogTarget = { start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() };
    act(() => {
      offerJog(t);
    });
    return t;
  };
  const jogButton = () => document.querySelector('.tab-bar__add') as HTMLElement;
  const down = (x: number, y: number, id = 1) => fireEvent.pointerDown(jogButton(), { pointerId: id, clientX: x, clientY: y, button: 0 });
  const move = (x: number, y: number, id = 1) => fireEvent.pointerMove(jogButton(), { pointerId: id, clientX: x, clientY: y });
  const lift = (x: number, y: number, id = 1) => {
    fireEvent.pointerUp(jogButton(), { pointerId: id, clientX: x, clientY: y });
    fireEvent.click(jogButton());
  };

  beforeEach(() => useJogStore.setState({ target: null }));

  it('nothing offered: the bar and its Add button are today\'s DOM, to the byte (hashed from fe967a7..4bedd00)', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(hash(container.querySelector('.tab-bar')!.outerHTML)).toBe('4e9b61312f46cbbc');
    expect(jogButton().hasAttribute('data-jog')).toBe(false);
  });

  it('offered: the button is the jog, named for both; withdrawn, it is the Add button again', () => {
    const { container } = renderWithProviders(<TabBar />);
    const before = container.querySelector('.tab-bar')!.outerHTML;
    let withdraw = () => {};
    act(() => {
      withdraw = offerJog({ start: () => true, aim: () => {}, stop: () => {} });
    });
    expect(jogButton().dataset.jog).toBe('');
    expect(jogButton().classList.contains('tab-bar__add--jog')).toBe(true);
    expect(screen.getByRole('button', { name: /move the camera/i })).toBe(jogButton());
    expect(screen.getByRole('button', { name: /add figures/i })).toBe(jogButton());
    expect(jogButton().querySelector('.tab-bar__jog-knob')).not.toBeNull();
    act(() => withdraw());
    expect(container.querySelector('.tab-bar')!.outerHTML).toBe(before);
  });

  it('press, hold and drag: the jog starts once past 8 px, aims at the thumb\'s offset each move, stops on the lift; no menu', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(204, 497);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.aim).not.toHaveBeenCalled();
    move(230, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).toHaveBeenLastCalledWith(30, 0);
    expect(jogButton().dataset.jogging).toBe('');
    move(200, 440);
    expect(t.aim).toHaveBeenLastCalledWith(0, -60);
    expect(t.start).toHaveBeenCalledTimes(1);
    // the knob shows where the thumb holds it, never past the button's reach
    expect((jogButton().querySelector('.tab-bar__jog-knob') as HTMLElement).style.transform).toBe('translate(0px, -16px)');
    lift(200, 440);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    expect((jogButton().querySelector('.tab-bar__jog-knob') as HTMLElement).style.transform).toBe('');
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
    // another finger's moves and lifts are not the jog's
    down(200, 500, 1);
    move(260, 500, 2);
    fireEvent.pointerUp(jogButton(), { pointerId: 2, clientX: 260, clientY: 500 });
    expect(t.start).toHaveBeenCalledTimes(1);
    lift(200, 500, 1);
  });

  it('a quick tap opens the menu (the Add sheet); a tap that wobbles inside 8 px is still a tap', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(203, 504);
    lift(203, 504);
    expect(t.start).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
  });

  it('a drag the scene refuses (a finger already on it) neither aims nor opens the menu', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    (t.start as ReturnType<typeof vi.fn>).mockReturnValue(false);
    down(200, 500);
    move(240, 500);
    move(260, 500);
    lift(260, 500);
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.aim).not.toHaveBeenCalled();
    expect(t.stop).not.toHaveBeenCalled();
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
  });

  it('a pointercancel stops the jog where it got to; the next tap is a tap again', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(200, 560);
    fireEvent.pointerCancel(jogButton(), { pointerId: 1, clientX: 200, clientY: 560 });
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(jogButton().hasAttribute('data-jogging')).toBe(false);
    down(200, 500);
    lift(200, 500);
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
  });

  it('the jog the drag began with is the one it stops, though the scene withdrew it meanwhile', () => {
    renderWithProviders(<TabBar />);
    const t = offered();
    down(200, 500);
    move(240, 500);
    act(() => useJogStore.setState({ target: null }));
    move(250, 500);
    expect(t.aim).toHaveBeenLastCalledWith(50, 0);
    expect(jogButton().hasAttribute('data-jog')).toBe(false);
    fireEvent.pointerUp(jogButton(), { pointerId: 1, clientX: 250, clientY: 500 });
    expect(t.stop).toHaveBeenCalledTimes(1);
  });
});
