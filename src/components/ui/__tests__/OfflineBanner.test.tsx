// The offline banner (WK-16 F9): it shows when the browser says offline AND when the sync engine's
// reachability probe failed while the browser still says online (captive Wi-Fi, a phone that kept
// its radio flag), so it appears within the probe's bound, and it counts what waits in the outbox.
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { Code, ConnectError } from '@connectrpc/connect';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { localRig } from '../../../local/__tests__/localHarness';
import { localSession } from '../../../local/session';
import { headOf } from '../../../sync/__tests__/engineSupport';
import { OfflineBanner } from '../OfflineBanner';

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
});
