import { describe, expect, it } from 'vitest';
import { occFacetKey, ufFacetKey } from '@figurecollecting/fc-api-contract';
import { buildView, countsFor, effectiveTags, inLibrary, pickCopy, shownCopies } from '../occurrences';
import { C, H, O, T, collection, copy, copyTag, figureTag, kindTag, note, origin, row, tag } from './viewFixtures';

const byOcc = (view: ReturnType<typeof buildView>, occ: string) => view.copies.find((c) => c.occ_id === occ)!;

describe('occurrences: one record per copy, counted by live copies', () => {
  it('counts the live copies of a figure per kind, former apart from held', () => {
    const view = buildView([
      ...copy(O[0], H[0], 'owned'),
      ...copy(O[1], H[0], 'owned'),
      ...copy(O[2], H[0], 'ordered'),
      ...copy(O[3], H[0], 'former'),
      ...copy(C[0], H[1], 'wished'),
    ]);
    expect(countsFor(view, H[0])).toEqual({ owned: 2, ordered: 1, wished: 0, former: 1 });
    expect(countsFor(view, H[1])).toEqual({ owned: 0, ordered: 0, wished: 1, former: 0 });
    expect(countsFor(view, H[2])).toEqual({ owned: 0, ordered: 0, wished: 0, former: 0 });
  });

  it('keeps a removed copy (status tombstoned) with its head, not shown and not counted, so undo restores it whole', () => {
    const view = buildView([...copy(O[0], H[0], null, `owned/${C[0]}`), ...copy(O[1], H[0], 'owned'), collection('owned', C[0], 'Shelf')]);
    expect(byOcc(view, O[0])).toMatchObject({ head_id: H[0], status: null, shown_in: null, hidden: null });
    expect(countsFor(view, H[0]).owned).toBe(1);
    expect(shownCopies(view).map((c) => c.occ_id)).toEqual([O[1]]);
  });

  it('reads the origin of an imported copy', () => {
    const view = buildView([...copy(O[0], H[0], 'owned'), origin(O[0], '1144', 2)]);
    expect(byOcc(view, O[0]).origin).toEqual({ site: 'mfc', native_id: '1144', ordinal: 2 });
  });
});

describe('the display rule: every live copy shows in exactly one collection', () => {
  it('shows a copy in its filed collection when it exists and is of the copy kind', () => {
    const view = buildView([...copy(O[0], H[0], 'owned', `owned/${C[0]}`), collection('owned', C[0], 'Shelf')]);
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: `owned/${C[0]}`, flag: null });
  });

  it('shows an unfiled copy in {status}/default, unflagged', () => {
    const view = buildView(copy(O[0], H[0], 'wished'));
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: 'wished/default', flag: null });
  });

  it('shows a copy filed in a default collection there', () => {
    const view = buildView(copy(O[0], H[0], 'ordered', 'ordered/default'));
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: 'ordered/default', flag: null });
  });

  it('a stale filing of another kind loses the move, never the arrival', () => {
    // Marked arrived (owned) on one device; a stale device re-filed it into an ordered collection.
    const view = buildView([...copy(O[0], H[0], 'owned', `ordered/${C[0]}`), collection('ordered', C[0], 'Preorders')]);
    expect(byOcc(view, O[0])).toMatchObject({ status: 'owned', shown_in: 'owned/default', flag: 'other_kind' });
    expect(countsFor(view, H[0]).owned).toBe(1);
  });

  it('shows a copy filed in a deleted collection in the default, flagged, and back once undo restores the name', () => {
    const deleted = buildView([...copy(O[0], H[0], 'owned', `owned/${C[0]}`), collection('owned', C[0], null)]);
    expect(byOcc(deleted, O[0])).toMatchObject({ shown_in: 'owned/default', flag: 'dangling' });
    expect(deleted.collections.map((c) => c.ref)).not.toContain(`owned/${C[0]}`);
    const restored = buildView([...copy(O[0], H[0], 'owned', `owned/${C[0]}`), collection('owned', C[0], 'Shelf')]);
    expect(byOcc(restored, O[0])).toMatchObject({ shown_in: `owned/${C[0]}`, flag: null });
  });

  it('flags a filing that names a collection never created as dangling', () => {
    const view = buildView(copy(O[0], H[0], 'owned', `owned/${C[1]}`));
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: 'owned/default', flag: 'dangling' });
  });

  it('treats a tombstoned filing as unfiled', () => {
    const view = buildView([...copy(O[0], H[0], 'owned'), row(occFacetKey(O[0], 'collection'), null)]);
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: 'owned/default', flag: null });
  });

  it('lists the four implicit defaults and the live user collections, with names', () => {
    const view = buildView([
      collection('owned', C[1], 'Cabinet'),
      collection('owned', C[0], 'Shelf'),
      collection('wished', C[1], null),
      collection('former', 'default', 'Gone'),
    ]);
    expect(view.collections).toEqual([
      { ref: 'former/default', kind: 'former', coll_id: 'default', name: 'Gone' },
      { ref: 'ordered/default', kind: 'ordered', coll_id: 'default', name: null },
      { ref: 'owned/default', kind: 'owned', coll_id: 'default', name: null },
      { ref: `owned/${C[0]}`, kind: 'owned', coll_id: C[0], name: 'Shelf' },
      { ref: `owned/${C[1]}`, kind: 'owned', coll_id: C[1], name: 'Cabinet' },
      { ref: 'wished/default', kind: 'wished', coll_id: 'default', name: null },
    ]);
  });

  it('shows a disposal only beside a former status', () => {
    const disposal = row(occFacetKey(O[0], 'disposal'), { reason: 'sold' });
    expect(byOcc(buildView([...copy(O[0], H[0], 'former'), disposal]), O[0]).disposal).toMatchObject({ reason: 'sold' });
    expect(byOcc(buildView([...copy(O[0], H[0], 'owned'), disposal]), O[0]).disposal).toBeNull();
  });

  it('filters shown copies by figure, kind and collection', () => {
    const view = buildView([
      ...copy(O[0], H[0], 'owned', `owned/${C[0]}`),
      ...copy(O[1], H[0], 'owned'),
      ...copy(O[2], H[1], 'owned'),
      ...copy(O[3], H[0], 'wished'),
      collection('owned', C[0], 'Shelf'),
    ]);
    expect(shownCopies(view, { head_id: H[0], kind: 'owned' }).map((c) => c.occ_id)).toEqual([O[0], O[1]]);
    expect(shownCopies(view, { shown_in: 'owned/default' }).map((c) => c.occ_id)).toEqual([O[1], O[2]]);
    expect(shownCopies(view, { kind: 'wished' }).map((c) => c.occ_id)).toEqual([O[3]]);
  });
});

describe('tags at three scopes', () => {
  it("a copy's effective tags are its own, its figure's, and its figure's for its status", () => {
    const view = buildView([
      ...copy(O[0], H[0], 'owned'),
      ...copy(O[1], H[0], 'wished'),
      tag(T[0], 'favourite'),
      tag(T[1], 'shelf-worthy'),
      tag(T[2], 'grail'),
      copyTag(O[0], T[0]),
      figureTag(H[0], T[1]),
      kindTag(H[0], 'wished', T[2]),
    ]);
    expect(effectiveTags(view, O[0])).toEqual([T[0], T[1]].sort());
    expect(effectiveTags(view, O[1])).toEqual([T[1], T[2]].sort());
    expect(byOcc(view, O[0]).tags).toEqual([T[0]]);
  });

  it('a kind tag follows the status: a copy that arrives picks it up, one that leaves drops it, with no write', () => {
    const tags = [tag(T[0], 'figure-x-owned'), kindTag(H[0], 'owned', T[0])];
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'ordered'), ...tags]), O[0])).toEqual([]);
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'owned'), ...tags]), O[0])).toEqual([T[0]]);
  });

  it('a membership is not a tag until the tag exists, and an untag tombstone removes it', () => {
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'owned'), copyTag(O[0], T[0])]), O[0])).toEqual([]);
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'owned'), figureTag(H[0], T[0]), kindTag(H[0], 'owned', T[1])]), O[0])).toEqual([]);
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'owned'), tag(T[0], 'red'), copyTag(O[0], T[0], false)]), O[0])).toEqual([]);
    expect(effectiveTags(buildView([...copy(O[0], H[0], 'owned'), tag(T[0], null), copyTag(O[0], T[0])]), O[0])).toEqual([]);
  });

  it('has no effective tags for a copy it does not show', () => {
    const view = buildView([...copy(O[0], H[0], null), tag(T[0], 'red'), figureTag(H[0], T[0])]);
    expect(effectiveTags(view, O[0])).toEqual([]);
    expect(effectiveTags(view, O[3])).toEqual([]);
  });

  it('lists the live tags by id', () => {
    const view = buildView([tag(T[0], 'red'), tag(T[1], null)]);
    expect([...view.tags]).toEqual([[T[0], 'red']]);
  });
});

describe('library presence', () => {
  it('a figure is in the library while a live copy or any live uf facet references it', () => {
    const view = buildView([...copy(O[0], H[0], 'former'), note(H[1], 'want the reissue'), ...copy(O[1], H[2], null)]);
    expect(inLibrary(view, H[0])).toBe(true);
    expect(inLibrary(view, H[1])).toBe(true);
    expect(inLibrary(view, H[2])).toBe(false);
    expect([...view.library].sort()).toEqual([H[0], H[1]].sort());
  });

  it('a figure tag alone keeps the figure in the library; a tombstoned facet does not', () => {
    expect(inLibrary(buildView([figureTag(H[0], T[0])]), H[0])).toBe(true);
    expect(inLibrary(buildView([note(H[0], null), figureTag(H[0], T[0], false)]), H[0])).toBe(false);
  });
});

describe('deterministic picks: by occurrence id alone', () => {
  const view = buildView([
    ...copy(O[2], H[0], 'ordered'),
    ...copy(O[0], H[0], 'ordered', `ordered/${C[0]}`),
    ...copy(O[1], H[0], 'ordered'),
    ...copy(O[3], H[0], 'owned'),
    collection('ordered', C[0], 'Preorders'),
  ]);

  it('receives and keeps the lowest, removes the highest', () => {
    expect(pickCopy(view, { head_id: H[0], kind: 'ordered' }, 'receive')!.occ_id).toBe(O[0]);
    expect(pickCopy(view, { head_id: H[0], kind: 'ordered' }, 'keep')!.occ_id).toBe(O[0]);
    expect(pickCopy(view, { head_id: H[0], kind: 'ordered' }, 'remove')!.occ_id).toBe(O[2]);
  });

  it('picks among the copies shown in one collection when asked', () => {
    expect(pickCopy(view, { head_id: H[0], kind: 'ordered', shown_in: 'ordered/default' }, 'receive')!.occ_id).toBe(O[1]);
  });

  it('picks nothing when no copy matches', () => {
    expect(pickCopy(view, { head_id: H[1], kind: 'ordered' }, 'remove')).toBeUndefined();
  });

  it('two devices holding the same copies in any order pick the same one', () => {
    const rows = [...copy(O[1], H[0], 'owned'), ...copy(O[3], H[0], 'owned'), ...copy(O[0], H[0], 'owned')];
    const a = buildView(rows);
    const b = buildView([...rows].reverse());
    expect(pickCopy(a, { head_id: H[0], kind: 'owned' }, 'remove')).toEqual(pickCopy(b, { head_id: H[0], kind: 'owned' }, 'remove'));
    expect(pickCopy(a, { head_id: H[0], kind: 'owned' }, 'remove')!.occ_id).toBe(O[3]);
  });
});

describe('forward compatibility: what this client cannot read is kept, hidden and never counted', () => {
  it('hides a copy with a live status and no head (a partial batch), flagged, uncounted, out of the library', () => {
    const view = buildView(copy(O[0], null, 'owned'));
    expect(byOcc(view, O[0])).toMatchObject({ head_id: null, status: 'owned', shown_in: null, hidden: 'no_head' });
    expect(shownCopies(view)).toEqual([]);
    expect(view.library.size).toBe(0);
  });

  it('does not flag a removed copy that never had a head', () => {
    const view = buildView(copy(O[0], null, null));
    expect(byOcc(view, O[0])).toMatchObject({ status: null, hidden: null, shown_in: null });
  });

  it('hides a copy whose head payload it cannot read', () => {
    const view = buildView([row(occFacetKey(O[0], 'head'), { head_id: 'not-a-uuid' }), row(occFacetKey(O[0], 'status'), { status: 'owned' })]);
    expect(byOcc(view, O[0])).toMatchObject({ hidden: 'no_head', shown_in: null });
  });

  it('hides a copy with a status a later release added, and never counts it', () => {
    const view = buildView([...copy(O[0], H[0], 'lent'), ...copy(O[1], H[0], 'owned')]);
    expect(byOcc(view, O[0])).toMatchObject({ status: null, hidden: 'unknown_status', shown_in: null });
    expect(countsFor(view, H[0])).toEqual({ owned: 1, ordered: 0, wished: 0, former: 0 });
    expect(pickCopy(view, { head_id: H[0], kind: 'owned' }, 'remove')!.occ_id).toBe(O[1]);
  });

  it('hides a filing whose kind it does not know, showing the copy in its default flagged', () => {
    const view = buildView(copy(O[0], H[0], 'owned', 'lent/default'));
    expect(byOcc(view, O[0])).toMatchObject({ shown_in: 'owned/default', flag: 'dangling' });
  });

  it('hides a disposal reason a later release added', () => {
    const view = buildView([...copy(O[0], H[0], 'former'), row(occFacetKey(O[0], 'disposal'), { reason: 'recycled' })]);
    expect(byOcc(view, O[0]).disposal).toBeNull();
  });

  it('ignores key forms it does not know: no copy, collection, tag or library entry comes of them', () => {
    const view = buildView([
      row(`occ/${O[0]}/loan`, { to: 'K' }),
      row(`holding/${H[0]}/status`, { status: 'owned' }),
      row(`uf/${H[1]}/rating`, { rating: 3 }),
      row('coll/lent/default/name', { name: 'Lent' }),
      row(`tag/${T[0]}/colour`, { colour: 'red' }),
    ]);
    expect(view.copies).toEqual([]);
    expect(view.collections).toHaveLength(4);
    expect(view.tags.size).toBe(0);
    expect(view.library.size).toBe(0);
  });

  it('ignores an unreadable score or a uf payload it cannot parse for the library', () => {
    const view = buildView([row(ufFacetKey(H[0], 'score'), null, {}), row(ufFacetKey(H[1], 'score'), { score: 1 }, { raw: '{bad' })]);
    expect(view.library.size).toBe(0);
  });
});
