/**
 * LAYOUT-STABLE-1 (Ross 10-18, a first launch): the page lays the case out from a held basis on the real collection (its
 * pictures stream in for minutes), and says when they have all arrived; the dev fixtures, whose pictures never stream in,
 * are laid out as they were.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

const scenes = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('../../components/display/CabinetScene', () => ({
  CabinetScene: (props: Record<string, unknown>) => {
    scenes.props.push(props);
    return <div class="cabinet-scene" />;
  },
}));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { setFixtureMode } from '../../dev-fixtures/fixtures';

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
  scenes.props.length = 0;
  setFixtureMode(false);
});

const last = () => scenes.props[scenes.props.length - 1]!;

describe('Collection: the case is laid out from a held basis', () => {
  it('on the real collection: steadyLayout is on, and imagesComplete follows the pictures (true once the device has them all)', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'A' }, { title: 'B' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(scenes.props.length).toBeGreaterThan(0));
    expect(last().steadyLayout).toBe(true);
    // no picture to keep on the local data (MG-2): the sync ends at once, so the pictures are all in
    await waitFor(() => expect(last().imagesComplete).toBe(true));
  });

  it('on the dev fixtures: steadyLayout is off and the pictures are all in, so the figures are drawn at once as they were', async () => {
    setFixtureMode(true);
    renderWithProviders(<Collection />, { initialPath: '/?layout=case' });
    await waitFor(() => expect(scenes.props.length).toBeGreaterThan(0));
    expect(last().steadyLayout).toBe(false);
    expect(last().imagesComplete).toBe(true);
  });
});
