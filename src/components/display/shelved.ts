// What the case shelves (FIGURES-ONLY-1, Ross 10-18): figures only. A towel, a tapestry, a poster (goods) and a
// recording or a book (media) stay in the collection list, the tiles and Info, and are just not stood on a shelf. The
// kind comes from the coordinator's card (the spine's one category table); a product whose card states none, or one
// this build has not heard of, is shelved, as every product was before the card carried a kind.
import { ProductKind } from '@figurecollecting/fc-api-contract';
import type { Figure } from '@figurecollecting/fc-shared';

type Kinded = Figure & { local?: { productKind?: ProductKind } };

export function isShelved(figure: Figure): boolean {
  const kind = (figure as Kinded).local?.productKind;
  return kind !== ProductKind.GOODS && kind !== ProductKind.MEDIA;
}

export interface ShelfSplit<T extends Figure> {
  /** The figures the case stands, in the order given; the very list when none is left off. */
  shelved: readonly T[];
  /** How many goods, and how many media, it leaves off. */
  goods: number;
  media: number;
}

export function splitForShelves<T extends Figure>(figures: readonly T[]): ShelfSplit<T> {
  let goods = 0;
  let media = 0;
  const shelved: T[] = [];
  for (const f of figures) {
    const kind = (f as Kinded).local?.productKind;
    if (kind === ProductKind.GOODS) goods++;
    else if (kind === ProductKind.MEDIA) media++;
    else shelved.push(f);
  }
  return { shelved: goods + media === 0 ? figures : shelved, goods, media };
}

/** The View card's one quiet line, or null when nothing is left off: "22 goods not shelved". */
export function notShelvedLine(goods: number, media: number): string | null {
  const parts = [goods > 0 ? `${goods} goods` : null, media > 0 ? `${media} media` : null].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : `${parts.join(' and ')} not shelved`;
}
