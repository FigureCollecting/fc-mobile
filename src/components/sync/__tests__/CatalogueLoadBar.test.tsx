// LOADBAR (Ross 11-03): while the catalogue loads (slow on a weak link) an indicator stands at the top middle: the share of
// the cards loaded where the pass knows how many are due, a moving bar while it pulls (how many pages are to come is not
// known), and gone the moment the pass is done. It is shown only once a load has lasted LOADBAR_SHOW_DELAY_MS, so a fast
// link never flashes it, and it is an indicator, never a control.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { localSession, type LocalSession } from '../../../local/session';
import type { SyncState } from '../../../sync/engine';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';
import { CatalogueLoadBar, LOADBAR_SHOW_DELAY_MS, loadingLabel } from '../CatalogueLoadBar';

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
