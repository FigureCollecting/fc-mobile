import { afterEach, describe, expect, it, vi } from 'vitest';
import { render as paint } from 'preact';
import { useRef } from 'preact/hooks';
import { useElementWidth } from '../useElementWidth';

// STALE-CONTENT (Ross 10-18, a cold launch): the page's width was measured after its first paint (an effect), so the first
// frame laid out at the 360 px fallback (the single pane, on the Fold's open screen) and was drawn again a frame later.
// Measured in a layout effect, the first frame that reaches the screen is already at the real width.

function Probe({ fallback }: { fallback?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, fallback);
  return (
    <div ref={ref} data-width={String(width)}>
      {width}
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useElementWidth', () => {
  it('has measured the element before the first paint: no frame at the fallback width reaches the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(870);
    const host = document.createElement('div');
    document.body.appendChild(host);
    // not the testing library's render, which flushes the effects that run after paint: the layout effects come with the commit,
    // and the re-render they ask for before the next frame is a microtask away
    paint(<Probe />, host);
    await Promise.resolve();
    expect((host.firstElementChild as HTMLElement).dataset.width).toBe('870');
  });

  it('stands at the fallback only where the element has no width yet (jsdom, a hidden element)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
    const host = document.createElement('div');
    document.body.appendChild(host);
    paint(<Probe fallback={412} />, host);
    await Promise.resolve();
    expect((host.firstElementChild as HTMLElement).dataset.width).toBe('412');
  });

  it('follows the element when it resizes (a ResizeObserver, or the window\'s resize where there is none)', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let width = 443;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const host = document.createElement('div');
    document.body.appendChild(host);
    paint(<Probe />, host);
    await Promise.resolve();
    expect((host.firstElementChild as HTMLElement).dataset.width).toBe('443');
    width = 870;
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 0));
    expect((host.firstElementChild as HTMLElement).dataset.width).toBe('870');
    vi.unstubAllGlobals();
  });

  it('with a ResizeObserver it follows what that reports', async () => {
    const watchers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(function (this: unknown, cb: () => void) {
        watchers.push(cb);
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    let width = 443;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const host = document.createElement('div');
    document.body.appendChild(host);
    paint(<Probe />, host);
    await Promise.resolve();
    width = 658;
    watchers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect((host.firstElementChild as HTMLElement).dataset.width).toBe('658');
    vi.unstubAllGlobals();
  });
});
