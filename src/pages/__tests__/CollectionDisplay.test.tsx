/**
 * Interaction tests for the rebuilt Collection page: display A/B toggle,
 * tap-to-view, applied chips, and the filter sheet round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

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

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures, type SeedFigure } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';

/** The local store holding `figs` (on the local data no figure has an image: MG-2). */
async function respondWith(figs: SeedFigure[]) {
  const r = await localRig();
  await seedFigures(r, figs);
}

const makeFigure = (id: string, extra: Partial<SeedFigure> = {}): SeedFigure => ({ title: `Figure ${id}`, manufacturer: 'Good Smile', ...extra });

/** Fake the Collection page's own measured width (useElementWidth reads
 *  clientWidth), so the Fold dual-pane threshold can be exercised in jsdom. */
function mockPageWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('page-collection') ? width : 0;
  });
}

beforeEach(() => {
  instances.length = 0;
});

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
});

/** Where a finger lands on a case figure: its drawn part (its box takes no taps). */
function drawnPart(name: string): Element {
  return screen.getByRole('button', { name }).firstElementChild!;
}

describe('Collection page (rebuilt display layer)', () => {
  it('renders the faithful cabinets by default: the KLINGSBO, figures standing on its surfaces', async () => {
    await respondWith([makeFigure('1'), makeFigure('2')]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(container.querySelector('.cabinet-scene[data-pattern="ikea-klingsbo"]')).not.toBeNull();
    expect(container.querySelector('.cab[data-profile="ikea-klingsbo"]')).not.toBeNull();
    // no image on the local data yet (MG-2): every figure stands as a plate with its name
    expect(screen.getByRole('button', { name: 'Figure 1' }).dataset.art).toBe('plate');
  });

  it('IC1: the case shows the pull-up tabs View, Info, Refine around the raised +; the rows do not', async () => {
    await respondWith([makeFigure('1')]);
    const { container, unmount } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(Array.from(document.querySelectorAll('.case-tabs > [data-tab]') as NodeListOf<HTMLElement>).map((e) => e.dataset.tab)).toEqual([
      'view',
      'reserved',
      'dock',
      'info',
      'refine',
    ]);
    unmount();
    const rows = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(rows.container.ownerDocument.querySelector('.case-tabs')).toBeNull();
  });

  it('the View tab opens the case card; its choices are kept on this device (CC14)', async () => {
    await respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('radio', { name: 'Pan the wall' }));
    await user.click(screen.getByRole('radio', { name: 'One cabinet' }));
    await waitFor(() => expect(container.querySelector('.cabinet-scene[data-swipe="pan"][data-view="cabinet"]')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('fc-case-prefs')!)).toMatchObject({ swipe: 'pan', view: 'cabinet' });
  });

  it('the Refine tab opens the filter sheet; Info reopens the last figure tapped', async () => {
    await respondWith([makeFigure('1'), makeFigure('2')]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 2' });
    expect(screen.getByRole('button', { name: 'Info' })).toBeDisabled();
    await user.click(drawnPart('Figure 2'));
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].destroy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Info' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Info' }));
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(instances[1].options.index).toBe(1);
    instances[1].destroy();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    expect(await screen.findByRole('button', { name: /show \d/i })).toBeInTheDocument();
  });

  it('honors the layout URL param for Display B', async () => {
    await respondWith([makeFigure('1')]);
    const { container } = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(container.querySelector('.jrows')).not.toBeNull();
    expect(container.querySelector('.cabinet-scene')).toBeNull();
  });

  it('opens the full-screen viewer on tap with the tapped index', async () => {
    await respondWith([makeFigure('1'), makeFigure('2'), makeFigure('3')]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 2' });
    await user.click(drawnPart('Figure 2'));
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0].options.index).toBe(1);
    expect(instances[0].options.dataSource).toHaveLength(3);
    // pull-up sheet shows the figure data
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('pins the preselected default chips and filters via chip removal', async () => {
    await respondWith([makeFigure('1', { manufacturer: 'Alter' }), makeFigure('2', { manufacturer: 'Kotobukiya' })]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/?mfr=Alter' });
    await screen.findByRole('button', { name: 'Figure 1' });
    // default chips visible
    expect(screen.getByRole('listitem', { name: /remove filter prepainted/i })).toBeInTheDocument();
    // the maker chip filters the set
    expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
    // removing it brings figure 2 back
    await user.click(screen.getByRole('listitem', { name: /remove filter alter/i }));
    expect(await screen.findByRole('button', { name: 'Figure 2' })).toBeInTheDocument();
  });

  it('round-trips the tabbed filter sheet: open, pick maker, apply', async () => {
    await respondWith([
      makeFigure('1', { manufacturer: 'Alter' }),
      makeFigure('2', { manufacturer: 'Kotobukiya' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
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
        await respondWith([makeFigure('1'), makeFigure('2'), makeFigure('3')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByRole('button', { name: 'Figure 2' });
      await user.click(drawnPart('Figure 2'));

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
        await respondWith([makeFigure('1'), makeFigure('2')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByRole('button', { name: 'Figure 1' });
      await user.click(drawnPart('Figure 1'));

      await waitFor(() => expect(instances).toHaveLength(1));
      expect(container.querySelector('.detail-pane')).toBeNull();
    });

    it('closes the detail pane via its close button, leaving the grid intact', async () => {
      mockPageWidth(700);
        await respondWith([makeFigure('1'), makeFigure('2')]);
      const user = userEvent.setup();
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await screen.findByRole('button', { name: 'Figure 1' });
      await user.click(drawnPart('Figure 1'));
      await waitFor(() => expect(container.querySelector('.detail-pane')).not.toBeNull());

      await user.click(screen.getByRole('button', { name: /close detail/i }));
      expect(container.querySelector('.detail-pane')).toBeNull();
      expect(screen.getByRole('button', { name: 'Figure 1' })).toBeInTheDocument();
    });
  });
});
