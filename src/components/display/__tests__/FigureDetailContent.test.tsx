import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { FigureDetailContent } from '../FigureDetailContent';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

describe('FigureDetailContent (shared between the viewer sheet and the Fold dual-pane)', () => {
  it('shows the figure name, position counter, and badges', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<FigureDetailContent figure={rem} index={0} total={7} />);
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    expect(screen.getByText('1/7')).toBeInTheDocument();
    expect(screen.getByText('Good Smile Company')).toBeInTheDocument();
    expect(screen.getByText(/owned/i)).toBeInTheDocument();
  });

  it('shows every field the figure has at once, with no tap: nothing hangs on a handle (SHEETS-FB1 6b)', () => {
    const dark = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!;
    renderWithProviders(<FigureDetailContent figure={dark} index={1} total={7} />);
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
    expect(screen.getByText('wings, dark')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand details|collapse details/i })).toBeNull();
  });

  it('lists each field it has, by name, and leaves out the ones it lacks', () => {
    const full = {
      _id: 'f1',
      name: 'Full one',
      manufacturer: 'Alter',
      scale: '1/7',
      userId: 'u',
      createdAt: '',
      updatedAt: '',
      collectionStatus: 'ordered',
      origin: 'Fate/stay night',
      category: 'Prepainted',
      classification: 'Figures',
      version: 'Swimsuit ver.',
      materials: 'PVC, ABS',
      jan: '4580416940000',
      releases: [{ date: '2026-03' }],
      dimensions: { heightMm: 250, widthMm: 120 },
      companyRoles: [{ companyId: 'c1', companyName: 'Good Smile', roleId: 'r', roleName: 'Distributor' }, { companyId: 'c2', roleId: 'r' }],
      artistRoles: [{ artistId: 'a1', artistName: 'Sculptor San', roleId: 'r', roleName: 'Sculptor' }, { artistId: 'a2', artistName: 'Nameless', roleId: 'r' }],
      tags: ['a', 'b'],
      note: 'top shelf',
      rating: 9,
      local: { headId: 'f1', kind: 'ordered', sync: 'known', asOf: null, character: 'Saber' },
    } as never;
    const { container } = renderWithProviders(<FigureDetailContent figure={full} index={0} total={1} />);
    const rows = Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).map((r) => r.textContent);
    expect(rows).toEqual([
      'MakerAlter',
      'Scale1/7',
      'OriginFate/stay night',
      'CharacterSaber',
      'VersionSwimsuit ver.',
      'Release2026-03',
      'Size250 × 120 mm',
      'CategoryPrepainted',
      'TypeFigures',
      'MaterialsPVC, ABS',
      'DistributorGood Smile',
      'SculptorSculptor San',
      'ArtistNameless',
      'JAN4580416940000',
      'Tagsa, b',
      'Rating9',
      'Notetop shelf',
    ]);
  });

  it('a figure with only a name and maker lists just its maker', () => {
    const bare = { _id: 'b', name: 'Bare', manufacturer: 'Kotobukiya', scale: '', userId: 'u', createdAt: '', updatedAt: '' } as never;
    const { container } = renderWithProviders(<FigureDetailContent figure={bare} index={0} total={1} />);
    expect(Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).map((r) => r.textContent)).toEqual(['MakerKotobukiya']);
  });
});

describe('FigureDetailContent on a local figure (WK-15)', () => {
  const local = {
    _id: 'h1',
    name: 'Local one',
    manufacturer: 'Alter',
    scale: '1/7',
    userId: 'u',
    createdAt: '',
    updatedAt: '',
    collectionStatus: 'owned',
    quantity: 2,
    local: { headId: 'h1', kind: 'owned', sync: 'pending', asOf: null },
  } as never;

  it('shows its stack, its sync badge, and a way to the full detail with its actions', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<FigureDetailContent figure={local} index={0} total={1} />);
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copies and actions' }));
    expect(currentPath()).toBe('/figure/h1');
  });

  it('offers no detail link for a fixture figure', () => {
    renderWithProviders(<FigureDetailContent figure={FIXTURE_FIGURES[0]!} index={0} total={7} />);
    expect(screen.queryByRole('button', { name: 'Copies and actions' })).toBeNull();
  });
});
