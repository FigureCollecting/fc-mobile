import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
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

  it('reports close when photoswipe is dismissed', async () => {
    const onClose = vi.fn();
    renderWithProviders(<FigureViewer figures={FIXTURE_FIGURES} index={0} onClose={onClose} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    instances[0].destroy(); // user closed the gallery (pinch/vertical drag)
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
