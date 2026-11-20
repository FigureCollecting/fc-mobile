/**
 * NAV-SCOPE (nav U2, Ross 11-18): one continuous view, from the collection page. Go to from the tiles lands the case at the
 * figure's shelf framing without storing a view (the forced view:'shelf' is gone), a stored view opens the wall framing, and
 * the header's Case button opens no views menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));
// Go to's framing, as the scene asked for it: read, never worked out a second way
vi.mock('../../components/display/caseGoTo', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/display/caseGoTo')>();
  return { ...real, goToFigure: vi.fn(real.goToFigure) };
});

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures, type SeedFigure } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { CASE_PREFS_KEY } from '../../components/display/casePrefs';
import { goToFigure, type GoToFraming } from '../../components/display/caseGoTo';

const makeFigure = (id: string): SeedFigure => ({ title: `Figure ${id}`, manufacturer: 'Good Smile' });
const scene = () => document.querySelector('.cabinet-scene') as HTMLElement | null;
const pose = () => {
  const c = JSON.parse(scene()!.dataset.camera!) as { x: number; y: number; z: number; yaw: number; pitch: number };
  return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };
};
const n = (v: number) => Number(v.toFixed(6));

/** Fake the Collection page's own measured width (useElementWidth reads clientWidth): 700 px puts the card beside the case. */
function mockPageWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('page-collection') ? width : 0;
  });
}

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
  vi.restoreAllMocks();
});

describe('NAV-SCOPE from the collection page', () => {
  it('(b) Go to from the tiles: the case stands at the figure\'s shelf framing, and no view is stored', async () => {
    mockPageWidth(700);
    const r = await localRig();
    await seedFigures(r, [makeFigure('1'), makeFigure('2'), makeFigure('3')]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 2' });
    await user.click(screen.getByRole('button', { name: 'Figure 2' }));
    await waitFor(() => expect(container.querySelector('.detail-pane')).not.toBeNull());
    vi.mocked(goToFigure).mockClear();
    await user.click(screen.getByRole('button', { name: 'Go to' }));
    await waitFor(() => expect(vi.mocked(goToFigure)).toHaveBeenCalled());
    const results = vi.mocked(goToFigure).mock.results;
    const target = results[results.length - 1].value as GoToFraming;
    const c = target.framing.camera;
    await waitFor(() => expect(pose()).toEqual({ x: n(c.x), y: n(c.y), z: n(c.z), yaw: n(c.yaw ?? 0), pitch: n(c.pitch) }));
    const stored = JSON.parse(localStorage.getItem(CASE_PREFS_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored).not.toHaveProperty('view');
    expect(scene()!.dataset.view).toBeUndefined();
  });

  it('(c) a stored view:\'shelf\' opens the wall framing: the camera a device with nothing stored opens at', async () => {
    const r = await localRig();
    await seedFigures(r, [makeFigure('1'), makeFigure('2')]);
    const first = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    const wall = pose();
    first.unmount();
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view: 'shelf' }));
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(pose()).toEqual(wall);
    expect(scene()!.dataset.view).toBeUndefined();
  });

  it('(a) the header\'s Case button, tapped while the case shows, opens no menu and keeps the case', async () => {
    const r = await localRig();
    await seedFigures(r, [makeFigure('1')]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    const caseButton = screen.getByRole('button', { name: /^Case/ });
    expect(caseButton).toHaveAttribute('aria-pressed', 'true');
    expect(caseButton).not.toHaveAttribute('aria-haspopup');
    await user.click(caseButton);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitemradio', { name: 'One shelf' })).toBeNull();
    expect(scene()).not.toBeNull();
  });
});
