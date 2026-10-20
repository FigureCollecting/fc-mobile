// GALLERY-1 (Ross 10-18): the photo the user chose to display for a figure, kept per user on the device. The seam for the
// synced facet that will replace it (a contract family, not built): readers ask this module, never storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/preact';
import { MAX_PHOTO_CHOICES, PHOTO_CHOICES_KEY, readPhotoChoices, setPhotoChoice, usePhotoChoices, __resetPhotoChoices } from '../photoChoice';
import { localSession } from '../../local/session';

const A = `https://images.figurecollecting.com/d/${'a'.repeat(64)}`;
const B = `https://images.figurecollecting.com/d/${'b'.repeat(64)}`;
const HEAD = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
});
afterEach(() => {
  localSession.value = undefined;
  vi.restoreAllMocks();
});

describe('the choice, per user', () => {
  it('reads nothing for a user who chose nothing, and what a user chose after setting it', () => {
    expect(readPhotoChoices('u1').size).toBe(0);
    setPhotoChoice('u1', HEAD(1), A);
    expect([...readPhotoChoices('u1')]).toEqual([[HEAD(1), A]]);
  });

  it('keeps each user\'s choices to that user: another sub on the same device sees none of them', () => {
    setPhotoChoice('u1', HEAD(1), A);
    setPhotoChoice('u2', HEAD(1), B);
    expect(readPhotoChoices('u1').get(HEAD(1))).toBe(A);
    expect(readPhotoChoices('u2').get(HEAD(1))).toBe(B);
    expect(readPhotoChoices(undefined).size).toBe(0);
  });

  it('survives a restart: written to the device, read back by a fresh reader', () => {
    setPhotoChoice('u1', HEAD(1), A);
    __resetPhotoChoices();
    expect(readPhotoChoices('u1').get(HEAD(1))).toBe(A);
    expect(JSON.parse(localStorage.getItem(PHOTO_CHOICES_KEY('u1'))!)).toEqual({ [HEAD(1)]: A });
  });

  it('a new choice replaces the old; null forgets it (back to the default photo)', () => {
    setPhotoChoice('u1', HEAD(1), A);
    setPhotoChoice('u1', HEAD(1), B);
    expect(readPhotoChoices('u1').get(HEAD(1))).toBe(B);
    setPhotoChoice('u1', HEAD(1), null);
    expect(readPhotoChoices('u1').has(HEAD(1))).toBe(false);
    expect(JSON.parse(localStorage.getItem(PHOTO_CHOICES_KEY('u1'))!)).toEqual({});
  });
});

describe('what it will and will not keep', () => {
  it('keeps only an address on the public image address: nothing else is ever fetched for a choice', () => {
    setPhotoChoice('u1', HEAD(1), 'https://elsewhere.example/x.jpg');
    setPhotoChoice('u1', HEAD(2), `${A}?x=1`);
    expect(readPhotoChoices('u1').size).toBe(0);
    setPhotoChoice('u1', HEAD(3), A);
    expect(readPhotoChoices('u1').size).toBe(1);
  });

  it('drops what a damaged or tampered record holds, and keeps what is sound in it', () => {
    localStorage.setItem(PHOTO_CHOICES_KEY('u1'), JSON.stringify({ [HEAD(1)]: A, [HEAD(2)]: 'https://elsewhere.example/x.jpg', [HEAD(3)]: 7, '': A }));
    expect([...readPhotoChoices('u1')]).toEqual([[HEAD(1), A]]);
    localStorage.setItem(PHOTO_CHOICES_KEY('u1'), 'not json');
    __resetPhotoChoices();
    expect(readPhotoChoices('u1').size).toBe(0);
    localStorage.setItem(PHOTO_CHOICES_KEY('u1'), JSON.stringify([1, 2]));
    __resetPhotoChoices();
    expect(readPhotoChoices('u1').size).toBe(0);
  });

  /** A device that already holds `n` choices (written as a record: one write each would copy the whole record each time). */
  const holding = (n: number) => {
    localStorage.setItem(PHOTO_CHOICES_KEY('u1'), JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [HEAD(i), A]))));
    __resetPhotoChoices();
  };

  it('keeps at most MAX_PHOTO_CHOICES, the oldest choice going first', () => {
    holding(MAX_PHOTO_CHOICES);
    for (let i = MAX_PHOTO_CHOICES; i < MAX_PHOTO_CHOICES + 3; i++) setPhotoChoice('u1', HEAD(i), B);
    const kept = readPhotoChoices('u1');
    expect(kept.size).toBe(MAX_PHOTO_CHOICES);
    for (let i = 0; i < 3; i++) expect(kept.has(HEAD(i))).toBe(false);
    expect(kept.has(HEAD(3))).toBe(true);
    expect(kept.has(HEAD(MAX_PHOTO_CHOICES + 2))).toBe(true);
  });

  it('a choice made again counts as the newest', () => {
    holding(MAX_PHOTO_CHOICES);
    setPhotoChoice('u1', HEAD(0), B);
    setPhotoChoice('u1', HEAD(MAX_PHOTO_CHOICES), A);
    expect(readPhotoChoices('u1').get(HEAD(0))).toBe(B);
    expect(readPhotoChoices('u1').has(HEAD(1))).toBe(false);
  });

  it('works for the session when the device refuses the write (full, or storage off): the choice stands in memory', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => setPhotoChoice('u1', HEAD(1), A)).not.toThrow();
    expect(readPhotoChoices('u1').get(HEAD(1))).toBe(A);
  });
});

describe('usePhotoChoices', () => {
  const session = (sub: string | undefined) => ({ sub: () => sub }) as unknown as NonNullable<typeof localSession.value>;
  const seen: ReadonlyMap<string, string>[] = [];
  function Probe() {
    seen.push(usePhotoChoices());
    return null;
  }
  const latest = () => seen[seen.length - 1]!;

  it('answers the signed-in user\'s choices, and the same map until something changes', () => {
    seen.length = 0;
    localSession.value = session('u1');
    setPhotoChoice('u1', HEAD(1), A);
    const { rerender } = render(<Probe />);
    expect(latest().get(HEAD(1))).toBe(A);
    const first = latest();
    rerender(<Probe />);
    expect(latest()).toBe(first);
  });

  it('is told at once when a choice is made or forgotten, so Info and the case follow it', () => {
    seen.length = 0;
    localSession.value = session('u1');
    render(<Probe />);
    expect(latest().size).toBe(0);
    act(() => setPhotoChoice('u1', HEAD(1), A));
    expect(latest().get(HEAD(1))).toBe(A);
    act(() => setPhotoChoice('u1', HEAD(1), null));
    expect(latest().size).toBe(0);
  });

  it('is told when another tab of the app changes the stored choices', () => {
    seen.length = 0;
    localSession.value = session('u1');
    render(<Probe />);
    // another document wrote the record: this one only hears the storage event
    localStorage.setItem(PHOTO_CHOICES_KEY('u1'), JSON.stringify({ [HEAD(5)]: B }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: PHOTO_CHOICES_KEY('u1') }));
    });
    expect(latest().get(HEAD(5))).toBe(B);
  });

  it('answers none while signed out', () => {
    seen.length = 0;
    render(<Probe />);
    expect(latest().size).toBe(0);
  });
});
