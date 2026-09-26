/**
 * Interaction tests for the rebuilt Collection page: display A/B toggle,
 * tap-to-view, applied chips, and the filter sheet round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigures: vi.fn() };
});

const instances: any[] = [];
class FakePswp {
  options: any;
  handlers: Record<string, () => void> = {};
  currIndex: number;
  constructor(options: any) {
    this.options = options;
    this.currIndex = options.index ?? 0;
    instances.push(this);
  }
  on(event: string, cb: () => void) { this.handlers[event] = cb; }
  init() {}
  destroy() { this.handlers['destroy']?.(); }
}
vi.mock('photoswipe', () => ({ default: FakePswp }));
vi.mock('photoswipe/style.css', () => ({}));

import { getFigures } from '@figurecollecting/fc-shared';
import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGetFigures = getFigures as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 'tester', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

function makeFigure(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    userId: 'u1',
    manufacturer: 'Good Smile',
    name: `Figure ${id}`,
    scale: '1/7',
    imageUrl: `https://example.com/${id}.png`,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...extra,
  } as any;
}

function respondWith(figures: any[]) {
  mockedGetFigures.mockResolvedValue({
    success: true,
    data: figures,
    count: figures.length,
    page: 1,
    pages: 1,
    total: figures.length,
  });
}

/** Fake the Collection page's own measured width (useElementWidth reads
 *  clientWidth), so the Fold dual-pane threshold can be exercised in jsdom. */
function mockPageWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('page-collection') ? width : 0;
  });
}

beforeEach(() => {
  mockedGetFigures.mockReset();
  instances.length = 0;
});

afterEach(() => localStorage.clear());

describe('Collection page (rebuilt display layer)', () => {
  it('renders the virtual case by default with figures standing on shelves', async () => {
    signIn();
    respondWith([makeFigure('1'), makeFigure('2')]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByText('Figure 1');
    expect(container.querySelector('.case[data-motif="detolf-dark"]')).not.toBeNull();
  });

  it('honors the layout URL param for Display B', async () => {
    signIn();
    respondWith([makeFigure('1')]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByText('Figure 1');
    expect(container.querySelector('.jrows')).not.toBeNull();
    expect(container.querySelector('.case')).toBeNull();
  });

  it('switches motif from the header cycler', async () => {
    signIn();
    respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByText('Figure 1');
    await user.click(screen.getByRole('button', { name: /case motif/i }));
    await waitFor(() => {
      expect(container.querySelector('.case[data-motif="glass-clear"]')).not.toBeNull();
    });
  });

  it('opens the full-screen viewer on tap with the tapped index', async () => {
    signIn();
    respondWith([makeFigure('1'), makeFigure('2'), makeFigure('3')]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByText('Figure 2');
    await user.click(screen.getByRole('button', { name: 'Figure 2' }));
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0].options.index).toBe(1);
    expect(instances[0].options.dataSource).toHaveLength(3);
    // pull-up sheet shows the figure data
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('pins the preselected default chips and filters via chip removal', async () => {
    signIn();
    respondWith([
      makeFigure('1', { collectionStatus: 'owned' }),
      makeFigure('2', { collectionStatus: 'wished' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/?status=owned' });
    await screen.findByText('Figure 1');
    // default chips visible
    expect(screen.getByRole('listitem', { name: /remove filter prepainted/i })).toBeInTheDocument();
    // status chip filters the set
    expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
    // removing the status chip brings figure 2 back
    await user.click(screen.getByRole('listitem', { name: /remove filter owned/i }));
    expect(await screen.findByRole('button', { name: 'Figure 2' })).toBeInTheDocument();
  });

  it('round-trips the tabbed filter sheet: open, pick maker, apply', async () => {
    signIn();
    respondWith([
      makeFigure('1', { manufacturer: 'Alter' }),
      makeFigure('2', { manufacturer: 'Kotobukiya' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByText('Figure 1');
    await user.click(screen.getByRole('button', { name: /filter/i }));
    await user.click(await screen.findByRole('button', { name: 'Alter1' }));
    await user.click(screen.getByRole('button', { name: /show 1/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Figure 1' })).toBeInTheDocument();
  });

  describe('Fold dual-pane (>= 640px container width)', () => {
    it('opens the detail as a right-hand pane, not a full-screen viewer, at 700px', async () => {
      mockPageWidth(700);
      signIn();
      respondWith([makeFigure('1'), makeFigure('2'), makeFigure('3')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByText('Figure 2');
      await user.click(screen.getByRole('button', { name: 'Figure 2' }));

      await waitFor(() => {
        expect(container.querySelector('.detail-pane')).not.toBeNull();
      });
      expect(instances).toHaveLength(0); // no PhotoSwipe takeover
      expect(container.querySelector('.page-collection__body--split')).not.toBeNull();
      // the grid stays visible alongside the pane
      expect(screen.getByRole('button', { name: 'Figure 1' })).toBeInTheDocument();
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
    });

    it('keeps the full-screen viewer below the 640px threshold', async () => {
      mockPageWidth(400);
      signIn();
      respondWith([makeFigure('1'), makeFigure('2')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByText('Figure 1');
      await user.click(screen.getByRole('button', { name: 'Figure 1' }));

      await waitFor(() => expect(instances).toHaveLength(1));
      expect(container.querySelector('.detail-pane')).toBeNull();
    });

    it('closes the detail pane via its close button, leaving the grid intact', async () => {
      mockPageWidth(700);
      signIn();
      respondWith([makeFigure('1'), makeFigure('2')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByText('Figure 1');
      await user.click(screen.getByRole('button', { name: 'Figure 1' }));
      await waitFor(() => expect(container.querySelector('.detail-pane')).not.toBeNull());

      await user.click(screen.getByRole('button', { name: /close detail/i }));
      expect(container.querySelector('.detail-pane')).toBeNull();
      expect(screen.getByRole('button', { name: 'Figure 1' })).toBeInTheDocument();
    });
  });
});
