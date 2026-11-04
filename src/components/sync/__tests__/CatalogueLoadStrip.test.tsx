// LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
// cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
// while the catalogue loads, its label stands as a full-width strip over the filter chips row's place, saying so to screen
// readers as it changes, and is gone the moment the load ends however it ends. The page places it (Collection).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { navigate } from 'wouter/use-browser-location';
import { localSession, type LocalSession } from '../../../local/session';
import type { SyncState } from '../../../sync/engine';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';
import { LOADBAR_SHOW_DELAY_MS } from '../CatalogueLoadBar';
import { CatalogueLoadStrip } from '../CatalogueLoadStrip';

type Loading = SyncState['loading'];
const state = signal<{ loading: Loading }>({ loading: null });
const load = (loading: Loading) => act(() => void (state.value = { loading }));
const status = () => screen.getByRole('status');

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
  it('while nothing loads: an empty live region, drawn as nothing (no strip, nothing to tap)', () => {
    render(<CatalogueLoadStrip />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveTextContent('');
    expect(status()).toHaveClass('sr-only');
    expect(status()).not.toHaveClass('catalogue-strip');
  });

  it('a load: the strip says what loads, politely to screen readers, following the pass; gone at once when it ends', () => {
    render(<CatalogueLoadStrip />);
    load({ step: 'pull', pages: 0 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(status()).toHaveClass('catalogue-strip');
    expect(status()).not.toHaveClass('sr-only');
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveTextContent('Loading catalogue…');
    load({ step: 'cards', done: 120, total: 400 });
    expect(status()).toHaveTextContent('Loading catalogue · 120 of 400');
    // the pass ends (done or failed: the engine sets loading to null in its finally)
    load(null);
    expect(status()).toHaveClass('sr-only');
    expect(status()).not.toHaveClass('catalogue-strip');
    expect(status()).toHaveTextContent('');
  });

  it('a load shorter than the delay never shows (a fast link never flashes it)', () => {
    render(<CatalogueLoadStrip />);
    load({ step: 'cards', done: 0, total: 10 });
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS - 1));
    expect(status()).not.toHaveClass('catalogue-strip');
    load(null);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(status()).not.toHaveClass('catalogue-strip');
  });

  it('no session: nothing loads, nothing shows', () => {
    localSession.value = undefined;
    render(<CatalogueLoadStrip />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS * 2));
    expect(status()).not.toHaveClass('catalogue-strip');
  });

  it('the dev fixtures (no session) show it from ?fxloadbar= and drop it when the address drops it, for the e2e', () => {
    localSession.value = undefined;
    setFixtureMode(true);
    window.history.pushState({}, '', '/?layout=case&fxloadbar=cards:120:400');
    render(<CatalogueLoadStrip />);
    act(() => void vi.advanceTimersByTime(LOADBAR_SHOW_DELAY_MS));
    expect(status()).toHaveTextContent('Loading catalogue · 120 of 400');
    act(() => navigate('/?layout=case', { replace: true }));
    expect(status()).not.toHaveClass('catalogue-strip');
    expect(status()).toHaveTextContent('');
  });
});
