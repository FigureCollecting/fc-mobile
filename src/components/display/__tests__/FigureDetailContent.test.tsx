import { afterEach, describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { FigureDetailContent } from '../FigureDetailContent';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import { photoFits } from '../photoFit';

describe('FigureDetailContent (shared between the viewer sheet and the Fold dual-pane)', () => {
  it('shows the figure name, position counter, and badges', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<FigureDetailContent figure={rem} index={0} total={7} />);
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    // the badges; the fields below may repeat a name (Rem's distributor is her maker)
    const badges = within(document.querySelector<HTMLElement>('.figure-viewer-sheet__badges')!);
    expect(badges.getByText('1/7')).toBeInTheDocument();
    expect(badges.getByText('Good Smile Company')).toBeInTheDocument();
    expect(badges.getByText(/owned/i)).toBeInTheDocument();
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
    const rows = Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).map((r) => (r as Element).textContent);
    // maker, scale and status are the summary's badges
    expect(rows).toEqual([
      'OriginFate/stay night',
      'CharacterSaber',
      'VersionSwimsuit ver.',
      'Release2026-03',
      'Size250 mm tall · 120 mm wide · depth from the width',
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

  it('a figure with only a name and maker has no field list beyond its badges and the size it is drawn at, said to be a default', () => {
    const bare = { _id: 'b', name: 'Bare', manufacturer: 'Kotobukiya', scale: '', origin: '', userId: 'u', createdAt: '', updatedAt: '' } as never;
    const { container } = renderWithProviders(<FigureDetailContent figure={bare} index={0} total={1} />);
    expect(screen.getByText('Kotobukiya')).toBeInTheDocument();
    // SIZE-BASIS-1: the one row it has is the size, and it says nothing was given
    expect(Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).map((r) => (r as Element).textContent)).toEqual([
      'Size≈ 200 mm · default, no size data · width from the photo · depth from the width',
    ]);
  });

  // SIZE-BASIS-1 (Ross 10-18): what the size rests on, for each figure
  it.each([
    ['measured', { heightMm: 245, widthMm: 170, depthMm: 190 }, '1/7', '245 × 170 × 190 mm · measured'],
    ['height from the scale', undefined, '1/7', '≈ 229 mm tall · from scale 1/7 · width from the photo, at most 229 mm (its scale\'s height) · depth from the width'],
    ['a length', { depthMm: 190 }, '1/8', '≈ 200 mm tall · from scale 1/8 · width from the photo, at most 190 mm (its length) · 190 mm deep'],
  ])('shows the size and its basis: %s', (_label, dimensions, scale, line) => {
    const figure = { _id: 's', name: 'Sized', manufacturer: 'Alter', scale, userId: 'u', createdAt: '', updatedAt: '', ...(dimensions === undefined ? {} : { dimensions }) } as never;
    const { container } = renderWithProviders(<FigureDetailContent figure={figure} index={0} total={1} />);
    const row = Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).find((r) => (r as Element).textContent?.startsWith('Size')) as Element | undefined;
    expect(row?.textContent).toBe(`Size${line}`);
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

  describe('FIT1: the Size row says when the photo disagrees with the listed width', () => {
    const megumi = { _id: 'megumi', name: 'Kato Megumi', manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', dimensions: { heightMm: 360, widthMm: 227, depthMm: 160 } } as never;
    const sizeRow = (container: HTMLElement) =>
      (Array.from(container.querySelectorAll('.figure-viewer-sheet__row')).find((r) => (r as Element).textContent?.startsWith('Size')) as Element).textContent;
    afterEach(() => {
      photoFits.value = new Map();
    });

    it('the case has flagged the figure: the row says by how much and that it is drawn to the listing', () => {
      photoFits.value = new Map([['megumi', { dir: 'wider', pct: 23 }]]);
      const { container } = renderWithProviders(<FigureDetailContent figure={megumi} index={0} total={1} />);
      expect(sizeRow(container)).toBe('Size360 × 227 × 160 mm · measured · photo 23 % wider than listed: drawn to the listing');
    });

    it('a figure the case did not flag (or flagged another): the row as it was', () => {
      photoFits.value = new Map([['someone-else', { dir: 'narrower', pct: 30 }]]);
      const { container } = renderWithProviders(<FigureDetailContent figure={megumi} index={0} total={1} />);
      expect(sizeRow(container)).toBe('Size360 × 227 × 160 mm · measured');
    });
  });
});
