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
