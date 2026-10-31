import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Fake PhotoSwipe capturing options + event handlers, so we can assert the
// dataSource and drive 'change' events without a real gesture engine.
const instances: FakePswp[] = [];
class FakePswp {
  options: any;
  handlers: Record<string, (payload?: any) => void> = {};
  updateSize = vi.fn();
  refreshSlideContent = vi.fn();
  currIndex: number;
  initialized = false;
  destroyed = false;
  constructor(options: any) {
    this.options = options;
    this.currIndex = options.index ?? 0;
    instances.push(this);
  }
  on(event: string, cb: (payload?: any) => void) {
    this.handlers[event] = cb;
  }
  init() {
    this.initialized = true;
  }
  destroy() {
    this.destroyed = true;
    this.handlers['destroy']?.();
  }
  close() {
    this.destroy();
  }
  swipeTo(i: number) {
    this.currIndex = i;
    this.handlers['change']?.();
  }
}

vi.mock('photoswipe', () => ({ default: FakePswp }));
vi.mock('photoswipe/style.css', () => ({}));

import { FigureViewer, fitSlideToPicture } from '../FigureViewer';
import { RAIL_INSET_PX, RAIL_WIDTH_PX } from '../../ui/SideRail';
import { renderWithProviders, flushAll } from '../../../test/testUtils';
import { FIXTURE_FIGURES, FIXTURE_META, setFixtureMode } from '../../../dev-fixtures/fixtures';

beforeEach(() => {
  instances.length = 0;
});

describe('FigureViewer (Display D)', () => {
  // GALLERY-1: the rail's Photos opens the figure's photos over the viewer; a figure with no local item has none to open
  it('Photos is disabled for a figure with no local item, and opens the figure\'s photos over the viewer for one that has it', async () => {
    const user = userEvent.setup();
    const bare = renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Photos' })).toBeDisabled();
    bare.unmount();
    const local = FIXTURE_FIGURES.map((f) => ({ ...f, local: { headId: 'h9', kind: 'owned', sync: 'known', asOf: null, copies: [] } })) as never;
    renderWithProviders(<FigureViewer figures={local} index={0} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Photos' }));
    expect(await screen.findByRole('dialog', { name: 'Photos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close photos' }));
    expect(screen.queryByRole('dialog', { name: 'Photos' })).toBeNull();
  });

  // GALLERY-1: "Use for me" in the Photos tab changes the photo the card's figure shows; the photo behind the sheet follows
  // it at once, in the slide that stands, and no other is refreshed for nothing
  it('shows the photo a figure takes up after the viewer opened: its slide is rewritten and refreshed, once, and only the current one', async () => {
    const { rerender } = renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const pswp = instances[0]!;
    expect(pswp.refreshSlideContent).not.toHaveBeenCalled();
    const taken = FIXTURE_FIGURES.map((f, i) => (i === 1 ? { ...f, imageUrl: 'https://images.figurecollecting.com/d/' + 'b'.repeat(64) } : { ...f, imageUrl: f.imageUrl + '?other' }));
    rerender(<FigureViewer figures={taken} index={1} onClose={() => {}} />);
    await waitFor(() => expect(pswp.refreshSlideContent).toHaveBeenCalledTimes(1));
    expect(pswp.refreshSlideContent).toHaveBeenCalledWith(1);
    expect(pswp.options.dataSource[1].src).toBe('https://images.figurecollecting.com/d/' + 'b'.repeat(64));
    // the figures beside it kept the slides they opened with
    expect(pswp.options.dataSource[0].src).toBe(FIXTURE_FIGURES[0].imageUrl);
    // the same photo again: nothing to refresh
    rerender(<FigureViewer figures={[...taken]} index={1} onClose={() => {}} />);
    expect(pswp.refreshSlideContent).toHaveBeenCalledTimes(1);
  });

  it('shows a figure\'s plate when its photo goes (a withdrawn image), in the slide that stands', async () => {
    const { rerender } = renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const pswp = instances[0]!;
    rerender(<FigureViewer figures={FIXTURE_FIGURES.map((f, i) => (i === 0 ? { ...f, imageUrl: undefined } : f))} index={0} onClose={() => {}} />);
    await waitFor(() => expect(pswp.refreshSlideContent).toHaveBeenCalledWith(0));
    expect(pswp.options.dataSource[0].html).toContain('figure-viewer__no-image');
    expect(pswp.options.dataSource[0].src).toBeUndefined();
  });

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
      // gitignored fixture images absent (CI): html fallback slide, a plate naming the figure
      expect(first.html).toContain(FIXTURE_FIGURES[0].name);
    }
    expect(pswp.options.initialZoomLevel).toBe('fit');
  });

  it('builds the no-image slide without a style attribute, which a strict CSP blocks', async () => {
    const noImage = FIXTURE_FIGURES.map((f) => ({ ...f, imageUrl: undefined }));
    renderWithProviders(<FigureViewer figures={noImage} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const slide = instances[0].options.dataSource[0];
    expect(slide.html).not.toMatch(/style=/);
    expect(slide.html).toContain('class="figure-viewer__no-image"');
  });

  it('draws a placeholder plate naming the figure and its maker, its text escaped', async () => {
    const figure = { ...FIXTURE_FIGURES[0]!, imageUrl: undefined, name: 'Rem <b>&</b> Ram', manufacturer: 'A "Co"' };
    renderWithProviders(<FigureViewer figures={[figure]} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const html: string = instances[0].options.dataSource[0].html;
    expect(html).toContain('Rem &lt;b&gt;&amp;&lt;/b&gt; Ram');
    expect(html).toContain('A &quot;Co&quot;');
    expect(html).not.toContain('<b>');
  });

  it('takes down a gallery still opening, whose destroy() would only close a fully open one', async () => {
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances[0]?.initialized).toBe(true));
    const pswp = instances[0]!;
    const element = document.createElement('div');
    document.body.appendChild(element);
    const removeAll = vi.fn();
    Object.assign(pswp, { element, events: { removeAll }, destroy: () => undefined });
    unmount();
    expect(element.isConnected).toBe(false);
    expect(removeAll).toHaveBeenCalled();
  });

  it('closes itself before it opens the full detail of a local figure', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const local = { ...FIXTURE_FIGURES[0]!, imageUrl: undefined, local: { headId: 'h1', kind: 'owned', sync: 'known', asOf: null } } as never;
    const { currentPath } = renderWithProviders(<FigureViewer figures={[local]} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances[0]?.initialized).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Copies and actions' }));
    expect(instances[0]!.destroyed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe('/figure/h1');
  });

  it('shows the tapped figure data in the pull-up sheet', async () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    expect(screen.getByText('Rem')).toBeInTheDocument();
    // the badges; the fields below may repeat a name (Rem's distributor is her maker)
    const badges = within(document.querySelector<HTMLElement>('.figure-viewer-sheet__badges')!);
    expect(badges.getByText('1/7')).toBeInTheDocument();
    expect(badges.getByText('Good Smile Company')).toBeInTheDocument();
    expect(badges.getByText(/owned/i)).toBeInTheDocument();
  });

  it('follows swipes across the result set', async () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].swipeTo(3);
    await flushAll();
    expect(await screen.findByText('Madoka Kaname')).toBeInTheDocument();
    expect(screen.getByText('4 of 7')).toBeInTheDocument();
  });

  it('CARD-FLICKER-1: a swipe to a figure whose card is taller stands the sheet on its low detent in the same frame, never a frame at the old one', async () => {
    // jsdom lays nothing out: a sheet is 200 px and 40 more per field row, its summary the top 120 px
    const rows = (el: HTMLElement) => el.querySelectorAll('.figure-viewer-sheet__row').length;
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('figure-viewer-sheet') ? 200 + 40 * rows(this) : 0;
    });
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: 0, bottom: this.classList.contains('figure-viewer-sheet__summary') ? 120 : 0 } as DOMRect;
    });
    onTestFinished(() => {
      height.mockRestore();
      rect.mockRestore();
    });
    const longer = { ...FIXTURE_FIGURES[1]!, note: 'A note.', version: 'Limited', materials: 'PVC, ABS' };
    renderWithProviders(<FigureViewer figures={[FIXTURE_FIGURES[0]!, longer]} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances[0]?.initialized).toBe(true));
    const sheet = document.body.querySelector<HTMLElement>('.figure-viewer-sheet')!;
    const low = () => `translateY(${200 + 40 * rows(sheet) - 120}px)`;
    // opened on the summary: its detent is the sheet's height less the summary's 120 px
    await waitFor(() => expect(sheet.style.transform).toBe(low()));
    const before = rows(sheet);
    act(() => instances[0]!.swipeTo(1));
    expect(rows(sheet)).toBeGreaterThan(before);
    // written already, before framer-motion's next frame would write it
    expect(sheet.style.transform).toBe(low());
    // and back to the shorter card
    act(() => instances[0]!.swipeTo(0));
    expect(sheet.style.transform).toBe(low());
  });

  // SIDE-RAIL-1 (Ross 10-18): the figure card's sections on a right rail, above its sheet
  describe('the right rail: the card\'s sections, stacked icon over label, beside the photo and above the sheet', () => {
    const local = (f: (typeof FIGURE_FIXTURES)[number]) => ({ ...f, imageUrl: undefined, local: { headId: 'h1', kind: 'owned', sync: 'known', asOf: null } }) as never;
    const FIGURE_FIXTURES = FIXTURE_FIGURES;

    it('carries Details, Photos and Copies, a rail of the figure sections inside the sheet so it rides above the sheet\'s top edge', () => {
      renderWithProviders(<FigureViewer figures={FIGURE_FIXTURES} index={0} onClose={() => {}} />);
      const rail = document.body.querySelector('.figure-viewer-sheet .side-rail')!;
      expect(rail).not.toBeNull();
      expect(rail.getAttribute('aria-label')).toBe('Figure sections');
      expect(Array.from(rail.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Details', 'Photos', 'Copies']);
    });

    it('Details does what the handle does: it takes the sheet up to all of its fields and back to the summary', async () => {
      const user = userEvent.setup();
      // jsdom lays nothing out: a 400 px sheet whose handle and summary take its top 120 px (two detents)
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('figure-viewer-sheet') ? 400 : 0;
      });
      const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return { top: 0, bottom: this.classList.contains('figure-viewer-sheet__summary') ? 120 : 0 } as DOMRect;
      });
      onTestFinished(() => {
        height.mockRestore();
        rect.mockRestore();
      });
      renderWithProviders(<FigureViewer figures={FIGURE_FIXTURES} index={1} onClose={() => {}} />);
      const sheet = document.body.querySelector('.figure-viewer-sheet')!;
      const details = screen.getByRole('button', { name: 'Details' });
      expect(sheet.getAttribute('data-detent')).toBe('summary');
      expect(details).not.toHaveAttribute('aria-current');
      await user.click(details);
      expect(sheet.getAttribute('data-detent')).toBe('all');
      expect(details).toHaveAttribute('aria-current', 'true');
      await user.click(details);
      expect(sheet.getAttribute('data-detent')).toBe('summary');
      expect(details).not.toHaveAttribute('aria-current');
    });

    it('Copies closes the viewer and opens the figure\'s full page, as "Copies and actions" does', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { currentPath } = renderWithProviders(<FigureViewer figures={[local(FIGURE_FIXTURES[0]!)]} index={0} onClose={onClose} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      await user.click(screen.getByRole('button', { name: 'Copies' }));
      expect(instances[0]!.destroyed).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(currentPath()).toBe('/figure/h1');
    });

    it('a figure with no local item has no copies to open: Copies is disabled', () => {
      renderWithProviders(<FigureViewer figures={FIGURE_FIXTURES} index={0} onClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Copies' })).toBeDisabled();
    });

    it('the photo leaves the rail\'s room on its right: the rail\'s width and its 24 px inset, and a little more', async () => {
      renderWithProviders(<FigureViewer figures={FIGURE_FIXTURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      const { right } = instances[0]!.options.paddingFn();
      expect(right).toBe(RAIL_INSET_PX + RAIL_WIDTH_PX + 8);
    });

    it('the rail sits 24 px in from the edge, above the sheet, and the sheet leaves it room above; the prev/next arrows keep above the rail\'s places', () => {
      renderWithProviders(<FigureViewer figures={FIGURE_FIXTURES} index={0} onClose={() => {}} />);
      const css = Array.from(document.querySelectorAll('style')).map((st) => st.textContent ?? '').join('\n');
      expect(css).toMatch(/\.figure-viewer-sheet__rail\s*\{[^}]*right:\s*calc\(24px \+ var\(--safe-area-right/);
      expect(css).toMatch(/\.figure-viewer-sheet__rail\s*\{[^}]*bottom:\s*calc\(100% \+ 12px\)/);
      // the sheet stops short of the top by the rail's room, so the rail is never pushed off the screen
      expect(css).toMatch(/\.figure-viewer-sheet\s*\{[^}]*max-height:\s*min\(80dvh, calc\(100dvh - var\(--rail-room, 0px\)\)\)/);
      // PhotoSwipe's arrows are moved up, clear of the rail
      expect(css).toMatch(/\.pswp \.pswp__button--arrow\s*\{[^}]*top:\s*28%/);
    });
  });

  // STRETCH-FIX (Ross 10-18, Fold8 cover: "She's stretched")
  describe('the photo is laid out in its own shape, whole, above the sheet', () => {
    const picture = (naturalWidth: number, naturalHeight: number) => {
      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: naturalWidth });
      Object.defineProperty(img, 'naturalHeight', { value: naturalHeight });
      return img;
    };
    const slideOf = (width: number, height: number) => ({ width, height, calculateSize: vi.fn(), zoomAndPanToInitial: vi.fn(), applyCurrentZoomPan: vi.fn(), updateContentSize: vi.fn() });
    const contentOf = (element: HTMLElement | undefined, width: number, height: number) => ({ element, width, height, data: { width, height } });

    it('a photo of another shape than the app guessed for it is laid out in the photo\'s own: the slide, its content and its data take the natural size, and the slide is sized again', () => {
      const content = contentOf(picture(540, 960), 600, 800);
      const slide = slideOf(600, 800);
      fitSlideToPicture(content, slide);
      expect([content.width, content.height, content.data.width, content.data.height, slide.width, slide.height]).toEqual([540, 960, 540, 960, 540, 960]);
      expect(slide.calculateSize).toHaveBeenCalledOnce();
      expect(slide.zoomAndPanToInitial).toHaveBeenCalledOnce();
      expect(slide.applyCurrentZoomPan).toHaveBeenCalledOnce();
      expect(slide.updateContentSize).toHaveBeenCalledWith(true);
    });

    it('leaves a slide whose declared shape is the photo\'s (a fixture, a figure whose size was known) alone', () => {
      const content = contentOf(picture(550, 800), 550, 800);
      const slide = slideOf(550, 800);
      fitSlideToPicture(content, slide);
      expect(slide.calculateSize).not.toHaveBeenCalled();
      // within a tenth of a percent is the same shape (a rounded size)
      const rounded = contentOf(picture(1101, 1600), 550, 800);
      fitSlideToPicture(rounded, slide);
      expect(slide.calculateSize).not.toHaveBeenCalled();
    });

    it('leaves a slide that has no picture (a plate, a failed load, an image with no size yet) alone', () => {
      const slide = slideOf(600, 800);
      fitSlideToPicture(contentOf(document.createElement('div'), 600, 800), slide);
      fitSlideToPicture(contentOf(undefined, 600, 800), slide);
      fitSlideToPicture(contentOf(picture(0, 0), 600, 800), slide);
      expect(slide.calculateSize).not.toHaveBeenCalled();
    });

    it('lays every slide out once its picture has loaded', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      const content = contentOf(picture(900, 600), 550, 800);
      const slide = slideOf(550, 800);
      instances[0]!.handlers['loadComplete']!({ content, slide });
      expect([slide.width, slide.height]).toEqual([900, 600]);
    });

    // STRETCH-2 (Ross 10-20): PhotoSwipe loads the pictures beside the open one before it has a slide for them and says no
    // loadComplete for those, so a slide made later (a swipe two figures on) held the guessed shape: laid out when it is set
    it('lays a slide out when it is made over a picture that loaded before it existed, not only when a load completes', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      const handler = instances[0]!.handlers['afterSetContent'];
      expect(handler, 'a handler for the slide being set with its content').toBeTypeOf('function');
      const slide = { ...slideOf(600, 800), content: contentOf(picture(540, 960), 600, 800) };
      handler!({ slide });
      expect([slide.width, slide.height, slide.content.width, slide.content.height]).toEqual([540, 960, 540, 960]);
      expect(slide.updateContentSize).toHaveBeenCalledWith(true);
      // a slide whose picture has not loaded yet is left to its loadComplete
      const waiting = { ...slideOf(600, 800), content: contentOf(picture(0, 0), 600, 800) };
      handler!({ slide: waiting });
      expect(waiting.calculateSize).not.toHaveBeenCalled();
    });

    it('reserves what the sheet covers at its summary for the photo, so it stands above the sheet and not under it', async () => {
      // jsdom lays nothing out: a 400 px sheet whose handle and summary take its top 120 px (the summary detent: 120 px of it show)
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('figure-viewer-sheet') ? 400 : 0;
      });
      const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return { top: 0, bottom: this.classList.contains('figure-viewer-sheet__summary') ? 120 : 0 } as DOMRect;
      });
      onTestFinished(() => {
        height.mockRestore();
        rect.mockRestore();
      });
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      expect(instances[0]!.options.paddingFn()).toEqual({ top: 0, left: 0, right: RAIL_INSET_PX + RAIL_WIDTH_PX + 8, bottom: 120 });
    });

    it('reserves nothing before the sheet is there, and the whole sheet when it has no lower detent', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      // jsdom: a sheet of no height at all
      expect(instances[0]!.options.paddingFn().bottom).toBe(0);
      const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('figure-viewer-sheet') ? 90 : 0;
      });
      const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return { top: 0, bottom: this.classList.contains('figure-viewer-sheet__summary') ? 90 : 0 } as DOMRect;
      });
      onTestFinished(() => {
        height.mockRestore();
        rect.mockRestore();
      });
      // 90 px of sheet that is all summary: one detent, all of it shows
      expect(instances[0]!.options.paddingFn().bottom).toBe(90);
    });

    it('fits the photo above the new card\'s sheet when the figure changes (another card is another height)', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances[0]?.initialized).toBe(true));
      instances[0]!.updateSize.mockClear();
      act(() => instances[0]!.swipeTo(1));
      expect(instances[0]!.updateSize).toHaveBeenCalledWith(true);
    });
  });

  it('every field is in the sheet from the start; its handle toggles it between the summary and all of them (SHEETS-FB1 6)', async () => {
    const user = userEvent.setup();
    // jsdom lays nothing out: a 400 px sheet whose handle and summary take its top 120 px
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('figure-viewer-sheet') ? 400 : 0;
    });
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: 0, bottom: this.classList.contains('figure-viewer-sheet__summary') ? 120 : 0 } as DOMRect;
    });
    onTestFinished(() => {
      height.mockRestore();
      rect.mockRestore();
    });
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} />);
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: 'Show all details' });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    await user.click(handle);
    expect(screen.getByRole('button', { name: 'Show the summary' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Show the summary' }));
    expect(screen.getByRole('button', { name: 'Show all details' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('a sheet whose summary is all of it has one detent: up', () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} />);
    expect(document.body.querySelector('.figure-viewer-sheet')).toHaveAttribute('data-detent', 'all');
  });

  it('the fields scroll in their own body under the handle', () => {
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} />);
    const sheet = document.body.querySelector('.figure-viewer-sheet')!;
    const body = sheet.querySelector('.figure-viewer-sheet__body')!;
    expect(body).not.toBeNull();
    expect(body.contains(sheet.querySelector('.figure-viewer-sheet__handle'))).toBe(false);
    expect(body.querySelector('.figure-viewer-sheet__more')).not.toBeNull();
  });

  it('portals the pull-up sheet to document.body so it stacks over photoswipe', () => {
    const { container } = renderWithProviders(
      <FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />,
    );
    // PhotoSwipe appends its root to document.body; the sheet must share that
    // stacking context, so it can't live inside the page's subtree.
    expect(container.querySelector('.figure-viewer-sheet')).toBeNull();
    const sheet = document.body.querySelector('.figure-viewer-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.parentElement).toBe(document.body);
  });

  it('an X shows from the first moment, before the gallery opens, and closes it (SHEETS-FB1 6c)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    const x = screen.getByRole('button', { name: 'Close' });
    expect(x.parentElement).toBe(document.body);
    await waitFor(() => expect(instances[0]?.initialized).toBe(true));
    await user.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(instances[0]!.destroyed).toBe(true);
  });

  it('PhotoSwipe draws no X of its own; a tap off the picture closes, a tap on the picture or its plate does not', async () => {
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances[0]?.initialized).toBe(true));
    const pswp = instances[0]!;
    expect(pswp.options.close).toBe(false);
    const tap = (el: Element) => pswp.options.tapAction.call(pswp, { x: 1, y: 1 }, { target: el });
    const img = document.createElement('img');
    img.className = 'pswp__img';
    const plate = document.createElement('span');
    plate.className = 'figure-viewer__plate-name';
    tap(img);
    tap(plate);
    expect(onClose).not.toHaveBeenCalled();
    tap(document.createElement('div'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes it from the first moment, the gallery still opening or not', async () => {
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // the gallery's code arrives after: it finds the viewer closed and opens nothing
    await new Promise((r) => setTimeout(r, 50));
    expect(instances.filter((i) => !i.destroyed)).toHaveLength(0);
  });

  it('Back (Android or the browser) closes it: it opens a history entry', async () => {
    // the viewers of the tests before took their entries back off: let those Backs land first
    await new Promise((r) => setTimeout(r, 30));
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("the full detail of a local figure takes the viewer's place in history, so Back from it returns to the collection", async () => {
    const user = userEvent.setup();
    const local = { ...FIXTURE_FIGURES[0]!, imageUrl: undefined, local: { headId: 'h1', kind: 'owned', sync: 'known', asOf: null } } as never;
    const { history: visited } = renderWithProviders(<FigureViewer figures={[local]} index={0} onClose={() => {}} />, { initialPath: '/?layout=case' });
    await user.click(screen.getByRole('button', { name: 'Copies and actions' }));
    expect(visited).toEqual(['/figure/h1']);
  });

  // CARD-VIEW-1 part 2 (Ross 10-25: "more often than not, you want to start zoomed in around the face/upper"): PhotoSwipe's zoom
  // control and its z key both call pswp.toggleZoom() with no point; a double-tap or a click calls the slide's with its point
  describe('the zoom control and the z key start at the face', () => {
    /** A slide laid out whole (fit 0.5) in a 400 x 600 pan area offset (0, 10) in the viewport: a 600 x 1000 picture, 300 x 500 at 1x. */
    function slide(currZoomLevel = 0.5) {
      return {
        currZoomLevel,
        zoomLevels: { initial: 0.5, secondary: 2, min: 0.5, max: 4 },
        width: 600,
        height: 1000,
        pan: { x: 50, y: 60 },
        panAreaSize: { x: 400, y: 600 },
        bounds: { center: { x: 50, y: 60 } },
        zoomTo: vi.fn(),
        toggleZoom: vi.fn(),
      };
    }

    it('the gallery\'s toggleZoom (its control, its z key) zooms the current slide in centred half across and a third down the picture', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances).toHaveLength(1));
      const pswp = instances[0] as FakePswp & { currSlide?: ReturnType<typeof slide>; toggleZoom: () => void };
      const s = slide();
      pswp.currSlide = s;
      pswp.toggleZoom();
      expect(s.toggleZoom).not.toHaveBeenCalled();
      expect(s.zoomTo).toHaveBeenCalledTimes(1);
      const [level, point] = s.zoomTo.mock.calls[0] as [number, { x: number; y: number }];
      expect(level).toBe(2);
      // PhotoSwipe keeps `point` still: the pan it lands at is (pan - point) * 2 / 0.5 + point
      const landed = { x: (s.pan.x - point.x) * 4 + point.x, y: (s.pan.y - point.y) * 4 + point.y };
      // 1200 x 2000 at 2x in the 400 x 600 area at (0, 10): the face (600, 666.7) in the area's middle (200, 310)
      expect(landed.x + 1200 / 2).toBeCloseTo(200);
      expect(landed.y + 2000 / 3).toBeCloseTo(310);
    });

    it('zoomed in, the control zooms back out as before; a gallery with no slide does nothing', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances).toHaveLength(1));
      const pswp = instances[0] as FakePswp & { currSlide?: ReturnType<typeof slide>; toggleZoom: () => void };
      pswp.toggleZoom();
      const s = slide(2);
      pswp.currSlide = s;
      pswp.toggleZoom();
      expect(s.toggleZoom).toHaveBeenCalledTimes(1);
      expect(s.zoomTo).not.toHaveBeenCalled();
    });

    it('a slide that cannot zoom further (secondary = initial) toggles as PhotoSwipe does', async () => {
      renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
      await waitFor(() => expect(instances).toHaveLength(1));
      const pswp = instances[0] as FakePswp & { currSlide?: ReturnType<typeof slide>; toggleZoom: () => void };
      const s = { ...slide(), zoomLevels: { initial: 0.5, secondary: 0.5, min: 0.5, max: 4 } };
      pswp.currSlide = s;
      pswp.toggleZoom();
      expect(s.toggleZoom).toHaveBeenCalledTimes(1);
      expect(s.zoomTo).not.toHaveBeenCalled();
    });
  });

  // CARD-VIEW-1 part 3: Go to goes to the figure the viewer shows now, after any flip through the result set
  it('Go to goes to the figure shown now: the tapped one, or the one a swipe brought', async () => {
    const user = userEvent.setup();
    const goTo = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={1} onClose={() => {}} goTo={goTo} goToBlocked={(f) => (f._id === FIXTURE_FIGURES[3]!._id ? 'Not on a shelf' : null)} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Go to' }));
    expect(goTo).toHaveBeenLastCalledWith(FIXTURE_FIGURES[1]);
    act(() => instances[0]!.swipeTo(2));
    await user.click(screen.getByRole('button', { name: 'Go to' }));
    expect(goTo).toHaveBeenLastCalledWith(FIXTURE_FIGURES[2]);
    act(() => instances[0]!.swipeTo(3));
    expect(screen.getByRole('button', { name: 'Go to' })).toBeDisabled();
  });

  it('reports close when photoswipe is dismissed', async () => {
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].destroy(); // user closed the gallery (pinch/vertical drag)
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// PHOTOS-FIND-1 (Ross 10-31: "only one picture per figure"): the viewer's picture says how many photos its figure has when
// it has more than the one shown, and a tap on that opens them; it rides the sheet's top edge at the left, the rail's opposite
describe('FigureViewer: the photos chip', () => {
  const locals = (figures = FIXTURE_FIGURES) => figures.map((f) => ({ ...f, local: { headId: f._id, kind: 'owned', sync: 'known', asOf: null, copies: [] } })) as never;
  const fixturePhotos = (count: number) => {
    setFixtureMode(true);
    window.history.pushState({}, '', `/?fxphotos=1&fxphotocount=${count}`);
  };
  afterEach(() => {
    setFixtureMode(false);
    window.history.pushState({}, '', '/');
  });

  it('stands on the sheet for a figure with five photos, says 5 photos, and opens all five', async () => {
    fixturePhotos(5);
    const user = userEvent.setup();
    renderWithProviders(<FigureViewer figures={locals()} index={0} onClose={() => {}} />);
    const chip = await screen.findByRole('button', { name: '5 photos' });
    expect(chip.closest('.figure-viewer-sheet')).not.toBeNull();
    expect(chip).toHaveClass('figure-viewer-sheet__photos');
    await user.click(chip);
    const sheet = await screen.findByRole('dialog', { name: 'Photos' });
    expect(within(sheet).getAllByRole('button', { name: /^Photo \d/ })).toHaveLength(5);
  });

  it('says nothing for a figure with one photo, nor for one with no local item', async () => {
    fixturePhotos(1);
    const one = renderWithProviders(<FigureViewer figures={locals()} index={0} onClose={() => {}} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    await act(flushAll);
    expect(screen.queryByRole('button', { name: /photos$/ })).toBeNull();
    one.unmount();
    fixturePhotos(5);
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={() => {}} />);
    await act(flushAll);
    expect(screen.queryByRole('button', { name: /photos$/ })).toBeNull();
  });
});
