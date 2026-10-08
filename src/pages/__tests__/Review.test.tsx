// The conflict review (GR-Q1, Ross 09-26): per item the app's value and MFC's, each with its date,
// and 'keep app' / 'take MFC' per item and in bulk. An answer is a normal writeFacet of
// res/mfc/{head} through sync (contract 0.3.0); the server decides what it then writes.
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { SyncOp, answerKey, importItemKey, importMarkerKey, ufFacetKey } from '@figurecollecting/fc-api-contract';

import { Review } from '../Review';
import { renderWithProviders } from '../../test/testUtils';
import { localRig, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { STAMP, headOf, serverVersion } from '../../sync/__tests__/engineSupport';
import { T0 } from '../../sync/__tests__/harness';

afterEach(() => {
  localSession.value = undefined;
});

const SERVER = '00000000000000000000000000000000';
const counts = (owned: [number, number, number], ordered: [number, number, number] = [0, 0, 0], wished: [number, number, number] = [0, 0, 0]) => ({
  owned: { base: owned[0], app: owned[1], mfc: owned[2] },
  ordered: { base: ordered[0], app: ordered[1], mfc: ordered[2] },
  wished: { base: wished[0], app: wished[1], mfc: wished[2] },
});
const empty = { keep: { copies: [], fields: [] }, take: { copies: [], fields: [] } };

function item(rev: string, kind: 'conflict' | 'divergence', c: ReturnType<typeof counts>, fields: Record<string, unknown> = {}) {
  return JSON.stringify({
    rev,
    kind,
    import: 2,
    counts: c,
    fields: { score: { status: 'nochange' }, note: { status: 'nochange' }, wishability: { status: 'nochange' }, ...fields },
    copies: [],
    mfc_rows: [],
    preview: empty,
  });
}

/** Two figures the user holds, an import marker, and the items the import raised. */
async function seeded(): Promise<LocalRig> {
  const r = await localRig();
  await seedFigures(r, [
    { title: 'Conflicted Miku', copies: 2 },
    { title: 'Scored Rem' },
    { title: 'Behind Spike', status: 'wished' },
  ]);
  let n = 500;
  const v = () => serverVersion(T0, ++n, SERVER);
  r.server.write([
    { facetKey: ufFacetKey(headOf(1), 'score'), version: v(), op: SyncOp.UPSERT, payload: JSON.stringify({ score: 8, ...STAMP }) },
  ]);
  r.server.write([
    { facetKey: importItemKey('mfc', 'figure', headOf(0)), version: v(), op: SyncOp.UPSERT, payload: item('r-miku', 'conflict', counts([1, 2, 0], [0, 0, 1])) },
    { facetKey: importItemKey('mfc', 'figure', headOf(1)), version: v(), op: SyncOp.UPSERT, payload: item('r-rem', 'conflict', counts([1, 1, 1]), { score: { status: 'conflict', base: 5, app: 8, mfc: 6 } }) },
    { facetKey: importItemKey('mfc', 'figure', headOf(2)), version: v(), op: SyncOp.UPSERT, payload: item('r-spike', 'divergence', counts([0, 0, 0], [0, 0, 0], [0, 1, 0])) },
    { facetKey: importMarkerKey('mfc'), version: v(), op: SyncOp.UPSERT, payload: JSON.stringify({ import: 2, export_date: '2026-10-05' }) },
  ]);
  await r.engine.trigger('manual');
  return r;
}

const answer = async (r: LocalRig, head: string) => {
  const rec = await r.store.getFacet(answerKey('mfc', head));
  return rec?.value?.op === 'upsert' ? (JSON.parse(rec.value.payload) as Record<string, unknown>) : undefined;
};

describe('Review', () => {
  it('lists each conflict with the app value and the MFC value, each with its date', async () => {
    await seeded();
    renderWithProviders(<Review />, { initialPath: '/review' });
    const conflicts = await screen.findByRole('list', { name: 'Conflicts' });
    const [miku, rem] = within(conflicts).getAllByRole('listitem');
    expect(miku).toHaveTextContent('Conflicted Miku');
    expect(within(miku!).getByText('Owned')).toBeInTheDocument();
    expect(miku).toHaveTextContent(/App: 2 \(.*Sep 26, 2026.*\)/);
    expect(miku).toHaveTextContent('MFC: 0 (export of Oct 5, 2026)');
    expect(miku).toHaveTextContent('Ordered');
    expect(rem).toHaveTextContent('Scored Rem');
    expect(rem).toHaveTextContent('Score');
    expect(rem).toHaveTextContent(/App: 8 \(.*Sep 26, 2026.*\)/);
    expect(rem).toHaveTextContent('MFC: 6 (export of Oct 5, 2026)');
    expect(rem).not.toHaveTextContent('Owned');
  });

  it('lists a divergence apart: only the app changed, MFC is behind', async () => {
    await seeded();
    renderWithProviders(<Review />, { initialPath: '/review' });
    const behind = await screen.findByRole('list', { name: 'MFC is behind' });
    expect(within(behind).getAllByRole('listitem')).toHaveLength(1);
    expect(behind).toHaveTextContent('Behind Spike');
  });

  it("answers one item 'keep app' with a res write through sync, and shows it answered", async () => {
    const r = await seeded();
    renderWithProviders(<Review />, { initialPath: '/review' });
    const user = userEvent.setup();
    const miku = (await screen.findByText('Conflicted Miku')).closest('li')!;
    await user.click(within(miku).getByRole('button', { name: 'Keep app' }));
    await waitFor(async () => expect(await answer(r, headOf(0))).toMatchObject({ item: 'figure', rev: 'r-miku', choice: 'keep', tz: 'America/Chicago' }));
    expect((await r.store.getFacet(answerKey('mfc', headOf(0))))!.pending_id).not.toBeNull();
    expect(r.timers.delays()).toContain(1000);
    expect(await within(miku).findByText('You chose: keep app. It syncs next.')).toBeInTheDocument();
    expect(within(miku).queryByRole('button', { name: 'Take MFC' })).toBeNull();
  });

  it("answers every conflict 'take MFC' in bulk", async () => {
    const r = await seeded();
    renderWithProviders(<Review />, { initialPath: '/review' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Take MFC for all 2 conflicts' }));
    await waitFor(async () => expect(await answer(r, headOf(1))).toMatchObject({ rev: 'r-rem', choice: 'take' }));
    expect(await answer(r, headOf(0))).toMatchObject({ rev: 'r-miku', choice: 'take' });
    expect(await answer(r, headOf(2))).toBeUndefined();
  });

  it('answers a divergence: MFC is behind (keep)', async () => {
    const r = await seeded();
    renderWithProviders(<Review />, { initialPath: '/review' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Keep app for all 1 items' }));
    await waitFor(async () => expect(await answer(r, headOf(2))).toMatchObject({ rev: 'r-spike', choice: 'keep' }));
  });

  it('drops an item the server has settled (its facet tombstoned), and says when nothing is left', async () => {
    const r = await localRig();
    renderWithProviders(<Review />, { initialPath: '/review' });
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument();
    expect(r.clients.importMfcExport).not.toHaveBeenCalled();
  });

  it('skips an item it cannot read', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Odd' }]);
    r.server.write([{ facetKey: importItemKey('mfc', 'figure', headOf(0)), version: serverVersion(T0, 9, SERVER), op: SyncOp.UPSERT, payload: '{"rev":"x"}' }]);
    await r.engine.trigger('manual');
    renderWithProviders(<Review />, { initialPath: '/review' });
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument();
  });
});
