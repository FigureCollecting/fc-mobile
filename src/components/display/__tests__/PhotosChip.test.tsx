// PHOTOS-FIND-1 (Ross 10-31: "only one picture per figure"): on a card's picture, how many photos the figure has when it
// has more than the one shown; a tap opens them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

const photosOf = vi.hoisted(() => ({ data: undefined as unknown, asked: [] as (string | undefined)[] }));
vi.mock('../../../hooks/useProductPhotos', () => ({
  useProductPhotos: (headId: string | undefined) => {
    photosOf.asked.push(headId);
    return { data: photosOf.data };
  },
}));

import { PhotosChip } from '../PhotosChip';

const photos = (n: number) => ({ photos: Array.from({ length: n }, (_, i) => ({ url: `u${i}`, width: 1, height: 1, role: 'gallery', primary: i === 0 })), refreshFailed: false });

beforeEach(() => {
  photosOf.data = undefined;
  photosOf.asked = [];
});
afterEach(cleanup);

describe('PhotosChip', () => {
  it('says nothing while the answer is not in, for no photo and for the one photo shown', () => {
    for (const data of [undefined, photos(0), photos(1)]) {
      photosOf.data = data;
      const { container } = render(<PhotosChip headId="h1" onOpen={vi.fn()} />);
      expect(container.querySelector('button')).toBeNull();
      cleanup();
    }
  });

  it('for more than one: a button named for how many, which opens them', () => {
    photosOf.data = photos(5);
    const onOpen = vi.fn();
    render(<PhotosChip headId="h1" onOpen={onOpen} class="host__photos" />);
    const chip = screen.getByRole('button', { name: '5 photos' });
    expect(chip).toHaveClass('photos-chip', 'host__photos');
    expect(chip).toHaveTextContent('5 photos');
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(photosOf.asked).toContain('h1');
  });

  it('counts the photos the kept list holds when the coordinator could not be asked', () => {
    photosOf.data = { ...photos(2), refreshFailed: true };
    render(<PhotosChip headId="h1" onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: '2 photos' })).toBeInTheDocument();
  });
});
