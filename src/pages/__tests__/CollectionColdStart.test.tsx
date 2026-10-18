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
import { create } from '@bufbuild/protobuf';
import { ProductCardSchema } from '@figurecollecting/fc-api-contract';
import { headOf, seedCopies } from '../../sync/__tests__/engineSupport';
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

  // STALE-CONTENT (Ross 10-18: "I had to change the pan mode before it redrew and honored the current settings", after a cold
  // launch that began "offline"). The launch draws what the device has (figures whose cards have not been fetched stand at the
  // default size); when the server is reached and the cards arrive, the case must redraw with them, with no pref change.
  it('the cards that arrive once the server is reached redraw the case at once: no pref change is needed to size its figures', async () => {
    const r = await localRig();
    // the last session left the copies but no cards (they are fetched after the first probe)
    seedCopies(r.server, 3);
    await r.engine.trigger('start');
    expect(await r.store.listProducts()).toEqual([]);
    const launch = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5, coldRetry: true });
    localSession.value = { ...r.session, engine: launch };
    r.server.fault('status', { kind: 'throw', error: new ConnectError('radio warming', Code.Unavailable) });
    renderWithProviders(<Collection />, { initialPath: '/' });
    await launch.trigger('start');
    expect(launch.state.value.reachability).toBe('connecting');
    const heights = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button.cab-figure')).map((b) => { const w = JSON.parse(b.dataset.world!) as { y0: number; y1: number }; return Math.round(w.y1 - w.y0); });
    await waitFor(() => expect(heights().length).toBeGreaterThan(0));
    const before = heights();
    // the cards arrive, 330 mm tall
    for (let i = 0; i < 3; i++) {
      r.server.products.set(headOf(i), create(ProductCardSchema, { headId: headOf(i), requestedAs: [{ ref: { case: 'headId', value: headOf(i) } }], title: { value: `Figure ${i}` }, heightMm: 330, widthMm: 120 }));
    }
    act(() => r.timers.fireAll());
    await waitFor(() => expect(launch.state.value.reachability).toBe('reachable'));
    await waitFor(() => expect(heights().every((h) => h === 330)).toBe(true), { timeout: 3000 });
    expect(before.every((h) => h !== 330)).toBe(true);
    // and the prefs are the stored ones throughout
    expect(prefsOf(document.body.querySelector<HTMLElement>('.cabinet-scene')!)).toEqual(STORED);
  });
});
