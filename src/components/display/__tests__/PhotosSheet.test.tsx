// GALLERY-1 (Ross 10-18): the figure card's Photos tab: every photo of the figure, the one in use marked, a tap to pick one
// and "Use for me" to keep the pick for this user; Info and the case follow (photoChoice.ts, useCollectionImages).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import type { CachedImage } from '../../../media/keptImages';
import { __resetPhotoChoices, readPhotoChoices, setPhotoChoice } from '../../../media/photoChoice';
import { localSession } from '../../../local/session';
import { FIXTURE_SUB, setFixtureMode } from '../../../dev-fixtures/fixtures';

const photosOf = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false }));
vi.mock('../../../hooks/useProductPhotos', () => ({ useProductPhotos: () => ({ data: photosOf.data, isLoading: photosOf.isLoading }) }));

import { PhotosSheet } from '../PhotosSheet';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
const HEAD = '00000000-0000-4000-8000-000000000001';
const photo = (c: string, over: Partial<CachedImage> = {}): CachedImage => ({ url: url(c), width: 600, height: 800, role: 'gallery', primary: false, ...over });
const PHOTOS = [photo('a', { primary: true, maskUrl: url('f') }), photo('b'), photo('c', { maskUrl: url('e') })];

const figure = (copies = 1): Figure =>
  ({ _id: HEAD, name: 'Kurumi', manufacturer: 'M', scale: '1/7', userId: 'u', createdAt: '', updatedAt: '', local: { headId: HEAD, kind: 'owned', copies: Array.from({ length: copies }, (_, i) => ({ occ_id: `o${i}` })) } }) as unknown as Figure;

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  localSession.value = { sub: () => 'user-a' } as unknown as NonNullable<typeof localSession.value>;
  photosOf.data = { photos: PHOTOS, refreshFailed: false };
  photosOf.isLoading = false;
});
afterEach(() => {
  cleanup();
  localSession.value = undefined;
  setFixtureMode(false);
  window.history.pushState({}, '', '/');
});

const open = (over: { copies?: number; onClose?: () => void } = {}) => render(<PhotosSheet figure={figure(over.copies)} open onClose={over.onClose ?? vi.fn()} />);
const tiles = () => screen.getAllByRole('button', { name: /^Photo \d/ });
const useForMe = () => screen.getByRole('button', { name: 'Use for me' });

describe('PhotosSheet', () => {
  it('draws nothing while closed', () => {
    render(<PhotosSheet figure={figure()} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every photo of the figure, the default marked, and the one in use marked', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Photos' })).toBeInTheDocument();
    expect(tiles().map((t) => t.getAttribute('aria-label'))).toEqual(['Photo 1 of 3, the default, in use', 'Photo 2 of 3', 'Photo 3 of 3']);
    expect(screen.getByText('3 photos')).toBeInTheDocument();
    expect(tiles().map((t) => t.querySelector('img')?.getAttribute('src'))).toEqual([url('a'), url('b'), url('c')]);
  });

  it('marks the chosen photo as the one in use, not the default', () => {
    setPhotoChoice('user-a', HEAD, url('c'));
    open();
    expect(tiles().map((t) => t.getAttribute('aria-label'))).toEqual(['Photo 1 of 3, the default', 'Photo 2 of 3', 'Photo 3 of 3, in use']);
  });

  it('a choice the list no longer names is no choice: the default stays in use', () => {
    setPhotoChoice('user-a', HEAD, url('d'));
    open();
    expect(tiles()[0]!.getAttribute('aria-label')).toBe('Photo 1 of 3, the default, in use');
  });

  it('a tap picks a photo (it is pressed), and "Use for me" keeps it for this user and closes the sheet', () => {
    const onClose = vi.fn();
    open({ onClose });
    expect(useForMe()).toBeDisabled();
    fireEvent.click(tiles()[1]!);
    expect(tiles()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(tiles()[0]).toHaveAttribute('aria-pressed', 'false');
    expect(useForMe()).toBeEnabled();
    fireEvent.click(useForMe());
    expect(readPhotoChoices('user-a').get(HEAD)).toBe(url('b'));
    expect(onClose).toHaveBeenCalled();
  });

  it('picking the default again and "Use for me" forgets the choice: back to the default photo', () => {
    setPhotoChoice('user-a', HEAD, url('b'));
    open();
    fireEvent.click(tiles()[0]!);
    fireEvent.click(useForMe());
    expect(readPhotoChoices('user-a').has(HEAD)).toBe(false);
  });

  it('"Use for me" is off for the photo already in use', () => {
    setPhotoChoice('user-a', HEAD, url('b'));
    open();
    expect(tiles()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(useForMe()).toBeDisabled();
  });

  it('says what a photo without a cut-out will look like, and nothing for one that has it', () => {
    open();
    fireEvent.click(tiles()[1]!);
    expect(screen.getByText('No cut-out yet: the case shows this photo as it is.')).toBeInTheDocument();
    fireEvent.click(tiles()[2]!);
    expect(screen.queryByText(/No cut-out yet/)).toBeNull();
  });

  it('says the pick applies to every copy when the figure has several, and says nothing of copies for one', () => {
    open({ copies: 3 });
    expect(screen.getByText('For all 3 copies')).toBeInTheDocument();
    cleanup();
    open({ copies: 1 });
    expect(screen.queryByText(/For all/)).toBeNull();
  });

  it('shows what it is waiting for, and an empty state for a figure with no photo', () => {
    photosOf.data = undefined;
    photosOf.isLoading = true;
    open();
    expect(screen.getByText('Loading photos')).toBeInTheDocument();
    cleanup();
    photosOf.isLoading = false;
    photosOf.data = { photos: [], refreshFailed: false };
    open();
    expect(screen.getByText('No photos of this figure yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use for me' })).toBeNull();
  });

  // PHOTOS-FIND-1: the kept list after a failed ask is said to be that, never shown as if it were the whole answer
  it('says, in one line, that it shows the photos kept on this phone when the coordinator could not be asked', () => {
    photosOf.data = { photos: PHOTOS.slice(0, 1), refreshFailed: true };
    open();
    expect(screen.getByText("Showing photos saved on this phone; couldn't refresh.")).toBeInTheDocument();
    expect(tiles()).toHaveLength(1);
    cleanup();
    photosOf.data = { photos: PHOTOS, refreshFailed: false };
    open();
    expect(screen.queryByText(/couldn't refresh/)).toBeNull();
  });

  it('with nothing kept and the ask failed, it says that, not that the figure has no photos', () => {
    photosOf.data = { photos: [], refreshFailed: true };
    open();
    expect(screen.getByText("No photos saved on this phone; couldn't refresh.")).toBeInTheDocument();
    expect(screen.queryByText('No photos of this figure yet.')).toBeNull();
  });

  it('a photo that fails to load stands as a plate, still pickable', () => {
    open();
    const img = tiles()[1]!.querySelector('img')!;
    fireEvent.error(img);
    expect(tiles()[1]!.querySelector('img')).toBeNull();
    expect(tiles()[1]!.querySelector('.photos-sheet__plate')).not.toBeNull();
    fireEvent.click(tiles()[1]!);
    expect(tiles()[1]).toHaveAttribute('aria-pressed', 'true');
  });

  describe('DESK1: what a tile shows while its photo loads, and when it cannot load', () => {
    const COLOURED = [photo('a', { primary: true, dominantColor: '#8a9bb0' }), photo('b', { dominantColor: '#223344' }), photo('c')];
    const stateOf = (tile: HTMLElement) => tile.getAttribute('data-state');

    it('a tile still loading shows its photo\'s colour', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      open();
      expect(tiles().map(stateOf)).toEqual(['loading', 'loading', 'loading']);
      expect(tiles()[0]!.style.backgroundColor).toBe('rgb(138, 155, 176)');
      expect(tiles()[1]!.style.backgroundColor).toBe('rgb(34, 51, 68)');
      // no colour sent for it: the tile's own surface, never a made-up colour
      expect(tiles()[2]!.style.backgroundColor).toBe('');
      // busy, not renamed: its name stays the photo's
      expect(tiles()[1]).toHaveAttribute('aria-busy', 'true');
      expect(tiles()[1]!.getAttribute('aria-label')).toBe('Photo 2 of 3');
    });

    it('once its photo has loaded the tile is the photo: no colour behind it, and it no longer says loading', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      open();
      fireEvent.load(tiles()[1]!.querySelector('img')!);
      expect(tiles().map(stateOf)).toEqual(['loading', 'loaded', 'loading']);
      expect(tiles()[1]!.style.backgroundColor).toBe('');
      expect(tiles()[1]).not.toHaveAttribute('aria-busy');
      expect(tiles()[1]!.querySelector('img')?.getAttribute('src')).toBe(url('b'));
    });

    it('a photo the browser already has when the sheet opens (no load event to come) is drawn loaded at once', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (this: HTMLImageElement) {
        return this.src === url('a');
      });
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(600);
      open();
      expect(tiles().map(stateOf)).toEqual(['loaded', 'loading', 'loading']);
      vi.restoreAllMocks();
    });

    it('a failed tile says so and looks different from a loading one', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      open();
      fireEvent.error(tiles()[1]!.querySelector('img')!);
      const [loading, failed] = [tiles()[0]!, tiles()[1]!];
      expect(stateOf(failed)).toBe('failed');
      expect(stateOf(loading)).toBe('loading');
      // it says so: in words on the tile, and in its name
      expect(failed.querySelector('.photos-sheet__failed')?.textContent).toBe("Couldn't load");
      expect(failed.getAttribute('aria-label')).toBe("Photo 2 of 3, couldn't load");
      expect(loading.textContent).not.toContain("Couldn't load");
      // and looks different: no photo colour (that is the loading look), its own mark instead
      expect(failed.style.backgroundColor).toBe('');
      expect(failed).not.toHaveAttribute('aria-busy');
      expect(failed.querySelector('.photos-sheet__failed svg')).not.toBeNull();
      expect(loading.querySelector('.photos-sheet__failed')).toBeNull();
      expect(loading.querySelector('img')).not.toBeNull();
      // a photo that loaded and one that failed are told apart too
      fireEvent.load(tiles()[2]!.querySelector('img')!);
      expect(tiles().map(stateOf)).toEqual(['loading', 'failed', 'loaded']);
    });

    it('a failed tile that is tapped is tried again: loading, then loaded on its load event, and it no longer says it couldn\'t load', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      open();
      fireEvent.error(tiles()[1]!.querySelector('img')!);
      expect(stateOf(tiles()[1]!)).toBe('failed');
      fireEvent.click(tiles()[1]!);
      // a fresh <img> for the same address, waiting in the photo's colour again
      expect(stateOf(tiles()[1]!)).toBe('loading');
      expect(tiles()[1]!.querySelector('img')?.getAttribute('src')).toBe(url('b'));
      expect(tiles()[1]!.style.backgroundColor).toBe('rgb(34, 51, 68)');
      expect(tiles()[1]).toHaveAttribute('aria-pressed', 'true');
      fireEvent.load(tiles()[1]!.querySelector('img')!);
      expect(stateOf(tiles()[1]!)).toBe('loaded');
      expect(tiles()[1]!.getAttribute('aria-label')).toBe('Photo 2 of 3');
      expect(screen.queryByText("Couldn't load")).toBeNull();
      // the others are untouched by the retry
      expect(tiles().map(stateOf)).toEqual(['loading', 'loaded', 'loading']);
    });

    it('a failed tile tried again that fails again says so again; a tap on a tile that has not failed changes nothing about it', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      open();
      fireEvent.error(tiles()[1]!.querySelector('img')!);
      fireEvent.click(tiles()[1]!);
      fireEvent.error(tiles()[1]!.querySelector('img')!);
      expect(stateOf(tiles()[1]!)).toBe('failed');
      expect(tiles()[1]!.getAttribute('aria-label')).toBe("Photo 2 of 3, couldn't load");
      fireEvent.load(tiles()[2]!.querySelector('img')!);
      const img = tiles()[2]!.querySelector('img');
      fireEvent.click(tiles()[2]!);
      expect(stateOf(tiles()[2]!)).toBe('loaded');
      expect(tiles()[2]!.querySelector('img')).toBe(img);
      // and a failed tile picked by its neighbour's tap stays failed: only its own tap tries it again
      fireEvent.click(tiles()[0]!);
      expect(stateOf(tiles()[1]!)).toBe('failed');
    });

    it('a picture the browser holds complete but undecoded (naturalWidth 0) is not drawn loaded', () => {
      photosOf.data = { photos: COLOURED, refreshFailed: false };
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
      open();
      expect(tiles().map(stateOf)).toEqual(['loading', 'loading', 'loading']);
      vi.restoreAllMocks();
    });

    it('a colour that is not "#rrggbb" is never put in the tile\'s style', () => {
      photosOf.data = { photos: [photo('a', { primary: true, dominantColor: 'red; background-image: url(https://elsewhere.example/x)' })], refreshFailed: false };
      open();
      expect(tiles()[0]!.getAttribute('style') ?? '').toBe('');
    });

    it('a colour the browser would take but that is not lower-case "#rrggbb" (a name, upper case, short form) is not shown either', () => {
      photosOf.data = { photos: [photo('a', { primary: true, dominantColor: 'red' }), photo('b', { dominantColor: '#ABCDEF' }), photo('c', { dominantColor: '#abc' })], refreshFailed: false };
      open();
      expect(tiles().map((t) => t.getAttribute('style') ?? '')).toEqual(['', '', '']);
      expect(tiles().map(stateOf)).toEqual(['loading', 'loading', 'loading']);
    });

    it('the tile rules give each state a look of its own: the failed plate is dashed, the loading tile pulses unless motion is reduced', () => {
      open();
      const css = Array.from(document.querySelectorAll('style'), (s) => s.textContent).join('\n');
      expect(css).toMatch(/\.photos-sheet__failed\s*\{[^}]*border:[^;}]*dashed/);
      expect(css).toMatch(/\.photos-sheet__tile\[aria-pressed='true'\] \.photos-sheet__failed\s*\{[^}]*border:[^;}]*solid var\(--brand-400\)/);
      expect(css).toMatch(/\.photos-sheet__tile\[data-state='loading'\]::after\s*\{[^}]*animation:/);
      expect(css).toMatch(/prefers-reduced-motion: reduce[^}]*\{\s*\.photos-sheet__tile\[data-state='loading'\]::after\s*\{[^}]*animation: none/);
    });
  });

  it('closes by its Close button, the backdrop and Esc, picking nothing', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close photos' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.photos-sheet__backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(readPhotoChoices('user-a').size).toBe(0);
  });

  it('opens again on what is in use, the pick of the last time forgotten', () => {
    const { rerender } = open();
    fireEvent.click(tiles()[2]!);
    rerender(<PhotosSheet figure={figure()} open={false} onClose={vi.fn()} />);
    rerender(<PhotosSheet figure={figure()} open onClose={vi.fn()} />);
    expect(tiles().every((t) => t.getAttribute('aria-pressed') === (t === tiles()[0] ? 'true' : 'false'))).toBe(true);
  });

  it('a figure with no local item (the fixtures) has no photos to list, and no way to choose', () => {
    photosOf.data = undefined;
    const bare = { _id: 'x', name: 'Rem', manufacturer: '', scale: '', userId: 'u', createdAt: '', updatedAt: '' } as Figure;
    render(<PhotosSheet figure={bare} open onClose={vi.fn()} />);
    expect(screen.getByText('No photos of this figure yet.')).toBeInTheDocument();
  });
});

describe('PhotosSheet on the dev fixtures (?fxphotos=1)', () => {
  it('keeps a pick for the fixtures\' user, with no session', () => {
    setFixtureMode(true);
    window.history.pushState({}, '', '/?fxphotos=1');
    localSession.value = undefined;
    render(<PhotosSheet figure={figure(2)} open onClose={vi.fn()} />);
    fireEvent.click(tiles()[1]!);
    fireEvent.click(useForMe());
    expect(readPhotoChoices(FIXTURE_SUB).get(HEAD)).toBe(url('b'));
  });

  it('has no one to keep a pick for without a session off the fixtures: "Use for me" stays off', () => {
    localSession.value = undefined;
    render(<PhotosSheet figure={figure()} open onClose={vi.fn()} />);
    fireEvent.click(tiles()[1]!);
    expect(useForMe()).toBeDisabled();
  });
});
