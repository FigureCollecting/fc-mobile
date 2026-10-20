/**
 * FIGURES-ONLY-1 (Ross 10-18): the case shelves figures only. A towel, a tapestry, a poster or a video the collection
 * holds stays in the list, the tiles and Info; it is just not stood on a shelf, and the View card says how many are
 * left off. A product whose card states no kind is shelved as it was before the card carried one. Seeded through the
 * fake coordinator and the real engine, so the kind travels the path a card does: card -> store -> figure -> case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

const instances: any[] = [];
class FakePswp {
  options: any;
  handlers: Record<string, () => void> = {};
  currIndex: number;
  constructor(options: any) {
    this.options = options;
    this.currIndex = options.index ?? 0;
    instances.push(this);
  }
  on(event: string, cb: () => void) { this.handlers[event] = cb; }
  init() {}
  destroy() { this.handlers['destroy']?.(); }
}
vi.mock('photoswipe', () => ({ default: FakePswp }));
vi.mock('photoswipe/style.css', () => ({}));

import { ProductKind } from '@figurecollecting/fc-api-contract';
import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures, type SeedFigure } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';

beforeEach(() => {
  instances.length = 0;
});

afterEach(() => {
  localStorage.clear();
  localSession.value = undefined;
});

const fig = (title: string, extra: Partial<SeedFigure> = {}): SeedFigure => ({ title, manufacturer: 'Good Smile', ...extra });

/** A slice of Ross's collection: figures, goods, a video, and two products the card states no kind for. */
const MIX: SeedFigure[] = [
  fig('A Prepainted', { category: 'Prepainted', kind: ProductKind.FIGURE }),
  fig('B Linens towel', { category: 'Linens', kind: ProductKind.GOODS }),
  fig('C Trading', { category: 'Trading', kind: ProductKind.FIGURE }),
  fig('D On Walls tapestry', { category: 'On Walls', kind: ProductKind.GOODS }),
  fig('E Video', { category: 'Video', kind: ProductKind.MEDIA }),
  fig('F Mystery Box', { category: 'Mystery Box' }),
  fig('G No category'),
  fig('H Stationery', { category: 'Stationeries', kind: ProductKind.GOODS }),
];
const SHELVED = ['A Prepainted', 'C Trading', 'F Mystery Box', 'G No category'];
const LEFT_OFF = ['B Linens towel', 'D On Walls tapestry', 'E Video', 'H Stationery'];

async function renderMix(path = '/') {
  const r = await localRig();
  await seedFigures(r, MIX);
  return renderWithProviders(<Collection />, { initialPath: path });
}

describe('the case shelves figures only', () => {
  it('stands the figures and the products with no stated kind, and leaves the goods and the video off the shelves', async () => {
    await renderMix();
    await screen.findByRole('button', { name: 'A Prepainted' });
    for (const name of SHELVED) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    for (const name of LEFT_OFF) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(document.querySelectorAll('.cab-figure')).toHaveLength(SHELVED.length);
  });

  it('still counts every one in the collection: the header says 8, the case stands 4', async () => {
    await renderMix();
    await screen.findByRole('button', { name: 'A Prepainted' });
    expect(screen.getByText('Collection (8)')).toBeInTheDocument();
  });

  it('keeps the goods and the video in the tiles', async () => {
    await renderMix('/?layout=rows');
    await screen.findByRole('button', { name: /A Prepainted/ });
    for (const name of [...SHELVED, ...LEFT_OFF]) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
  });

  it('says in the View card how many are left off: 3 goods and 1 media not shelved', async () => {
    const user = userEvent.setup();
    await renderMix();
    await screen.findByRole('button', { name: 'A Prepainted' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('3 goods and 1 media not shelved')).toBeInTheDocument();
  });

  it('opens Info on the figure tapped at its place among ALL of the collection, and Info still pages through the goods', async () => {
    const user = userEvent.setup();
    await renderMix();
    await screen.findByRole('button', { name: 'C Trading' });
    await user.click(screen.getByRole('button', { name: 'C Trading' }));
    await waitFor(() => expect(instances).toHaveLength(1));
    const { dataSource, index } = instances[0].options as { dataSource: { html?: string }[]; index: number };
    expect(dataSource).toHaveLength(MIX.length);
    expect(dataSource[index]!.html).toContain('C Trading');
    expect(dataSource.map((d) => d.html).join('')).toContain('B Linens towel');
  });

  it('closes the View card from its handle, and the line goes with it', async () => {
    const user = userEvent.setup();
    await renderMix();
    await screen.findByRole('button', { name: 'A Prepainted' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('3 goods and 1 media not shelved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('3 goods and 1 media not shelved')).toBeNull());
  });

  it('says nothing when everything is shelved', async () => {
    const user = userEvent.setup();
    const r = await localRig();
    await seedFigures(r, [fig('A Prepainted', { kind: ProductKind.FIGURE }), fig('B No kind')]);
    renderWithProviders(<Collection />, { initialPath: '/' });
    await screen.findByRole('button', { name: 'A Prepainted' });
    await user.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('group', { name: 'Back wall' });
    expect(screen.queryByText(/not shelved/)).toBeNull();
  });

  it('does not let the Category=Prepainted default chip hide a towel from the list', async () => {
    await renderMix('/?layout=rows');
    await screen.findByRole('button', { name: /B Linens towel/ });
    const chips = screen.queryByRole('list', { name: /applied filters/i });
    if (chips !== null) expect(within(chips).queryByText(/Linens/)).toBeNull();
  });
});
