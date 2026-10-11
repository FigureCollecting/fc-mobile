// The name a figure is shown under when its card has no title (DISPLAY-2, WK-16 F2): the card's
// title, else its character (with the series), else its maker and scale, else its series, and only
// then "Untitled figure". The card carries no name_en: the spine's display name already falls back
// to it, and that arrives here as the title.
import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ProductCardSchema, type ProductCard } from '@figurecollecting/fc-api-contract';
import { UNTITLED, cardName } from '../cardName';

const card = (texts: Record<string, string>): ProductCard =>
  create(ProductCardSchema, {
    headId: 'h-1',
    ...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, { value: v, asOf: '' }])),
  } as MessageInitShape<typeof ProductCardSchema>);

describe('cardName', () => {
  it('is the title when the card has one', () => {
    expect(cardName(card({ title: 'Kurisu Makise (Figure)', character: 'Kurisu Makise', manufacturer: 'Good Smile Company' }))).toBe('Kurisu Makise (Figure)');
  });

  it('falls back to the character, qualified by the series when the card names one', () => {
    expect(cardName(card({ character: 'Kurisu Makise', series: 'Steins;Gate', manufacturer: 'Good Smile Company', scale: '1/8' }))).toBe('Kurisu Makise (Steins;Gate)');
    expect(cardName(card({ character: 'Kurisu Makise', manufacturer: 'Good Smile Company' }))).toBe('Kurisu Makise');
  });

  it('falls back to the maker and scale when no name is carried', () => {
    expect(cardName(card({ manufacturer: 'Good Smile Company', scale: '1/8' }))).toBe('Good Smile Company 1/8');
    expect(cardName(card({ manufacturer: 'Kotobukiya' }))).toBe('Kotobukiya');
  });

  it('falls back to the series (with the scale) after the maker', () => {
    expect(cardName(card({ series: 'Steins;Gate', scale: '1/7' }))).toBe('Steins;Gate 1/7');
    expect(cardName(card({ series: 'Steins;Gate' }))).toBe('Steins;Gate');
  });

  it('is "Untitled figure" only when nothing names the figure', () => {
    expect(cardName(undefined)).toBe(UNTITLED);
    expect(cardName(card({}))).toBe('Untitled figure');
    expect(cardName(card({ scale: '1/7', releaseYm: '2026-03' }))).toBe('Untitled figure');
  });

  it('treats a blank or whitespace text as absent, never as a name', () => {
    expect(cardName(card({ title: '  ', character: 'Kurisu Makise' }))).toBe('Kurisu Makise');
    expect(cardName(card({ title: '', character: ' ', manufacturer: 'Good Smile Company', scale: ' ' }))).toBe('Good Smile Company');
    expect(cardName(card({ character: 'Kurisu Makise', series: '　' }))).toBe('Kurisu Makise');
  });

  it('shows texts trimmed', () => {
    expect(cardName(card({ title: '  Kurisu Makise  ' }))).toBe('Kurisu Makise');
  });
});
