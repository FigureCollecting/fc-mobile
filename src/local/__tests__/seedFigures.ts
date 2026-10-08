// Figures for the screen tests: copies another device wrote (on the fake coordinator) and their
// product cards, pulled by one engine pass, so the store holds them as known (not pending).
import { create } from '@bufbuild/protobuf';
import { ProductCardSchema, SyncOp, occFacetKey, type OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import { T0 } from '../../sync/__tests__/harness';
import { STAMP, headOf, serverVersion, uuid } from '../../sync/__tests__/engineSupport';
import type { LocalRig } from './localHarness';

export interface SeedFigure {
  title: string;
  manufacturer?: string;
  character?: string;
  series?: string;
  gtin?: string;
  status?: OccurrenceStatus;
  copies?: number;
  /** The disposal of each copy, with status former. */
  disposal?: Record<string, unknown>;
}

const AS_OF = '2026-10-01T09:30:00.000000Z';

/** Seed `figs` (figure i is headOf(i)) and pull them; returns the heads and each figure's occ ids. */
export async function seedFigures(r: LocalRig, figs: SeedFigure[]): Promise<{ heads: string[]; occs: string[][] }> {
  let counter = 0;
  let occN = 0;
  const events = [];
  const occs: string[][] = [];
  figs.forEach((f, i) => {
    const head = headOf(i);
    const mine: string[] = [];
    for (let c = 0; c < (f.copies ?? 1); c++) {
      const occ = uuid(++occN, 'a');
      mine.push(occ);
      const stamp = { ...STAMP };
      events.push({ facetKey: occFacetKey(occ, 'head'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: head, ...stamp }) });
      events.push({ facetKey: occFacetKey(occ, 'status'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ status: f.status ?? 'owned', ...stamp }) });
      if (f.disposal !== undefined) {
        events.push({ facetKey: occFacetKey(occ, 'disposal'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ ...f.disposal, ...stamp }) });
      }
    }
    occs.push(mine);
    r.server.products.set(
      head,
      create(ProductCardSchema, {
        headId: head,
        requestedAs: [{ ref: { case: 'headId', value: head } }],
        title: { value: f.title, asOf: AS_OF },
        ...(f.manufacturer === undefined ? {} : { manufacturer: { value: f.manufacturer, asOf: AS_OF } }),
        ...(f.character === undefined ? {} : { character: { value: f.character, asOf: AS_OF } }),
        ...(f.series === undefined ? {} : { series: { value: f.series, asOf: AS_OF } }),
        gtin14s: f.gtin === undefined ? [] : [f.gtin],
      }),
    );
  });
  if (events.length > 0) r.server.write(events);
  await r.engine.trigger('manual');
  return { heads: figs.map((_, i) => headOf(i)), occs };
}
