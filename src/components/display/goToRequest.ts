/**
 * CARD-VIEW-1 part 3: Go to from a card with no case behind it (the figure page, reached from search or Copies and
 * actions). The page leaves the figure's id here and goes to the collection, which takes it up once (Collection.tsx) and
 * goes to it as its own cards' Go to does.
 */
let pending: string | null = null;

/** Ask the collection to go to `figureId` when it next opens. */
export function requestGoTo(figureId: string): void {
  pending = figureId;
}

/** The figure a page asked the collection to go to, once: the next call has none. */
export function takeGoToRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Why Go to has nowhere to go for a figure, in a few words (the card shows it beside the disabled button). */
export const GO_TO_NOT_SHELVED = 'Goods and media are not shelved';
export const GO_TO_NO_FIT = "Doesn't fit the case";
export const GO_TO_FORMER = 'No longer owned: not on a shelf';
