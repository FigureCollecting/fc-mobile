import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Fake PhotoSwipe capturing options + event handlers, so we can assert the
// dataSource and drive 'change' events without a real gesture engine.
const instances: FakePswp[] = [];
class FakePswp {
  options: any;
  handlers: Record<string, () => void> = {};
  currIndex: number;
  initialized = false;
  destroyed = false;
  constructor(options: any) {
    this.options = options;
    this.currIndex = options.index ?? 0;
    instances.push(this);
  }
  on(event: string, cb: () => void) {
    this.handlers[event] = cb;
  }
  init() {
    this.initialized = true;
  }
  destroy() {
    this.destroyed = true;
    this.handlers['destroy']?.();
  }
  swipeTo(i: number) {
    this.currIndex = i;
    this.handlers['change']?.();
  }
}

vi.mock('photoswipe', () => ({ default: FakePswp }));
vi.mock('photoswipe/style.css', () => ({}));

import { FigureViewer } from '../FigureViewer';
import { renderWithProviders, flushAll } from '../../../test/testUtils';
import { FIXTURE_FIGURES, FIXTURE_META } from '../../../dev-fixtures/fixtures';

beforeEach(() => {
  instances.length = 0;
});

describe('FigureViewer (Display D)', () => {
  it('opens photoswipe over the whole result set with native uncropped dimensions', async () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={2} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const pswp = instances[0];
    expect(pswp.initialized).toBe(true);
    expect(pswp.options.index).toBe(2);
    expect(pswp.options.dataSource).toHaveLength(FIXTURE_FIGURES.length);
    const first = pswp.options.dataSource[0];
    const meta = FIXTURE_META[FIXTURE_FIGURES[0]._id];
    if (first.src) {
      expect(first.width).toBe(meta.width);
      expect(first.height).toBe(meta.height);
    } else {
      // gitignored fixture images absent (CI): html fallback slide
      expect(first.html).toContain('No image');
    }
    expect(pswp.options.initialZoomLevel).toBe('fit');
  });

  it('shows the tapped figure data in the pull-up sheet', async () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1/7')).toBeInTheDocument();
    expect(screen.getByText('Good Smile Company')).toBeInTheDocument();
    expect(screen.getByText(/owned/i)).toBeInTheDocument();
  });

  it('follows swipes across the result set', async () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].swipeTo(3);
    await flushAll();
    expect(await screen.findByText('Madoka Kaname')).toBeInTheDocument();
    expect(screen.getByText('4 of 7')).toBeInTheDocument();
  });

  it('expands the sheet for origin and distributor details', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} />);
    expect(screen.queryByText('Original Character')).toBeNull();
    await user.click(screen.getByRole('button', { name: /expand details/i }));
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
  });

  it('reports close when photoswipe is dismissed', async () => {
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].destroy(); // user closed the gallery (pinch/vertical drag)
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
