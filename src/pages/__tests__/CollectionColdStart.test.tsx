/**
 * STALE-PREFS-1 + OFFLINE-BANNER-1 (Ross 10-18, Fold8): a cold launch. The case draws from the local store at once
 * (what the last session kept) while the sync engine's first probe, with the radio still warming, fails and is
 * retried. Whatever the engine goes through, every frame the case draws is under the prefs this device keeps: never
 * the defaults first and the stored ones after a change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/preact';
import { Code, ConnectError } from '@connectrpc/connect';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { SyncEngine } from '../../sync/engine';
import { CASE_PREFS_KEY } from '../../components/display/casePrefs';

/** What this device keeps for the case: nothing here is a default. */
const STORED = { pattern: 'ikea-detolf', view: 'shelf', swipe: 'pan', ceilingMm: 2743.2 };

beforeEach(() => {
  localStorage.setItem(CASE_PREFS_KEY, JSON.stringify(STORED));
});

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
});

/** The prefs a case scene stands under, as it publishes them. */
const prefsOf = (scene: HTMLElement) => ({
  pattern: scene.dataset.pattern,
  view: scene.dataset.view,
  swipe: scene.dataset.swipe,
  ceilingMm: JSON.parse(scene.dataset.room!).ceilingMm as number,
});

describe('a cold launch: the case under the prefs this device keeps, whatever the first probe does', () => {
  it('every frame the case draws, from its first, stands under the stored prefs while the first probe fails and its retry reaches the server', async () => {
    // the last session's store, and a new engine on it: the launch
    const r = await localRig();
    await seedFigures(r, Array.from({ length: 6 }, (_, i) => ({ title: `Figure ${i}`, manufacturer: 'Good Smile' })));
    const launch = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5, coldRetry: true });
    localSession.value = { ...r.session, engine: launch };
    r.server.fault('status', { kind: 'throw', error: new ConnectError('radio warming', Code.Unavailable) });

    // every state of the scene, as the page publishes it (a mutation callback comes after each commit)
    const drawn: ReturnType<typeof prefsOf>[] = [];
    const watch = new MutationObserver(() => {
      const scene = document.querySelector<HTMLElement>('.cabinet-scene');
      if (scene) drawn.push(prefsOf(scene));
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true });

    renderWithProviders(<Collection />, { initialPath: '/' });
    await launch.trigger('start');
    expect(launch.state.value.reachability).toBe('connecting');
    await screen.findByRole('button', { name: 'Figure 0' });
    act(() => r.timers.fireAll());
    await waitFor(() => expect(launch.state.value.reachability).toBe('reachable'));
    await act(() => new Promise((res) => setTimeout(res, 50)));
    watch.disconnect();

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((p) => JSON.stringify(p) !== JSON.stringify(STORED))).toEqual([]);
    const scene = document.querySelector<HTMLElement>('.cabinet-scene')!;
    expect(prefsOf(scene)).toEqual(STORED);
  });

  it('the header and the View card show the stored prefs from the first render too', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Figure 0', manufacturer: 'Good Smile' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 0' });
    expect(screen.getByRole('button', { name: /^Case, One shelf/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
