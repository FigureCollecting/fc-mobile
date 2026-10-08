// The review's cost (GR-Q1): buildReview runs as a useSnapshot select on every store change, so it
// reads the figure model once per change and looks each item up, never once per item. Ross's MFC
// export is about 1,144 rows, so that is the scale it must answer at on the main thread.
import { describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ProductCardSchema, importItemKey } from '@figurecollecting/fc-api-contract';
import type { ProductRecord } from '../../storage/records';
import { copy, row } from '../../sync/__tests__/viewFixtures';

const calls = vi.hoisted(() => ({ buildView: 0, figureOf: 0 }));
vi.mock('../../sync/occurrences', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../sync/occurrences')>();
  return { ...real, buildView: (...a: Parameters<typeof real.buildView>) => (calls.buildView++, real.buildView(...a)) };
});
vi.mock('../figures', async (importOriginal) => {
  const real = await importOriginal<typeof import('../figures')>();
  return { ...real, figureOf: (...a: Parameters<typeof real.figureOf>) => (calls.figureOf++, real.figureOf(...a)) };
});

const { buildFigures } = await import('../figures');
const { buildReview } = await import('../review');
const { buildView } = await import('../../sync/occurrences');

const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
const head = (i: number) => `${hex(i, 8)}-0000-4000-8000-000000000000`;
const occ = (i: number) => `${hex(i, 8)}-1111-4000-8000-000000000000`;
const counts = { owned: { app: 1, mfc: 2 }, ordered: { app: 0, mfc: 0 }, wished: { app: 0, mfc: 0 } };
const fields = { score: { status: 'nochange' }, note: { status: 'nochange' }, wishability: { status: 'nochange' } };

/** `copies` owned copies with their cards, and a divergence item on the first `items` of them. */
function store(copies: number, items: number) {
  const facets = [];
  const products: ProductRecord[] = [];
  for (let i = 0; i < copies; i++) {
    facets.push(...copy(occ(i), head(i), 'owned'));
    const card = create(ProductCardSchema, { headId: head(i), requestedAs: [{ ref: { case: 'headId', value: head(i) } }], title: { value: `Figure ${i}`, asOf: '2026-10-01T09:30:00.000000Z' } });
    products.push({ sub: 'user-a', head_id: head(i), card, as_of: '2026-10-01T09:30:00.000000Z', fetched_at: 0 });
  }
  for (let i = 0; i < items; i++) facets.push(row(importItemKey('mfc', 'figure', head(i)), { rev: `r${i}`, kind: 'divergence', import: 1, counts, fields }, { stamp: false }));
  const inputs = { sub: 'user-a', facets, products, stale: false };
  const view = buildView(facets);
  return { ...inputs, view, figures: buildFigures(inputs, view) };
}

describe('buildReview cost', () => {
  it('reads the figure model once per call, not once per item', () => {
    const snapshot = store(60, 50);
    calls.buildView = 0;
    calls.figureOf = 0;
    const set = buildReview(snapshot);
    expect(set.divergences).toHaveLength(50);
    expect(set.divergences[49]).toMatchObject({ headId: head(49), name: 'Figure 49', parts: [{ label: 'Owned', app: '1', mfc: '2' }] });
    expect(calls.figureOf).toBe(0);
    // The snapshot's view is the one this store change built: no view of its own.
    expect(calls.buildView).toBe(0);
    const { view: _view, ...withoutView } = snapshot;
    buildReview(withoutView);
    expect(calls.buildView).toBe(1);
  });

  it('shows the counts of an item whose figure is no longer held, with no app date', () => {
    // One copy (head 0) and two items: head 1's figure has no copy left.
    const set = buildReview(store(1, 2));
    expect(set.divergences[1]).toMatchObject({ headId: head(1), name: 'A figure no longer in your collection', parts: [{ label: 'Owned', app: '1', appEditedAt: null, mfc: '2' }] });
  });

  it('answers 1,144 review items over 1,200 copies in under 100 ms', () => {
    const snapshot = store(1200, 1144);
    performance.mark('fc-review:start');
    const set = buildReview(snapshot);
    const ms = performance.measure('fc-review', 'fc-review:start').duration;
    process.stderr.write(`buildReview items=1144 copies=1200: ${ms.toFixed(1)} ms\n`);
    expect(set.divergences).toHaveLength(1144);
    expect(ms).toBeLessThan(100);
  });
});
