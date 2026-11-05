// LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
// cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
// while the catalogue loads and a row of filter chips stands, the label stands as a strip over the row, the row out of reach
// under it (no tap, no focus, no key); where no row stands no strip is drawn (the bar's own label says it in the case, as
// LOADBAR drew it). A live region says it to screen readers all along, and it is gone the moment the load ends however it
// ends. The page places it round its row (Collection).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { navigate } from 'wouter/use-browser-location';
import { localSession, type LocalSession } from '../../../local/session';
import type { SyncState } from '../../../sync/engine';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';
import { CatalogueLoadBar, LOADBAR_SHOW_DELAY_MS } from '../CatalogueLoadBar';
import { CatalogueLoadStrip } from '../CatalogueLoadStrip';
import { AppliedChips } from '../../collection/AppliedChips';
import { DEFAULT_CAT, DEFAULT_TYPE, type ListFilters } from '../../../hooks/useFigureListParams';

type Loading = SyncState['loading'];
const state = signal<{ loading: Loading }>({ loading: null });
const load = (loading: Loading) => act(() => void (state.value = { loading }));
const status = () => screen.getByRole('status');
const strip = () => document.querySelector('.catalogue-strip');

const DEFAULTS: ListFilters = { status: ['owned'], mfr: [], dist: [], scale: [], origin: [], cat: DEFAULT_CAT, type: DEFAULT_TYPE, tag: [] };
const FILTERED: ListFilters = { ...DEFAULTS, mfr: ['Good Smile Company'] };

/** The collection's slot: the strip round its row of chips, standing (a filter applied) or not (nothing filtered). */
const slot = (standing: boolean) => (
  <CatalogueLoadStrip>
    <AppliedChips filters={standing ? FILTERED : DEFAULTS} defaults={DEFAULTS} shown={standing ? 2 : 7} total={7} onChange={() => {}} />
  </CatalogueLoadStrip>
);

/** The row's chip, and whether it is out of reach: inert, so no tap, no focus and no key reaches it. */
const chip = () => screen.getByRole('listitem', { name: 'Remove filter Good Smile Company' });
const outOfReach = (el: Element) => el.closest('[inert]') !== null;

beforeEach(() => {
  vi.useFakeTimers();
  state.value = { loading: null };
  localSession.value = { engine: { state } } as unknown as LocalSession;
});

afterEach(() => {
  vi.useRealTimers();
  localSession.value = undefined;
  setFixtureMode(false);
  window.history.pushState({}, '', '/');
});

describe('CatalogueLoadStrip', () => {
  it('while nothing loads: the row as it is, in reach, and an empty live region drawn as nothing', () => {
    render(slot(true));
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(chip()).toBeVisible();
    expect(outOfReach(chip())).toBe(false);
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveTextContent('');
    expect(status()).toHaveClass('sr-only');
    expect(strip()).toBeNull();
  });

  it('a load with a row standing: the strip over it says what loads, following the pass, the row out of reach; both back at once when it ends', () => {
    render(slot(true));
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(status()).toBe(strip());
    expect(status()).not.toHaveClass('sr-only');
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveTextContent('Loading catalogue…');
    expect(outOfReach(chip())).toBe(true);
    load({ step: 'cards', done: 120, total: 400 });
    expect(status()).toHaveTextContent('Loading catalogue · 120 of 400');
    // the pass ends (done or failed: the engine sets loading to null in its finally)
    load(null);
    expect(strip()).toBeNull();
    expect(status()).toHaveClass('sr-only');
    expect(status()).toHaveTextContent('');
    expect(outOfReach(chip())).toBe(false);
  });

  it('challenge B1/S1: a load with no row standing draws no strip (nothing under the top bar is covered); the live region still says it', () => {
    render(slot(false));
    load({ step: 'cards', done: 120, total: 400 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(strip()).toBeNull();
    expect(status()).toHaveClass('sr-only');
    expect(status()).toHaveTextContent('Loading catalogue · 120 of 400');
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('the row comes and goes while it loads: the strip with it', () => {
    const { rerender } = render(slot(false));
    load({ step: 'cards', done: 120, total: 400 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(strip()).toBeNull();
    // a filter applied mid-load: the row stands, the strip over it
    act(() => void rerender(slot(true)));
    expect(strip()).toHaveTextContent('Loading catalogue · 120 of 400');
    expect(outOfReach(chip())).toBe(true);
    // the filter cleared (Refine): the row goes, and the strip
    act(() => void rerender(slot(false)));
    expect(strip()).toBeNull();
    expect(status()).toHaveTextContent('Loading catalogue · 120 of 400');
  });

  it('challenge S3: the covered row takes no focus while it loads, and does again once the load ends', () => {
    render(slot(true));
    load({ step: 'cards', done: 120, total: 400 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(chip().closest('[inert]')).toHaveAttribute('inert');
    load(null);
    expect(chip().closest('[inert]')).toBeNull();
    chip().focus();
    expect(document.activeElement).toBe(chip());
  });

  it('a load shorter than the delay never shows (a fast link never flashes it)', () => {
    render(slot(true));
    load({ step: 'cards', done: 0, total: 10 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS - 1));
    expect(strip()).toBeNull();
    expect(outOfReach(chip())).toBe(false);
    load(null);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(strip()).toBeNull();
  });

  it('challenge N2: the collection opened mid-load, once the bar shows it: the strip shows at once with it, not the delay after', () => {
    render(<CatalogueLoadBar />);
    load({ step: 'cards', done: 120, total: 400 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS + 100));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    render(slot(true));
    expect(strip()).toHaveTextContent('Loading catalogue · 120 of 400');
    expect(outOfReach(chip())).toBe(true);
  });

  it('no session: nothing loads, nothing shows', () => {
    localSession.value = undefined;
    render(slot(true));
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(strip()).toBeNull();
  });

  it('the dev fixtures (no session) show it from ?fxloadbar= and drop it when the address drops it, for the e2e', () => {
    localSession.value = undefined;
    setFixtureMode(true);
    window.history.pushState({}, '', '/?layout=case&fxloadbar=cards:120:400');
    render(slot(true));
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(strip()).toHaveTextContent('Loading catalogue · 120 of 400');
    act(() => navigate('/?layout=case', { replace: true }));
    expect(strip()).toBeNull();
    expect(status()).toHaveTextContent('');
  });
});
