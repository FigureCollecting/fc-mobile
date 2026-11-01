/**
 * GALLERY-1 (Ross 10-18): the photo a user chose for a figure is the one the case draws, a masked cut-out when the chosen
 * photo has a mask and the plain photo when it has none (the case shows it as it is until a mask lands), and the default
 * again when the choice is forgotten. Through the real Collection page, the kept-image sync and the local store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches } from '../../test/fakeCaches';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';

const url = (c: string) => `https://images.figurecollecting.com/d/${c.repeat(64)}`;

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
  const storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  localSession.value = undefined;
});

/** The figure's list: `a` the primary (a cut-out, it has a mask), `b` a plain photo, `c` a second cut-out. */
const photos = () =>
  create(GetProductImagesResponseSchema, {
    products: [
      {
        headId: headOf(0),
        images: [
          { derivativeId: 'a'.repeat(64), role: 'gallery', primary: true, url: url('a'), width: 550, height: 800, mask: { maskId: 'd'.repeat(64), contentType: 'image/png', url: url('d') } },
          { derivativeId: 'b'.repeat(64), role: 'gallery', primary: false, url: url('b'), width: 600, height: 800 },
          { derivativeId: 'c'.repeat(64), role: 'gallery', primary: false, url: url('c'), width: 500, height: 800, mask: { maskId: 'e'.repeat(64), contentType: 'image/png', url: url('e') } },
        ],
      },
    ],
  });
const drawn = () => document.querySelector<HTMLElement>('button.cab-figure');
/** The photo the case draws: a masked cut-out names its photo and its mask on its element, a plain photo is an <img>. */
const artSrc = () => drawn()?.querySelector('[data-image-url]')?.getAttribute('data-image-url') ?? drawn()?.querySelector('img')?.getAttribute('src');
const maskSrc = () => drawn()?.querySelector('[data-mask-url]')?.getAttribute('data-mask-url');

describe('the case draws the photo the user chose', () => {
  it('the default until a choice, then the chosen cut-out, then the default again when the choice is forgotten', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(artSrc()).toBe(url('a')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('masked');
    expect(maskSrc()).toBe(url('d'));
    act(() => setPhotoChoice('user-a', headOf(0), url('c')));
    await waitFor(() => expect(artSrc()).toBe(url('c')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('masked');
    expect(maskSrc()).toBe(url('e'));
    act(() => setPhotoChoice('user-a', headOf(0), null));
    await waitFor(() => expect(artSrc()).toBe(url('a')), { timeout: 5000 });
  }, 20_000);

  it('a chosen photo with no mask draws as the photo itself, framed, until a mask is made for it', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    setPhotoChoice('user-a', headOf(0), url('b'));
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(artSrc()).toBe(url('b')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('framed');
  });
});

describe('PICK-CASE-1 (Ross 10-31): a photo with no cut-out chosen while the case is open', () => {
  it('draws the chosen photo as it is, not the default cut-out', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(artSrc()).toBe(url('a')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('masked');
    act(() => setPhotoChoice('user-a', headOf(0), url('b')));
    await waitFor(() => expect(artSrc()).toBe(url('b')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('framed');
  }, 20_000);

  it('draws it when the collection\'s image lists cannot be read again (a list call answered 503 on his phone that morning)', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(artSrc()).toBe(url('a')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('masked');
    // from the pick on, the server does not answer a list
    r.clients.getProductImages.mockRejectedValue(new ConnectError('upstream answered 503', Code.Unavailable));
    act(() => setPhotoChoice('user-a', headOf(0), url('b')));
    await waitFor(() => expect(artSrc()).toBe(url('b')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('framed');
  }, 20_000);

  it('draws it before the collection\'s image lists are read again (a large collection reads them for tens of seconds)', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await waitFor(() => expect(artSrc()).toBe(url('a')), { timeout: 5000 });
    // from the pick on, the lists are still being read
    r.clients.getProductImages.mockImplementation(() => new Promise(() => {}));
    act(() => setPhotoChoice('user-a', headOf(0), url('b')));
    await waitFor(() => expect(artSrc()).toBe(url('b')), { timeout: 5000 });
    expect(drawn()!.dataset.art).toBe('framed');
  }, 20_000);
});
