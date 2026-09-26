import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFillHeight } from '../useFillHeight';
import { useScrollParent } from '../useScrollParent';

function Probe({ layoutKey = 'a' }: { layoutKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollParent = useScrollParent(ref);
  const fill = useFillHeight(ref, scrollParent, layoutKey);
  return <div ref={ref} class="probe" data-testid="probe" data-fill={fill === null ? 'none' : String(fill)} />;
}

/** app-content (padding-bottom 56) > wrapper (padding 16 + border 2) > probe. */
function Page({ layoutKey }: { layoutKey?: string }) {
  return (
    <main class="app-content" style={{ paddingBottom: '56px' }}>
      <div style={{ paddingBottom: '16px', borderBottom: '2px solid black' }}>
        <Probe layoutKey={layoutKey} />
      </div>
    </main>
  );
}

const geometry = { clientHeight: 800, scrollTop: 0, probeTop: 150 };

function mockGeometry() {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? geometry.clientHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? geometry.scrollTop : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('probe') ? geometry.probeTop - geometry.scrollTop : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

const fill = () => screen.getByTestId('probe').dataset.fill;

afterEach(() => {
  vi.unstubAllGlobals();
  geometry.clientHeight = 800;
  geometry.scrollTop = 0;
  geometry.probeTop = 150;
});

describe('useFillHeight', () => {
  it('is the room left above the tab bar padding, below the element top, less ancestor bottom insets', () => {
    mockGeometry();
    render(<Page />);
    // 800 - 56 (container padding) - 150 (element top) - 18 (wrapper padding + border)
    expect(fill()).toBe('576');
  });

  it('measures the element top in scroll-content space, so scrolling does not change it', () => {
    geometry.scrollTop = 100;
    mockGeometry();
    render(<Page />);
    expect(fill()).toBe('576');
  });

  it('never goes below zero', () => {
    geometry.probeTop = 2000;
    mockGeometry();
    render(<Page />);
    expect(fill()).toBe('0');
  });

  it('is null without a scroll container to fill', () => {
    mockGeometry();
    render(<Probe />);
    expect(fill()).toBe('none');
  });

  it('re-measures when the layout key changes', () => {
    mockGeometry();
    const { rerender } = render(<Page layoutKey="a" />);
    geometry.probeTop = 200;
    rerender(<Page layoutKey="b" />);
    expect(fill()).toBe('526');
  });

  it('re-measures when the scroll container resizes (fold or rotate)', () => {
    let resized: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    mockGeometry();
    const { unmount } = render(<Page />);
    expect(observe).toHaveBeenCalledWith(document.querySelector('.app-content'));
    geometry.clientHeight = 600;
    act(() => resized());
    expect(fill()).toBe('376');
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('falls back to window resize events without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const removeListener = vi.spyOn(window, 'removeEventListener');
    mockGeometry();
    const { unmount } = render(<Page />);
    geometry.clientHeight = 700;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(fill()).toBe('476');
    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
