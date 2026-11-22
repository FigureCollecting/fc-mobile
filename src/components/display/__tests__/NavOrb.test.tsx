import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { FloatingNav } from '../FloatingNav';
import { DEPTH_RAIL_PX, NAV_EDGE_PX, ORB_PX } from '../navTuning';
import { offerJog, useJogStore, type JogTarget, type TiltDrive } from '../../../stores/jog';
import { useTiltStore } from '../../../stores/tilt';
import * as source from '../../../sensors/relativeOrientation';

// NAV-LOGPOSE (handoff FINAL 11-17 section 6; plan U8): the Log-Pose orb, small and detached above the left Z rail,
// OFF every session. A tap turns the fine Look on and off; a 500 ms hold (or R, or the context menu) recenters. Hidden
// where no sensor gives a real sample; shown disabled, with the reason, where its permission was refused. The device is
// a stand-in here (relativeOrientation's probe and permission are mocked); the sampling has its own tests (useTiltLook).

vi.mock('../../../sensors/relativeOrientation', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../sensors/relativeOrientation')>();
  return { ...real, probeTilt: vi.fn(), askTilt: vi.fn(), openTilt: vi.fn(() => ({ kind: 'event', latest: () => null, stop: vi.fn() })) };
});
const probeTilt = vi.mocked(source.probeTilt);
const askTilt = vi.mocked(source.askTilt);
const openTilt = vi.mocked(source.openTilt);
vi.mock('../../../utils/haptics', () => ({ hapticLight: vi.fn() }));

const tiltDrive = () => ({ set: vi.fn((_y: number, _p: number) => true), fold: vi.fn<() => void>() }) satisfies TiltDrive;
const jogOf = (tilt?: TiltDrive): JogTarget => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn(), depth: { start: vi.fn(() => true), rate: vi.fn(), stop: vi.fn() }, tilt });
const offer = (target: JogTarget) => act(() => void offerJog(target));
const orb = () => document.querySelector<HTMLElement>('[data-nav="orb"]');
/** Let the probe's promise land. */
const flush = () => act(async () => {});

beforeEach(() => {
  useJogStore.setState({ target: null });
  useTiltStore.setState({ support: 'unknown', on: false });
  probeTilt.mockReset();
  askTilt.mockReset();
  openTilt.mockClear();
});
afterEach(() => cleanup());

describe('(a) no sensor: no orb, and the rest of the controls as ever', () => {
  it('the probe finds none: no orb (hidden, not a dead button); the hat and the Z rail are there', async () => {
    probeTilt.mockResolvedValue('none');
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    // while the probe runs it is not shown either
    expect(orb()).toBeNull();
    await flush();
    expect(orb()).toBeNull();
    expect(document.querySelector('[data-nav="hat"]')).not.toBeNull();
    expect(document.querySelector('[data-nav="depth"]')).not.toBeNull();
    expect(probeTilt).toHaveBeenCalledTimes(1);
  });

  it('a jog that offers no tilt: no orb and no probe', async () => {
    render(<FloatingNav />);
    offer(jogOf());
    await flush();
    expect(orb()).toBeNull();
    expect(probeTilt).not.toHaveBeenCalled();
  });

  it('probed once a session: shown again (a card closed, the case back) it is not probed again', async () => {
    probeTilt.mockResolvedValue('event');
    const { unmount } = render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    expect(orb()).not.toBeNull();
    unmount();
    render(<FloatingNav />);
    await flush();
    expect(orb()).not.toBeNull();
    expect(probeTilt).toHaveBeenCalledTimes(1);
  });
});

describe('the orb where a sensor is: OFF by default, a tap toggles, the state said in words', () => {
  it('a switch, "Tilt to look: off", unchecked; a tap: on, sampling; again: off, folded, no sampling', async () => {
    probeTilt.mockResolvedValue('event');
    const drive = tiltDrive();
    render(<FloatingNav />);
    offer(jogOf(drive));
    await flush();
    const o = orb()!;
    expect(o.getAttribute('role')).toBe('switch');
    expect(o.getAttribute('aria-checked')).toBe('false');
    expect(o.getAttribute('aria-label')).toBe('Tilt to look: off');
    expect(openTilt).not.toHaveBeenCalled();
    fireEvent.click(o);
    expect(orb()!.getAttribute('aria-checked')).toBe('true');
    expect(orb()!.getAttribute('aria-label')).toBe('Tilt to look: on');
    expect(openTilt).toHaveBeenCalledTimes(1);
    expect(openTilt.mock.calls[0][0]).toBe('event');
    const stop = openTilt.mock.results[0].value.stop as ReturnType<typeof vi.fn>;
    fireEvent.click(orb()!);
    expect(orb()!.getAttribute('aria-checked')).toBe('false');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(drive.fold).toHaveBeenCalledTimes(1);
  });

  it('sits above the Z rail, left-aligned on its centre, a 14 px gap between what is drawn; its target 48 px, drawn 34', async () => {
    probeTilt.mockResolvedValue('sensor');
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    const rule = css.split('}').find((r) => r.split('{')[0].trim() === '.nav-orb')!;
    expect(rule).toBeDefined();
    expect(rule).toContain(`calc(${ORB_PX.hit}px * var(--nav-k))`);
    expect(rule).toContain(`${NAV_EDGE_PX}px + ${(DEPTH_RAIL_PX.width - ORB_PX.hit) / 2}px * var(--nav-k)`);
    expect(rule).toContain(`calc(var(--nav-base) + ${DEPTH_RAIL_PX.height + ORB_PX.gap - (ORB_PX.hit - ORB_PX.size) / 2}px * var(--nav-k))`);
    expect(rule).toContain('pointer-events: auto');
    expect(rule).toContain('border-radius: 50%');
    expect(ORB_PX).toEqual({ size: 34, hit: 48, gap: 14 });
    // first in the left cluster's reading order, above the rail
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-nav]')).map((n) => n.dataset.nav)).toEqual(['orb', 'depth', 'hat']);
  });

  it('the needle follows the offset through the CSSOM (never a style attribute); off, it rests', async () => {
    probeTilt.mockResolvedValue('event');
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    expect(orb()!.innerHTML).not.toMatch(/style=/);
    expect(orb()!.querySelector('.nav-orb__needle')).not.toBeNull();
    // no gold, no vivid red: the needle's colours are the tuning's named muted ones
    expect(orb()!.querySelector('.nav-orb__on')).not.toBeNull();
  });
});

describe('(b) iOS: the permission asked inside the click, before any await; denied is disabled, explained, never ON', () => {
  it('the click calls askTilt synchronously; granted: ON on deviceorientation', async () => {
    probeTilt.mockResolvedValue('ask');
    let settle: (ok: boolean) => void = () => {};
    askTilt.mockImplementation(() => new Promise<boolean>((r) => (settle = r)));
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    expect(orb()!.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(orb()!);
    // asked within the click's own task: nothing awaited first
    expect(askTilt).toHaveBeenCalledTimes(1);
    expect(orb()!.getAttribute('aria-checked')).toBe('false');
    await act(async () => settle(true));
    expect(orb()!.getAttribute('aria-checked')).toBe('true');
    expect(openTilt.mock.calls[0][0]).toBe('event');
  });

  it('denied: disabled, "isn\'t available", with the reason; a tap does nothing and never turns it ON', async () => {
    probeTilt.mockResolvedValue('ask');
    askTilt.mockResolvedValue(false);
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    fireEvent.click(orb()!);
    await flush();
    const o = orb()!;
    expect(o.getAttribute('aria-disabled')).toBe('true');
    expect(o.getAttribute('aria-checked')).toBe('false');
    expect(o.getAttribute('aria-label')).toBe("Tilt to look isn't available on this device");
    expect(o.getAttribute('title')).toMatch(/motion/i);
    fireEvent.click(o);
    await flush();
    expect(askTilt).toHaveBeenCalledTimes(1);
    expect(orb()!.getAttribute('aria-checked')).toBe('false');
    expect(openTilt).not.toHaveBeenCalled();
  });

  it('askTilt with nothing to ask (null): turned ON on deviceorientation', async () => {
    probeTilt.mockResolvedValue('ask');
    askTilt.mockReturnValue(null);
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    fireEvent.click(orb()!);
    expect(orb()!.getAttribute('aria-checked')).toBe('true');
  });

  it('ON but no real sample within 1 s (sensor gone): back OFF, disabled and explained', async () => {
    probeTilt.mockResolvedValue('event');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<FloatingNav />);
      offer(jogOf(tiltDrive()));
      await flush();
      fireEvent.click(orb()!);
      await act(async () => {
        vi.advanceTimersByTime(source.TILT.firstSampleMs);
      });
      expect(orb()!.getAttribute('aria-checked')).toBe('false');
      expect(orb()!.getAttribute('aria-disabled')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('(d) Recenter: a 500 ms hold, R, or the context menu; it folds and stays ON', () => {
  const onOrb = async () => {
    probeTilt.mockResolvedValue('event');
    const drive = tiltDrive();
    render(<FloatingNav />);
    offer(jogOf(drive));
    await flush();
    fireEvent.click(orb()!);
    return drive;
  };

  it('held 500 ms: folds; the click that ends the hold does not turn it OFF', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const drive = await onOrb();
      fireEvent.pointerDown(orb()!, { pointerId: 1 });
      act(() => void vi.advanceTimersByTime(499));
      expect(drive.fold).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1));
      expect(drive.fold).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(orb()!, { pointerId: 1 });
      fireEvent.click(orb()!);
      expect(orb()!.getAttribute('aria-checked')).toBe('true');
      // a short press after: an ordinary tap again
      fireEvent.pointerDown(orb()!, { pointerId: 1 });
      act(() => void vi.advanceTimersByTime(100));
      fireEvent.pointerUp(orb()!, { pointerId: 1 });
      fireEvent.click(orb()!);
      expect(orb()!.getAttribute('aria-checked')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a hold that leaves early (cancelled) recenters nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const drive = await onOrb();
      fireEvent.pointerDown(orb()!, { pointerId: 1 });
      fireEvent.pointerCancel(orb()!, { pointerId: 1 });
      act(() => void vi.advanceTimersByTime(600));
      expect(drive.fold).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('R recenters; the context menu (a mouse\'s right click) recenters and opens no menu', async () => {
    const drive = await onOrb();
    fireEvent.keyDown(orb()!, { key: 'r' });
    expect(drive.fold).toHaveBeenCalledTimes(1);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    orb()!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(drive.fold).toHaveBeenCalledTimes(2);
    expect(orb()!.getAttribute('aria-keyshortcuts')).toBe('R');
  });

  it('OFF: a hold, R and the menu recenter nothing (there is nothing to recenter)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      probeTilt.mockResolvedValue('event');
      const drive = tiltDrive();
      render(<FloatingNav />);
      offer(jogOf(drive));
      await flush();
      fireEvent.keyDown(orb()!, { key: 'r' });
      fireEvent.pointerDown(orb()!, { pointerId: 1 });
      act(() => void vi.advanceTimersByTime(600));
      fireEvent.pointerUp(orb()!, { pointerId: 1 });
      expect(drive.fold).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('(h) OFF every session', () => {
  it('turned ON, nothing is stored: a new session (the store fresh) starts OFF', async () => {
    probeTilt.mockResolvedValue('event');
    const stored = { local: localStorage.length, session: sessionStorage.length };
    render(<FloatingNav />);
    offer(jogOf(tiltDrive()));
    await flush();
    fireEvent.click(orb()!);
    expect(orb()!.getAttribute('aria-checked')).toBe('true');
    expect({ local: localStorage.length, session: sessionStorage.length }).toEqual(stored);
    vi.resetModules();
    const fresh = await import('../../../stores/tilt');
    expect(fresh.useTiltStore).not.toBe(useTiltStore);
    expect(fresh.useTiltStore.getState()).toEqual({ support: 'unknown', on: false });
  });

  it('a card over the case (the controls hidden) keeps it ON but stops the sampling; back, it samples again', async () => {
    probeTilt.mockResolvedValue('event');
    const drive = tiltDrive();
    const { rerender } = render(<FloatingNav />);
    offer(jogOf(drive));
    await flush();
    fireEvent.click(orb()!);
    const stop = openTilt.mock.results[0].value.stop as ReturnType<typeof vi.fn>;
    rerender(<FloatingNav hidden />);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(drive.fold).toHaveBeenCalledTimes(1);
    expect(useTiltStore.getState().on).toBe(true);
    rerender(<FloatingNav />);
    expect(orb()!.getAttribute('aria-checked')).toBe('true');
    expect(openTilt).toHaveBeenCalledTimes(2);
  });
});
