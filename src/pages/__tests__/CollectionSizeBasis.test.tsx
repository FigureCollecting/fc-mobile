/**
 * SIZE-BASIS-1 (Ross 10-18): the View card says how many of the case's figures are sized from an estimate, from the cards the
 * device holds. A figure with its height and width from the listing is not one; a goods item the case leaves off its shelves
 * is not counted (it is not in the case).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

import { ProductKind } from '@figurecollecting/fc-api-contract';
import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures, type SeedFigure } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
});

async function openViewCard(figs: SeedFigure[]) {
  const user = userEvent.setup();
  const r = await localRig();
  await seedFigures(r, figs);
  renderWithProviders(<Collection />, { initialPath: '/' });
  await screen.findByRole('button', { name: figs[0]!.title });
  await user.click(screen.getByRole('button', { name: 'View' }));
  await screen.findByRole('checkbox', { name: 'Show estimated sizes' });
  return user;
}

describe('the View card counts the figures sized from estimates', () => {
  it('counts those whose height or width is not the card\'s, and not the ones with both', async () => {
    await openViewCard([
      { title: 'Listed', size: { heightMm: 200, widthMm: 120 } },
      { title: 'Height only', size: { heightMm: 200 } },
      { title: 'By scale', scale: '1/7' },
      { title: 'Nothing' },
    ]);
    expect(await screen.findByText('3 figures sized from estimates')).toBeInTheDocument();
  });

  it('says nothing when every figure in the case has its height and width from the card', async () => {
    await openViewCard([{ title: 'Listed one', size: { heightMm: 200, widthMm: 120 } }, { title: 'Listed two', size: { heightMm: 210, widthMm: 130, depthMm: 90 } }]);
    expect(screen.queryByText(/sized from/)).toBeNull();
  });

  it('does not count a figure the case leaves off its shelves', async () => {
    await openViewCard([
      { title: 'Figure', size: { heightMm: 200, widthMm: 120 } },
      { title: 'Towel', kind: ProductKind.GOODS },
    ]);
    await waitFor(() => expect(screen.getByText('1 goods not shelved')).toBeInTheDocument());
    expect(screen.queryByText(/sized from/)).toBeNull();
  });

  it('turning the outline on is kept on the device and reaches the case', async () => {
    const user = await openViewCard([{ title: 'Nothing' }]);
    await user.click(screen.getByRole('checkbox', { name: 'Show estimated sizes' }));
    expect(JSON.parse(localStorage.getItem('fc-case-prefs')!)).toMatchObject({ showEstimated: true });
    await waitFor(() => expect(document.querySelector('.cabinet-scene')!.getAttribute('data-show-estimated')).toBe('1'));
    expect(document.querySelector<HTMLElement>('button.cab-figure')!.dataset.sizeEstimated).toBe('both');
  });
});
