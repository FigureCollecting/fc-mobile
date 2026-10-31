// PHOTOS-FIND-1, items 6-8 (Ross 10-31: "our gallery card is slideable and they can inspect the tapped image behind by using the
// slider"): a photo tapped in the Photos sheet is the large picture behind it; the sheet slides down to a peek strip and back up;
// next and previous step through the photos, by buttons and by a swipe on the picture behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Figure } from '@figurecollecting/fc-shared';
import type { CachedImage } from '../../../media/keptImages';
import { __resetPhotoChoices } from '../../../media/photoChoice';
import { localSession } from '../../../local/session';

const photosOf = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false }));
vi.mock('../../../hooks/useProductPhotos', () => ({ useProductPhotos: () => ({ data: photosOf.data, isLoading: photosOf.isLoading }) }));

import { PhotosSheet } from '../PhotosSheet';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
const HEAD = '00000000-0000-4000-8000-000000000001';
const photo = (c: string, primary = false): CachedImage => ({ url: url(c), width: 600, height: 800, role: 'gallery', primary });
const FIVE = [photo('a', true), photo('b'), photo('c'), photo('d'), photo('e')];
const figure = { _id: HEAD, name: 'Kurumi', manufacturer: 'M', scale: '1/7', userId: 'u', createdAt: '', updatedAt: '', local: { headId: HEAD, kind: 'owned', copies: [{ occ_id: 'o0' }] } } as unknown as Figure;

let scrolled: Element[];
beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  localSession.value = { sub: () => 'user-a' } as unknown as NonNullable<typeof localSession.value>;
  photosOf.data = { photos: FIVE, refreshFailed: false };
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  cleanup();
  localSession.value = undefined;
  vi.restoreAllMocks();
});

const open = (onAim = vi.fn(), onClose = vi.fn()) => ({ onAim, onClose, ...render(<PhotosSheet figure={figure} open onClose={onClose} onAim={onAim} />) });
const tiles = () => screen.getAllByRole('button', { name: /^Photo \d/ });
const pressed = () => tiles().findIndex((t) => t.getAttribute('aria-pressed') === 'true');
const backdrop = () => document.querySelector<HTMLElement>('.photos-sheet__backdrop')!;
const sheet = () => document.querySelector<HTMLElement>('.photos-sheet')!;
const swipe = (dx: number, dy = 0) => {
  fireEvent.pointerDown(backdrop(), { pointerId: 7, clientX: 200, clientY: 300, button: 0 });
  fireEvent.pointerUp(backdrop(), { pointerId: 7, clientX: 200 + dx, clientY: 300 + dy, button: 0 });
  fireEvent.click(backdrop());
};

describe('PhotosSheet: the picture behind it follows the photo picked', () => {
  it('a tap on a photo presses it and hands it to the host as the large picture; opening alone hands nothing', () => {
    const { onAim } = open();
    expect(onAim).not.toHaveBeenCalled();
    fireEvent.click(tiles()[2]!);
    expect(pressed()).toBe(2);
    expect(onAim).toHaveBeenLastCalledWith(url('c'));
  });

  it('closing hands the host nothing: its own picture stands again', () => {
    const { onAim, rerender, onClose } = open();
    fireEvent.click(tiles()[3]!);
    rerender(<PhotosSheet figure={figure} open={false} onClose={onClose} onAim={onAim} />);
    expect(onAim).toHaveBeenLastCalledWith(undefined);
  });
});

describe('PhotosSheet: next and previous', () => {
  it('Next photo and Previous photo step through the photos; the one aimed is pressed, handed on and scrolled into view', async () => {
    const user = userEvent.setup();
    const { onAim } = open();
    const prev = screen.getByRole('button', { name: 'Previous photo' });
    const next = screen.getByRole('button', { name: 'Next photo' });
    expect(prev).toBeDisabled();
    await user.click(next);
    expect(pressed()).toBe(1);
    expect(onAim).toHaveBeenLastCalledWith(url('b'));
    expect(scrolled.at(-1)).toBe(tiles()[1]);
    await user.click(next);
    await user.click(next);
    await user.click(next);
    expect(pressed()).toBe(4);
    expect(next).toBeDisabled();
    await user.click(prev);
    expect(pressed()).toBe(3);
    expect(onAim).toHaveBeenLastCalledWith(url('d'));
    expect(scrolled.at(-1)).toBe(tiles()[3]);
  });

  it('steps from the photo in use when nothing is picked yet', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const { setPhotoChoice } = await import('../../../media/photoChoice');
    setPhotoChoice('user-a', HEAD, url('c'));
    open();
    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(pressed()).toBe(3);
  });

  it('a swipe on the picture behind steps too: to the left is the next, to the right the previous, and neither closes the sheet', () => {
    const { onAim, onClose } = open();
    swipe(-80);
    expect(pressed()).toBe(1);
    swipe(-80);
    expect(pressed()).toBe(2);
    swipe(90);
    expect(pressed()).toBe(1);
    expect(onAim).toHaveBeenLastCalledWith(url('b'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a swipe past either end steps nowhere', () => {
    const { onAim } = open();
    swipe(90);
    expect(pressed()).toBe(0);
    expect(onAim).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) swipe(-80);
    swipe(-80);
    expect(pressed()).toBe(4);
    expect(onAim).toHaveBeenCalledTimes(4);
  });

  it('a short or an upright move on the picture behind is no swipe; a tap there still closes the sheet', () => {
    const { onAim, onClose } = open();
    fireEvent.pointerDown(backdrop(), { pointerId: 3, clientX: 200, clientY: 300, button: 0 });
    fireEvent.pointerUp(backdrop(), { pointerId: 3, clientX: 230, clientY: 300, button: 0 });
    fireEvent.pointerDown(backdrop(), { pointerId: 4, clientX: 200, clientY: 300, button: 0 });
    fireEvent.pointerUp(backdrop(), { pointerId: 4, clientX: 260, clientY: 400, button: 0 });
    fireEvent.pointerDown(backdrop(), { pointerId: 5, clientX: 200, clientY: 300, button: 0 });
    fireEvent.pointerCancel(backdrop(), { pointerId: 5 });
    fireEvent.pointerUp(backdrop(), { pointerId: 5, clientX: 100, clientY: 300, button: 0 });
    expect(onAim).not.toHaveBeenCalled();
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('one photo: nothing to step to, so no Previous or Next', () => {
    photosOf.data = { photos: [photo('a', true)], refreshFailed: false };
    open();
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull();
  });
});

describe('PhotosSheet: it slides down to a peek strip and back up', () => {
  /** jsdom lays nothing out: the sheet is 500 px tall and its first row of photos ends 200 px down it. */
  function laidOut() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('photos-sheet') ? 500 : 0;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: 0, bottom: this.classList.contains('photos-sheet__tile') ? 200 : 0 } as DOMRect;
    });
  }
  const PEEK_Y = 500 - 200 - 12;

  it('its handle lowers it to the strip and raises it again, by tap and by key; at the strip a tap on the picture does not close it', async () => {
    laidOut();
    const user = userEvent.setup();
    const { onClose } = open();
    const handle = screen.getByRole('button', { name: 'Show the large picture' });
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(sheet().dataset.detent).toBe('all');
    await user.click(handle);
    expect(sheet().dataset.detent).toBe('peek');
    await waitFor(() => expect(sheet().style.transform).toBe(`translateY(${PEEK_Y}px)`));
    const raise = screen.getByRole('button', { name: 'Show all photos' });
    expect(raise).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    // a strip: the photos stay, the next and previous with them
    expect(tiles()).toHaveLength(5);
    raise.focus();
    await user.keyboard('{Enter}');
    expect(sheet().dataset.detent).toBe('all');
    await waitFor(() => expect(['none', 'translateY(0px)']).toContain(sheet().style.transform));
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('at the strip, a sideways move along the photos is the strip\'s own, kept from the sheet; an upright one still reaches it', async () => {
    laidOut();
    const user = userEvent.setup();
    open();
    const body = document.querySelector<HTMLElement>('.photos-sheet__body')!;
    const grid = document.querySelector<HTMLElement>('.photos-sheet__grid')!;
    const heard = vi.fn();
    body.addEventListener('touchmove', heard);
    // all up, the grid scrolls with the body: its moves reach the sheet whichever way they go
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 50 }] });
    fireEvent.touchMove(grid, { touches: [{ clientX: 60, clientY: 48 }] });
    expect(heard).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Show the large picture' }));
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 50 }] });
    fireEvent.touchMove(grid, { touches: [{ clientX: 60, clientY: 48 }] });
    expect(heard).toHaveBeenCalledTimes(1);
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 50 }] });
    fireEvent.touchMove(grid, { touches: [{ clientX: 98, clientY: 20 }] });
    expect(heard).toHaveBeenCalledTimes(2);
    fireEvent.touchStart(grid, { touches: [] });
    fireEvent.touchMove(grid, { touches: [{ clientX: 10, clientY: 20 }] });
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('a photo picked at the strip is still handed on, and scrolled into view along it', async () => {
    laidOut();
    const user = userEvent.setup();
    const { onAim } = open();
    await user.click(screen.getByRole('button', { name: 'Show the large picture' }));
    await act(async () => {
      swipe(-80);
    });
    expect(onAim).toHaveBeenLastCalledWith(url('b'));
    expect(scrolled.at(-1)).toBe(tiles()[1]);
  });
});
