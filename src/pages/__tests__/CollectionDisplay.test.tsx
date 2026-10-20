/**
 * Interaction tests for the rebuilt Collection page: display A/B toggle,
 * tap-to-view, applied chips, and the filter sheet round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
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
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches } from '../../test/fakeCaches';

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

/** Where a finger lands on a case figure: its tap box (the picture hanging from it takes no taps). */
function drawnPart(name: string): Element {
  return screen.getByRole('button', { name });
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

  it('the case page is a column the scene fills down to the pull-up tabs (CSS, B1); the rows page is not', async () => {
    await respondWith([makeFigure('1')]);
    const { container, unmount } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(container.querySelector('.page-collection')!.classList.contains('page-collection--case')).toBe(true);
    const scene = container.querySelector('.page-collection__display--case > .cabinet-scene') as HTMLElement;
    // its height is the page's to give: nothing measured once and left stale when the layout above changes
    expect(scene.style.height).toBe('');
    unmount();
    const rows = renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(rows.container.querySelector('.page-collection')!.classList.contains('page-collection--case')).toBe(false);
  });

  it('IC1: the case shows the pull-up tabs View, Info, Refine around the raised +; the tiles Info and Refine, View kept as an empty slot (SHEETS-FB1)', async () => {
    await respondWith([makeFigure('1')]);
    const { unmount } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(Array.from(document.querySelectorAll('.case-tabs > [data-tab]') as NodeListOf<HTMLElement>).map((e) => e.dataset.tab)).toEqual([
      'view',
      'reserved',
      'dock',
      'info',
      'refine',
    ]);
    unmount();
    renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 1' });
    // the tiles keep their way into Refine now the filter row comes and goes; the case's View card is not theirs
    expect(Array.from(document.querySelectorAll('.case-tabs > [data-tab]') as NodeListOf<HTMLElement>).map((e) => `${e.dataset.tab}:${e.tagName}`)).toEqual([
      'view:SPAN',
      'reserved:SPAN',
      'dock:SPAN',
      'info:BUTTON',
      'refine:BUTTON',
    ]);
  });

  it('the View tab opens the case card; its choices are kept on this device (CC14)', async () => {
    await respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('radio', { name: 'White' }));
    // the swipe mode is not in this card any more (CAM1), nor the view (VIEWCARD-1: the header's Case menu)
    expect(screen.queryByRole('radio', { name: 'Pan the wall' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'One cabinet' })).toBeNull();
    await waitFor(() => expect(container.querySelector('.cabinet-scene[data-wall-colour="white"]')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('fc-case-prefs')!)).toMatchObject({ wall: 'white' });
  });

  it('CAM1: the header\'s swipe menu sets the swipe mode, kept on this device; the tiles have no such button', async () => {
    await respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container, unmount } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(container.querySelector('.cabinet-scene[data-swipe="camera"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /^Swipe, Move the camera/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Pan the wall' }));
    await waitFor(() => expect(container.querySelector('.cabinet-scene[data-swipe="pan"]')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('fc-case-prefs')!)).toMatchObject({ swipe: 'pan' });
    expect(screen.getByRole('button', { name: /^Swipe, Pan the wall/ })).toBeInTheDocument();
    unmount();
    renderWithProviders(<Collection />, { initialPath: '/?layout=rows' });
    await screen.findByRole('button', { name: 'Figure 1' });
    expect(screen.queryByRole('button', { name: /^Swipe/ })).toBeNull();
  });

  it('CAM1: the swipe menu is usable while the picture is zoomed: it stands outside the zoom layer, and picking a mode there sets it (a new mode starts the picture at 1x, PINCH-1)', async () => {
    await respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    const scene = container.querySelector('.cabinet-scene') as HTMLElement;
    const zoomK = () => (JSON.parse(scene.dataset.zoom!) as { k: number }).k;
    // two fingers spread: about 2x
    const at = (id: number, x: number) => ({ pointerId: id, clientX: x, clientY: 260, button: 0 });
    fireEvent.pointerDown(scene, at(11, 180));
    fireEvent.pointerDown(scene, at(12, 260));
    for (const t of [0.5, 1]) {
      fireEvent.pointerMove(scene, at(11, 180 - 40 * t));
      fireEvent.pointerMove(scene, at(12, 260 + 40 * t));
    }
    fireEvent.pointerUp(scene, at(11, 140));
    fireEvent.pointerUp(scene, at(12, 300));
    expect(zoomK()).toBeGreaterThan(1);
    const button = screen.getByRole('button', { name: /^Swipe/ });
    expect(scene.contains(button)).toBe(false);
    expect(button).toBeEnabled();
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Swipe modes' });
    expect(scene.contains(menu)).toBe(false);
    await user.click(screen.getByRole('menuitemradio', { name: 'Pan the wall' }));
    await waitFor(() => expect(scene.dataset.swipe).toBe('pan'));
    expect(zoomK()).toBe(1);
  });

  it('CARD-REFRESH-1: a pull down on the collection refetches the cards past the 24 h TTL (the engine rate-limits it), where it used to run a plain sync', async () => {
    const r = await localRig();
    await seedFigures(r, [makeFigure('1')]);
    const refresh = vi.spyOn(r.engine, 'refreshCards');
    const plain = vi.spyOn(r.engine, 'trigger');
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    plain.mockClear();
    const pull = container.querySelector('.pull-to-refresh') as HTMLElement;
    fireEvent.touchStart(pull, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(pull, { touches: [{ clientY: 170 }] });
    fireEvent.touchEnd(pull);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // the one pass it asks for is refreshCards's own: no second, plain one
    expect(plain.mock.calls.filter(([why]) => why === 'manual')).toHaveLength(1);
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
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('Info reopens the figure last tapped even after the list is filtered; disabled once that figure is filtered out', async () => {
    await respondWith([
      makeFigure('1', { manufacturer: 'Alter' }),
      makeFigure('2', { manufacturer: 'Kotobukiya' }),
      makeFigure('3', { manufacturer: 'Kotobukiya' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 2' });
    await user.click(drawnPart('Figure 2'));
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0].options.index).toBe(1);
    instances[0].destroy();
    // the list changes under it: Figure 1 filtered out, so Figure 2 now sits first
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(await screen.findByRole('button', { name: 'Kotobukiya2' }));
    // it applies at once; Done closes the card
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Figure 1' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Info' }));
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(instances[1].options.index).toBe(0);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    instances[1].destroy();
    // filtered out altogether: nothing to reopen
    await user.click(screen.getByRole('listitem', { name: /remove filter kotobukiya/i }));
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(await screen.findByRole('button', { name: 'Alter1' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Info' })).toBeDisabled();
  });

  it('PINCH-1: a filter picked in Refine starts a zoomed case at 1x', async () => {
    await respondWith([
      makeFigure('1', { manufacturer: 'Alter' }),
      makeFigure('2', { manufacturer: 'Kotobukiya' }),
      makeFigure('3', { manufacturer: 'Kotobukiya' }),
    ]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 2' });
    const scene = container.querySelector('.cabinet-scene') as HTMLElement;
    const zoom = () => (JSON.parse(scene.dataset.zoom!) as { k: number }).k;
    // two fingers spread to twice their distance
    fireEvent.pointerDown(scene, { pointerId: 11, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(scene, { pointerId: 12, clientX: 180, clientY: 200 });
    fireEvent.pointerMove(scene, { pointerId: 11, clientX: 60, clientY: 200 });
    fireEvent.pointerMove(scene, { pointerId: 12, clientX: 220, clientY: 200 });
    fireEvent.pointerUp(scene, { pointerId: 11, clientX: 60, clientY: 200 });
    fireEvent.pointerUp(scene, { pointerId: 12, clientX: 220, clientY: 200 });
    expect(zoom()).toBe(2);
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(await screen.findByRole('button', { name: 'Kotobukiya2' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Figure 1' })).toBeNull());
    expect(zoom()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });

  it('stands an owned figure\'s kept image in the case (ADDR-1), a CORS image, and keeps the others as plates', async () => {
    const storage = fakeCaches();
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    try {
      const r = await localRig();
      const src = `https://images.figurecollecting.com/d/${'a'.repeat(64)}`;
      r.clients.getProductImages.mockResolvedValue(
        create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: src, width: 600, height: 800 }] }] }),
      );
      await seedFigures(r, [makeFigure('1'), makeFigure('2')]);
      renderWithProviders(<Collection />, { initialPath: '/' });
      await waitFor(() => expect(document.querySelector(`img[src="${src}"]`)).not.toBeNull());
      expect(document.querySelector(`img[src="${src}"]`)).toHaveAttribute('crossorigin', 'anonymous');
      expect(document.querySelectorAll('.cab-figure img')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stands an owned figure as its cut-out from the kept image and mask, as the coordinator sends them: no primary, the mask and grounding on the first row (IMG-SHOW-1)', async () => {
    const storage = fakeCaches();
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    try {
      const r = await localRig();
      const src = `https://images.figurecollecting.com/d/${'a'.repeat(64)}`;
      const mask = `https://images.figurecollecting.com/d/${'c'.repeat(64)}`;
      r.clients.getProductImages.mockResolvedValue(
        create(GetProductImagesResponseSchema, {
          products: [
            {
              headId: headOf(0),
              images: [
                {
                  derivativeId: 'a'.repeat(64),
                  role: 'gallery',
                  url: src,
                  width: 550,
                  height: 800,
                  mask: { maskId: 'c'.repeat(64), contentType: 'image/png', url: mask },
                  bottomMarginFrac: 0.03,
                  contactBand: { centerXFrac: 0.48, widthFrac: 0.6 },
                },
                { derivativeId: 'b'.repeat(64), role: 'gallery', url: `https://images.figurecollecting.com/d/${'b'.repeat(64)}`, width: 550, height: 800 },
              ],
            },
          ],
        }),
      );
      await seedFigures(r, [makeFigure('1'), makeFigure('2')]);
      renderWithProviders(<Collection />, { initialPath: '/' });
      await waitFor(() => expect(document.querySelector('.cab-figure[data-art="masked"]')).not.toBeNull());
      const art = document.querySelector('.cab-figure[data-art="masked"] .cab-figure__art--masked');
      expect(art).toHaveAttribute('data-image-url', src);
      expect(art).toHaveAttribute('data-mask-url', mask);
      expect(document.querySelectorAll('.cab-figure[data-art="plate"]')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps an owned figure as its plate when its image bytes could not be kept (ADDR-1)', async () => {
    const storage = fakeCaches(async () => new Response('', { status: 404 }));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    try {
      const r = await localRig();
      const src = `https://images.figurecollecting.com/d/${'a'.repeat(64)}`;
      r.clients.getProductImages.mockResolvedValue(
        create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: src, width: 600, height: 800 }] }] }),
      );
      await seedFigures(r, [makeFigure('1'), makeFigure('2')]);
      const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
      await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
      await waitFor(() => expect(container.querySelectorAll('.cab-figure__plate')).toHaveLength(2));
      await new Promise((res) => setTimeout(res, 50));
      expect(document.querySelector('.cab-figure img')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('HDR (a): the active Case button opens its views and sets the case view, kept on this device; Tiles switches mode', async () => {
    await respondWith([makeFigure('1')]);
    const user = userEvent.setup();
    const { container, currentPath } = renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    await user.click(screen.getByRole('button', { name: /^Case/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'One shelf' }));
    await waitFor(() => expect(container.querySelector('.cabinet-scene[data-view="shelf"]')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('fc-case-prefs')!)).toMatchObject({ view: 'shelf' });
    expect(screen.getByRole('button', { name: /^Case/ })).toHaveAttribute('aria-label', 'Case, One shelf');
    await user.click(screen.getByRole('button', { name: /^Tiles/ }));
    await waitFor(() => expect(container.querySelector('.jrows')).not.toBeNull());
    expect(currentPath()).toContain('layout=rows');
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

  it('while filtered, the row shows the applied filters, the defaults among them, and filters via chip removal', async () => {
    await respondWith([makeFigure('1', { manufacturer: 'Alter' }), makeFigure('2', { manufacturer: 'Kotobukiya' })]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/?mfr=Alter' });
    await screen.findByRole('button', { name: 'Figure 1' });
    // default chips visible while something is filtered
    expect(screen.getByRole('listitem', { name: /remove filter prepainted/i })).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    // the maker chip filters the set
    expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
    // removing it brings figure 2 back, and the row goes: nothing is filtered
    await user.click(screen.getByRole('listitem', { name: /remove filter alter/i }));
    expect(await screen.findByRole('button', { name: 'Figure 2' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /remove filter prepainted/i })).toBeNull());
  });

  it('the Refine card applies live: pick a maker and the grid behind it narrows at once; Done closes it', async () => {
    await respondWith([
      makeFigure('1', { manufacturer: 'Alter' }),
      makeFigure('2', { manufacturer: 'Kotobukiya' }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'Figure 1' });
    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(await screen.findByRole('button', { name: 'Alter1' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Figure 1' })).toBeInTheDocument();
    expect(screen.getAllByText('1 of 2').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Done' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Figure 2' })).toBeNull();
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

describe('MISFIT-CHIP-1: the do-not-fit chip on the case page, its list, and the View card\'s way back to it', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  async function openCaseWithMisfits(count: number) {
    localStorage.setItem('fc-fixture-mode', 'on');
    window.history.pushState({}, '', `/?layout=case&fxmisfit=${count}`);
    const user = userEvent.setup();
    const utils = renderWithProviders(<Collection />, { initialPath: `/?layout=case&fxmisfit=${count}` });
    await screen.findByRole('button', { name: `${count} figures do not fit` });
    return { user, ...utils };
  }
  const list = () => screen.queryByRole('region', { name: 'Figures that do not fit' });

  it('the chip opens the list; the View card\'s "Doesn\'t fit (N)" opens the same list, chip hidden or not; × hides the chip, stored as ids', async () => {
    const { user } = await openCaseWithMisfits(16);
    expect(list()).toBeNull();
    // the card's entry, with the chip showing: closes the card, opens the list
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('button', { name: "Doesn't fit (16)" }));
    const l = await screen.findByRole('region', { name: 'Figures that do not fit' });
    expect(l.querySelectorAll('li')).toHaveLength(16);
    // Back and Esc close it, as they do a card
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list()).toBeNull());
    expect(screen.getByRole('button', { name: '16 figures do not fit' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '16 figures do not fit' }));
    await screen.findByRole('region', { name: 'Figures that do not fit' });
    // × on it: the list closes, the chip is gone, the ids kept on this device
    await user.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(list()).toBeNull();
    expect(screen.queryByRole('button', { name: '16 figures do not fit' })).toBeNull();
    const stored = JSON.parse(localStorage.getItem('fc-case-prefs')!) as { misfitsDismissed: string[] };
    expect(stored.misfitsDismissed).toHaveLength(16);
    // the card still has the entry: always recallable, the chip hidden
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('button', { name: "Doesn't fit (16)" }));
    expect((await screen.findByRole('region', { name: 'Figures that do not fit' })).querySelectorAll('li')).toHaveLength(16);
  });

  it('no entry in the card, no chip, when every figure fits', async () => {
    localStorage.setItem('fc-fixture-mode', 'on');
    const user = userEvent.setup();
    renderWithProviders(<Collection />, { initialPath: '/?layout=case' });
    await screen.findByRole('button', { name: 'View' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('group', { name: 'Wall' });
    expect(screen.queryByRole('button', { name: /^Doesn't fit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /do not fit$/ })).toBeNull();
  });
});

