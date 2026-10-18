// The offline banner (WK-16 F9): it shows when the browser says offline AND when the sync engine's
// reachability probe failed while the browser still says online (captive Wi-Fi, a phone that kept
// its radio flag), so it appears within the probe's bound, and it counts what waits in the outbox.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { Code, ConnectError } from '@connectrpc/connect';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { localRig } from '../../../local/__tests__/localHarness';
import { localSession } from '../../../local/session';
import { headOf } from '../../../sync/__tests__/engineSupport';
import { OfflineBanner } from '../OfflineBanner';
import { COLD_RETRY_MS } from '../../../sync/engine';

const setOnLine = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
};

afterEach(() => {
  act(() => setOnLine(true));
  localSession.value = undefined;
});

describe('OfflineBanner', () => {
  it('shows nothing while online and the server answers', async () => {
    const r = await localRig();
    await r.engine.trigger('manual');
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.offline-banner')).toBeNull();
  });

  it('shows nothing while online before the first probe has answered, nor without a session', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' }));
    expect(r.engine.state.value.reachability).toBe('unknown');
    const { container, unmount } = render(<OfflineBanner />);
    expect(container.querySelector('.offline-banner')).toBeNull();
    unmount();
    localSession.value = undefined;
    expect(render(<OfflineBanner />).container.querySelector('.offline-banner')).toBeNull();
  });

  it("shows when the reachability probe failed although the browser says online, with what waits", async () => {
    const r = await localRig();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' }));
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(1), 'note'), { note: 'b' }));
    await r.engine.trigger('manual');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach the server — showing what's on this device (2 pending changes)");
  });

  it('says offline when the browser does, with one pending change', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' }));
    render(<OfflineBanner />);
    act(() => setOnLine(false));
    expect(screen.getByRole('status')).toHaveTextContent("You're offline — showing what's on this device (1 pending change)");
  });

  // OFFLINE-BANNER-1 (Ross 10-18, Fold8): a cold launch's first probe may time out on a server that is fine
  describe('a cold launch', () => {
    const down = () => ({ kind: 'throw' as const, error: new ConnectError('down', Code.Unavailable) });
    const text = () => screen.queryByRole('status')?.textContent ?? null;

    it("says Connecting\u2026 after the first failed probe, not 'can't reach the server' or 'offline'; the retry that reaches it takes the banner away", async () => {
      const r = await localRig({ deps: { coldRetry: true } });
      r.server.fault('status', down());
      const { container } = render(<OfflineBanner />);
      // every text the banner takes, from the first pass to the retry's end
      const shown: (string | null)[] = [];
      const stop = r.engine.state.subscribe(() => queueMicrotask(() => shown.push(text())));
      await r.engine.trigger('start');
      expect(r.engine.state.value.reachability).toBe('connecting');
      expect(text()).toBe('Connecting\u2026');
      expect(container.querySelector('.offline-banner')).toHaveClass('offline-banner--connecting');
      act(() => r.timers.fireAll());
      await vi.waitFor(() => expect(r.engine.state.value.reachability).toBe('reachable'));
      expect(container.querySelector('.offline-banner')).toBeNull();
      await Promise.resolve();
      stop();
      expect(shown.filter((t) => t !== null && /reach|offline/i.test(t))).toEqual([]);
      expect(COLD_RETRY_MS).toBeLessThan(3_000);
    });

    it('a sustained failure still shows the banner: the retry fails too, and it reads "Can\'t reach the server"', async () => {
      const r = await localRig({ deps: { coldRetry: true } });
      r.server.fault('status', down(), down());
      render(<OfflineBanner />);
      await r.engine.trigger('start');
      expect(text()).toBe('Connecting\u2026');
      act(() => r.timers.fireAll());
      await vi.waitFor(() => expect(r.engine.state.value.reachability).toBe('unreachable'));
      expect(text()).toBe("Can't reach the server \u2014 showing what's on this device");
    });

    it('when the browser says offline, that is said, whatever the engine is doing', async () => {
      const r = await localRig({ deps: { coldRetry: true } });
      r.server.fault('status', down());
      render(<OfflineBanner />);
      await r.engine.trigger('start');
      expect(r.engine.state.value.reachability).toBe('connecting');
      act(() => setOnLine(false));
      expect(text()).toBe("You're offline \u2014 showing what's on this device");
    });

    it('while Connecting\u2026 what waits is still counted', async () => {
      const r = await localRig({ deps: { coldRetry: true } });
      await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' }));
      r.server.fault('status', down());
      render(<OfflineBanner />);
      await r.engine.trigger('manual');
      expect(text()).toBe('Connecting\u2026 (1 pending change)');
    });
  });
});
