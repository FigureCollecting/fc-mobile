// The name a figure is shown under (DISPLAY-2, WK-16 F2). The card's title is the spine's display
// name, which already falls back to the spine's Latin name (name_en) when no name claim exists, so
// the card carries no name_en of its own. When the title is absent the card's other texts still
// name the figure better than a placeholder: its character (with the series), then its maker and
// scale, then its series. "Untitled figure" is left for a card that carries none of them.
import type { CardText, ProductCard } from '@figurecollecting/fc-api-contract';

export const UNTITLED = 'Untitled figure';

/** A card text as shown: trimmed, and absent when blank. */
const text = (t: CardText | undefined): string | undefined => t?.value.trim() || undefined;

/** `base`, followed by `extra` when the card has it. */
const withExtra = (base: string, extra: string | undefined, wrap: (s: string) => string): string =>
  extra === undefined ? base : `${base} ${wrap(extra)}`;

export function cardName(card: ProductCard | undefined): string {
  const title = text(card?.title);
  if (title !== undefined) return title;
  const character = text(card?.character);
  const series = text(card?.series);
  const scale = text(card?.scale);
  if (character !== undefined) return withExtra(character, series, (s) => `(${s})`);
  const manufacturer = text(card?.manufacturer);
  if (manufacturer !== undefined) return withExtra(manufacturer, scale, (s) => s);
  if (series !== undefined) return withExtra(series, scale, (s) => s);
  return UNTITLED;
}
