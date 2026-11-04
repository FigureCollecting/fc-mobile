// LOADBAR (Ross 11-03): while the catalogue loads (slow on a weak link) an indicator stands at the top middle: the share of
// the cards loaded where the pass knows how many are due, a moving bar while it pulls (how many pages are to come is not
// known), and gone the moment the pass is done. It is shown only once a load has lasted LOADBAR_SHOW_DELAY_MS, so a fast
// link never flashes it, and it is an indicator, never a control.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { navigate } from 'wouter/use-browser-location';
import { localSession, type LocalSession } from '../../../local/session';
import type { SyncState } from '../../../sync/engine';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';
import { CatalogueLoadBar, LOADBAR_SHOW_DELAY_MS, loadingLabel } from '../CatalogueLoadBar';
import { AppliedChips } from '../../collection/AppliedChips';
import { DEFAULT_CAT, DEFAULT_TYPE, type ListFilters } from '../../../hooks/useFigureListParams';

type Loading = SyncState['loading'];
const state = signal<{ loading: Loading }>({ loading: null });
const load = (loading: Loading) => act(() => void (state.value = { loading }));
const bar = () => document.querySelector<HTMLElement>('.catalogue-loadbar');

beforeEach(() => {
  vi.useFakeTimers();
  state.value = { loading: null };
  localSession.value = { engine: { state } } as unknown as LocalSession;
});

afterEach(() => {
  vi.useRealTimers();
  localSession.value = undefined;
  window.history.pushState({}, '', '/');
  localStorage.clear();
});

describe('CatalogueLoadBar', () => {
  it('shows nothing without a session, nor while nothing of the catalogue loads', () => {
    localSession.value = undefined;
    const { unmount } = render(<CatalogueLoadBar />);
    expect(bar()).toBeNull();
    unmount();
    localSession.value = { engine: { state } } as unknown as LocalSession;
    render(<CatalogueLoadBar />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(bar()).toBeNull();
  });

  it('a load shorter than the delay never shows (a fast link never flashes it)', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'cards', done: 0, total: 10 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS - 1));
    expect(bar()).toBeNull();
    load(null);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(bar()).toBeNull();
  });

  it('the cards: their share loaded, as a progress bar with its value, following the pass; gone at once when done', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'cards', done: 0, total: 450 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const progress = screen.getByRole('progressbar', { name: 'Loading catalogue' });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '450');
    expect(progress).toHaveAttribute('aria-valuenow', '0');
    expect(progress.querySelector<HTMLElement>('.catalogue-loadbar__fill')!.style.width).toBe('0%');
    expect(progress).toHaveTextContent('Loading catalogue · 0 of 450');
    load({ step: 'cards', done: 200, total: 450 });
    expect(progress).toHaveAttribute('aria-valuenow', '200');
    expect(progress.querySelector<HTMLElement>('.catalogue-loadbar__fill')!.style.width).toBe('44.4%');
    expect(progress).toHaveTextContent('Loading catalogue · 200 of 450');
    load(null);
    expect(bar()).toBeNull();
  });

  it('the pull: a moving bar with no value (how much is to come is not known)', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const progress = screen.getByRole('progressbar', { name: 'Loading catalogue' });
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(progress).toHaveClass('catalogue-loadbar--indeterminate');
    expect(progress).toHaveTextContent('Loading catalogue…');
    // the pull then the cards, one load: no new delay between them
    load({ step: 'cards', done: 0, total: 3 });
    expect(screen.getByRole('progressbar')).not.toHaveClass('catalogue-loadbar--indeterminate');
  });

  it('a load after one that ended waits the delay again', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(bar()).not.toBeNull();
    load(null);
    load({ step: 'pull', pages: 0 });
    expect(bar()).toBeNull();
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(bar()).not.toBeNull();
  });

  it('gone when it unmounts part way, its timer with it', () => {
    const { unmount } = render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    unmount();
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(bar()).toBeNull();
  });

  // LOADBAR-2 (challenge N2): the bar stands for the whole app while the collection's load strip comes with its page; both
  // read the load through useCatalogueLoading, and one drawn part way through a load keeps the time the load began.
  const bars = () => document.querySelectorAll('.catalogue-loadbar').length;

  it('LOADBAR-2: a reader drawn once the load shows (the collection opened mid-load) shows it at once, not the delay after', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS + 100));
    expect(bars()).toBe(1);
    render(<CatalogueLoadBar />);
    expect(bars()).toBe(2);
    // the load ends: both go at once; the next waits the delay in both
    load(null);
    expect(bars()).toBe(0);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS - 1));
    expect(bars()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(bars()).toBe(2);
  });

  it('LOADBAR-2: a reader drawn part way through the delay shows it with the first, when the load has lasted the delay', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(400));
    render(<CatalogueLoadBar />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS - 400 - 1));
    expect(bars()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(bars()).toBe(2);
  });

  it('LOADBAR-2: once every reader has gone, one drawn later waits the delay afresh (no time is kept with no one to see the load end)', () => {
    const first = render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(bars()).toBe(1);
    first.unmount();
    render(<CatalogueLoadBar />);
    expect(bars()).toBe(0);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(bars()).toBe(1);
  });

  it('on a screen whose top holds a control (Search: its field), the label is left to screen readers, not drawn over it; the bar stays', () => {
    window.history.pushState({}, '', '/discover');
    render(<CatalogueLoadBar />);
    load({ step: 'cards', done: 3, total: 10 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const progress = screen.getByRole('progressbar', { name: 'Loading catalogue' });
    expect(progress).toHaveTextContent('Loading catalogue · 3 of 10');
    expect(progress.querySelector('.catalogue-loadbar__track')).not.toBeNull();
    expect(progress.querySelector('.catalogue-loadbar__label')).toBeNull();
    expect(progress.querySelector('span')).toHaveClass('sr-only');
  });

  it.each([
    ['the collection in rows (a figure tile under it)', '/?layout=rows', null],
    ['the collection kept in rows (no layout in the address)', '/', 'rows'],
  ])('on %s, the label is left to screen readers too', (_name, path, stored) => {
    if (stored) localStorage.setItem('fc-list-layout', stored);
    window.history.pushState({}, '', path);
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(screen.getByRole('progressbar').querySelector('span')).toHaveClass('sr-only');
  });

  it('follows the screen while it shows: the collection switched to rows, then to Search, then back to the case', () => {
    window.history.pushState({}, '', '/?layout=case');
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const label = () => screen.getByRole('progressbar').querySelector('span');
    expect(label()).toHaveClass('catalogue-loadbar__label');
    act(() => navigate('/?layout=rows', { replace: true }));
    expect(label()).toHaveClass('sr-only');
    act(() => navigate('/discover'));
    expect(label()).toHaveClass('sr-only');
    act(() => navigate('/?layout=case'));
    expect(label()).toHaveClass('catalogue-loadbar__label');
  });

  it.each(['/stats', '/settings', '/profile'])('on %s (its counts, or controls scrolled under it) the label is left to screen readers', (path) => {
    window.history.pushState({}, '', path);
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(screen.getByRole('progressbar').querySelector('span')).toHaveClass('sr-only');
  });

  it('on the case view, while its row of filter chips stands under the top bar, the label is left to screen readers; drawn again once the row goes', () => {
    const filters: ListFilters = { status: ['owned'], mfr: [], dist: [], scale: [], origin: [], cat: DEFAULT_CAT, type: DEFAULT_TYPE, tag: [] };
    window.history.pushState({}, '', '/?layout=case&mfr=Good%20Smile%20Company');
    const chips = render(<AppliedChips filters={{ ...filters, mfr: ['Good Smile Company'] }} defaults={filters} shown={2} total={7} onChange={() => {}} />);
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const label = () => screen.getByRole('progressbar').querySelector('span');
    expect(label()).toHaveClass('sr-only');
    // the filter removed with no address change, and nothing hidden: the row goes and the label is drawn
    act(() => chips.rerender(<AppliedChips filters={filters} defaults={filters} shown={7} total={7} onChange={() => {}} />));
    expect(label()).toHaveClass('catalogue-loadbar__label');
    // the defaults alone hiding figures (a garage kit is not Prepainted) show the row with no filter in the address
    act(() => navigate('/?layout=case', { replace: true }));
    act(() => chips.rerender(<AppliedChips filters={filters} defaults={filters} shown={5} total={7} onChange={() => {}} />));
    expect(label()).toHaveClass('sr-only');
    act(() => void chips.unmount());
    expect(label()).toHaveClass('catalogue-loadbar__label');
  });

  it.each(['/', '/?layout=case'])('on %s (nothing to tap or read under it) the label is drawn', (path) => {
    window.history.pushState({}, '', path);
    render(<CatalogueLoadBar />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    const label = screen.getByRole('progressbar').querySelector('span');
    expect(label).toHaveClass('catalogue-loadbar__label');
    expect(label).not.toHaveClass('sr-only');
  });

  it('the dev fixtures (no session) show it from ?fxloadbar=, for the sign-off shots', () => {
    localSession.value = undefined;
    setFixtureMode(true);
    window.history.pushState({}, '', '/?fxloadbar=cards:120:400');
    render(<CatalogueLoadBar />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(screen.getByRole('progressbar')).toHaveTextContent('Loading catalogue · 120 of 400');
  });
});

describe('loadingLabel', () => {
  it('names the share of the cards, or a pull with nothing known to come', () => {
    expect(loadingLabel({ step: 'pull', pages: 3 })).toBe('Loading catalogue…');
    expect(loadingLabel({ step: 'cards', done: 1200, total: 1500 })).toBe('Loading catalogue · 1,200 of 1,500');
  });
});
