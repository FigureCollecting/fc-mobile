// The screens' read model: the local store's facets and product cards as the Figure shape the
// pages already bind to. One item per figure and kind (a tab), its copies stacked xN, product
// facts from the card, and never an image: no figure.imageUrl and no displayMeta, ever (MG-2).
import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ProductCardSchema, ufFacetKey, type ProductCard } from '@figurecollecting/fc-api-contract';
import type { FacetRecord, ProductRecord } from '../../storage/records';
import { indexFacet } from '../../sync/facetIndex';
import { C, H, O, STAMP, collection, copy, note, row } from '../../sync/__tests__/viewFixtures';
import { buildFigures, figureOf, jan13, type FigureInputs } from '../figures';

const AS_OF = '2026-10-01T09:30:00.000000Z';

function card(head: string, extra: Record<string, unknown> = {}): ProductCard {
  const init = {
    headId: head,
    requestedAs: [{ ref: { case: 'headId', value: head } }],
    title: { value: `Figure ${head.slice(0, 4)}`, asOf: AS_OF },
    manufacturer: { value: 'Good Smile Company', asOf: AS_OF },
    series: { value: 'Vocaloid', asOf: AS_OF },
    character: { value: 'Hatsune Miku', asOf: AS_OF },
    scale: { value: '1/7', asOf: AS_OF },
    releaseYm: { value: '2026-03', asOf: AS_OF },
    gtin14s: ['04580416940986'],
    heightMm: 250,
    ...extra,
  };
  return create(ProductCardSchema, init as MessageInitShape<typeof ProductCardSchema>);
}

const product = (c: ProductCard, asOf: string | null = AS_OF): ProductRecord => ({ sub: 'user-a', head_id: c.headId, card: c, as_of: asOf, fetched_at: 0 });

const inputs = (facets: FacetRecord[], products: ProductRecord[] = [], stale = false): FigureInputs => ({ sub: 'user-a', facets, products, stale });

/** A row whose value is an unanswered local edit. */
const pending = (rec: FacetRecord): FacetRecord => ({ ...rec, pending_id: 7 });

/** A uf row at an exact version. */
function ufAt(head: string, field: 'score' | 'note' | 'wishability', value: unknown, version: string): FacetRecord {
  const v = { version, op: 'upsert' as const, payload: JSON.stringify({ [field]: value, ...STAMP }) };
  return indexFacet({ sub: 'user-a', facet_key: ufFacetKey(head, field), value: v, known: v, pending_id: null, overwritten: null });
}

describe('buildFigures', () => {
  it('maps one copy and its card onto the Figure shape, with no image of any kind', () => {
    const facets = [...copy(O[0], H[0], 'owned'), note(H[0], 'boxed')];
    const [f, ...rest] = buildFigures(inputs(facets, [product(card(H[0]))]));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      _id: H[0],
      name: 'Figure 1b4e',
      manufacturer: 'Good Smile Company',
      scale: '1/7',
      origin: 'Vocaloid',
      jan: '4580416940986',
      collectionStatus: 'owned',
      quantity: 1,
      note: 'boxed',
      userId: 'user-a',
      dimensions: { heightMm: 250 },
      releases: [{ date: '2026-03' }],
      createdAt: STAMP.edited_at,
      local: { headId: H[0], kind: 'owned', sync: 'known', asOf: AS_OF, hasCard: true, character: 'Hatsune Miku', series: 'Vocaloid' },
    });
    expect(f!.imageUrl).toBeUndefined();
    expect(f!.displayMeta).toBeUndefined();
    expect('imageUrl' in f!).toBe(false);
    expect(f!.local.copies.map((c) => c.occ_id)).toEqual([O[0]]);
  });

  it('stacks the copies of one figure and kind into one item (xN), and keeps each kind its own item', () => {
    const facets = [...copy(O[0], H[0], 'owned'), ...copy(O[1], H[0], 'owned'), ...copy(O[2], H[0], 'wished'), ...copy(O[3], H[1], 'ordered')];
    const figs = buildFigures(inputs(facets));
    expect(figs.map((f) => [f._id, f.local.kind, f.quantity, f.local.copies.map((c) => c.occ_id)])).toEqual([
      [H[0], 'owned', 2, [O[0], O[1]]],
      [H[0], 'wished', 1, [O[2]]],
      [H[1], 'ordered', 1, [O[3]]],
    ]);
  });

  it('names a figure with no card yet by placeholder, with no card facts', () => {
    const [f] = buildFigures(inputs(copy(O[0], H[0], 'wished')));
    expect(f).toMatchObject({ name: 'Untitled figure', manufacturer: '', scale: '', collectionStatus: 'wished', local: { hasCard: false, asOf: null, character: null } });
    expect(f!.jan).toBeUndefined();
    expect(f!.dimensions).toBeUndefined();
    expect(f!.releases).toBeUndefined();
  });

  it("lists former copies as their own item, with the copies' disposals and no collection status", () => {
    const facets = [...copy(O[0], H[0], 'former'), row(`occ/${O[0]}/disposal`, { reason: 'sold', on: '2026-10-01', counterparty: 'Kai' })];
    const [f] = buildFigures(inputs(facets));
    expect(f!.local.kind).toBe('former');
    expect(f!.collectionStatus).toBeUndefined();
    expect(f!.local.copies[0]!.disposal).toMatchObject({ reason: 'sold', counterparty: 'Kai' });
  });

  it('leaves out removed, hidden and headless copies', () => {
    const facets = [...copy(O[0], H[0], null), ...copy(O[1], null, 'owned'), ...copy(O[2], H[1], 'owned')];
    expect(buildFigures(inputs(facets)).map((f) => f._id)).toEqual([H[1]]);
  });

  it('badges an item pending while any of its copy or figure facets holds an unanswered edit', () => {
    const [h0, s0] = copy(O[0], H[0], 'owned');
    const facets = [h0!, s0!, ...copy(O[1], H[1], 'owned'), pending(note(H[1], 'x')), ...copy(O[2], H[2], 'owned')];
    facets[1] = pending(s0!);
    expect(buildFigures(inputs(facets)).map((f) => [f._id, f.local.sync])).toEqual([
      [H[0], 'pending'],
      [H[1], 'pending'],
      [H[2], 'known'],
    ]);
  });

  it('badges every settled item offline-stale while the server is out of reach, a pending one still pending', () => {
    const facets = [...copy(O[0], H[0], 'owned'), pending(note(H[0], 'x')), ...copy(O[1], H[1], 'owned')];
    expect(buildFigures(inputs(facets, [], true)).map((f) => f.local.sync)).toEqual(['pending', 'offline-stale']);
  });

  it('groups the copies of merged heads under the survivor card (requested_as), and counts them together', () => {
    const survivor = card(H[2], { requestedAs: [{ ref: { case: 'headId', value: H[0] } }, { ref: { case: 'headId', value: H[1] } }] });
    const facets = [...copy(O[0], H[0], 'owned'), ...copy(O[1], H[1], 'owned')];
    const [f, ...rest] = buildFigures(inputs(facets, [product(survivor)]));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ _id: H[2], quantity: 2, local: { headId: H[2], heads: [H[0], H[1], H[2]] } });
  });

  it('shows the uf value with the higher version across requested_as, the lower head on a tie, and writes there', () => {
    const survivor = card(H[2], { requestedAs: [{ ref: { case: 'headId', value: H[0] } }, { ref: { case: 'headId', value: H[1] } }] });
    const v = (n: number) => `2026-09-26T12:00:00.000000Z#${String(n).padStart(10, '0')}#00000000000000000000000000000000`;
    const facets = [
      ...copy(O[0], H[0], 'owned'),
      ufAt(H[1], 'note', 'newer', v(9)),
      ufAt(H[0], 'note', 'older', v(3)),
      ufAt(H[1], 'score', 6, v(5)),
      ufAt(H[0], 'score', 8, v(5)),
    ];
    const [f] = buildFigures(inputs(facets, [product(survivor)]));
    expect(f).toMatchObject({ note: 'newer', rating: 8 });
    expect(f!.local.ufTarget).toEqual({ note: H[1], score: H[0], wishability: H[2] });
    expect(f!.local.uf.note).toMatchObject({ value: 'newer', head: H[1], editedAt: STAMP.edited_at });
  });

  it('carries the wishability', () => {
    const facets = [...copy(O[0], H[0], 'wished'), row(ufFacetKey(H[0], 'wishability'), { wishability: 4 })];
    expect(buildFigures(inputs(facets))[0]).toMatchObject({ wishRating: 4 });
  });

  it('dates an item by its newest copy status write and names its tags', () => {
    const facets = [
      ...copy(O[0], H[0], 'owned'),
      row(`occ/${O[1]}/head`, { head_id: H[0] }),
      row(`occ/${O[1]}/status`, { status: 'owned' }, { raw: JSON.stringify({ status: 'owned', edited_at: '2026-10-05T08:00:00.000-05:00', tz: 'America/Chicago' }) }),
      row('tag/e1000000-0000-4000-8000-0000000000e1/name', { name: 'Shelf A' }),
      row(`uf/${H[0]}/tag/e1000000-0000-4000-8000-0000000000e1`, {}),
    ];
    const [f] = buildFigures(inputs(facets));
    expect(f).toMatchObject({ createdAt: '2026-10-05T08:00:00.000-05:00', updatedAt: '2026-10-05T08:00:00.000-05:00', tags: ['Shelf A'] });
  });

  it('files a copy in a user collection without making it another item', () => {
    const facets = [collection('owned', C[0], 'Shelf'), ...copy(O[0], H[0], 'owned', `owned/${C[0]}`), ...copy(O[1], H[0], 'owned')];
    expect(buildFigures(inputs(facets)).map((f) => [f.quantity, f.local.copies.map((c) => c.shown_in)])).toEqual([[2, [`owned/${C[0]}`, 'owned/default']]]);
  });
});

describe('figureOf: the detail of one figure across every kind', () => {
  it('gathers every shown copy of the figure, its status the first of owned, ordered, wished, former', () => {
    const facets = [...copy(O[0], H[0], 'wished'), ...copy(O[1], H[0], 'former'), ...copy(O[2], H[0], 'ordered')];
    const f = figureOf(inputs(facets), H[0])!;
    expect(f).toMatchObject({ _id: H[0], collectionStatus: 'ordered', quantity: 1, local: { kind: 'ordered' } });
    expect(f.local.copies.map((c) => [c.occ_id, c.status])).toEqual([
      [O[0], 'wished'],
      [O[1], 'former'],
      [O[2], 'ordered'],
    ]);
  });

  it('finds a figure by any head its card answers for, and is undefined for one with no copy', () => {
    const survivor = card(H[2], { requestedAs: [{ ref: { case: 'headId', value: H[0] } }] });
    expect(figureOf(inputs(copy(O[0], H[0], 'owned'), [product(survivor)]), H[0])?._id).toBe(H[2]);
    expect(figureOf(inputs(copy(O[0], H[0], 'owned')), H[1])).toBeUndefined();
  });

  it('is pending when a copy of another kind is', () => {
    const [h, s] = copy(O[1], H[0], 'wished');
    const f = figureOf(inputs([...copy(O[0], H[0], 'owned'), h!, pending(s!)]), H[0])!;
    expect(f.local.sync).toBe('pending');
  });
});

describe('jan13', () => {
  it('reads a GTIN-14 with a leading zero as its JAN/EAN-13, and keeps any other as it is', () => {
    expect(jan13('04580416940986')).toBe('4580416940986');
    expect(jan13('14580416940983')).toBe('14580416940983');
    expect(jan13('12345')).toBe('12345');
  });
});
