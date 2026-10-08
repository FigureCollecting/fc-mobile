import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { JustifiedRows } from '../JustifiedRows';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES, getFixtureFigures } from '../../../dev-fixtures/fixtures';

/** Fake a real, bounded scroll viewport so the virtualizer measures a
 *  non-zero rect (@tanstack/virtual-core reads offsetWidth/offsetHeight,
 *  which jsdom always reports as 0 without real layout). */
function mockScrollViewport(heightPx: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? heightPx : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? 360 : 0;
  });
}

describe('JustifiedRows (Display B)', () => {
  it('renders every figure with an accessible name', () => {
    renderWithProviders(<JustifiedRows figures={FIXTURE_FIGURES} density="compact" />);
    for (const f of FIXTURE_FIGURES) {
      expect(screen.getByRole('button', { name: f.name })).toBeInTheDocument();
    }
  });

  it('lays out fixed-height rows with native-aspect item widths', () => {
    const { container } = renderWithProviders(
      <JustifiedRows figures={FIXTURE_FIGURES} density="compact" />,
    );
    const rows = container.querySelectorAll('.jrows__row');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect((row as HTMLElement).style.height).toMatch(/px$/);
    }
  });

  it('reports taps with the figure and its flat index', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(
      <JustifiedRows figures={FIXTURE_FIGURES} density="compact" onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_FIGURES[4].name }));
    expect(onSelect).toHaveBeenCalledWith(FIXTURE_FIGURES[4], 4);
  });

  describe('nameplate labels (off by default)', () => {
    it('renders no captions when labels is not set', () => {
      const { container } = renderWithProviders(<JustifiedRows figures={FIXTURE_FIGURES} density="compact" />);
      expect(container.querySelector('.jrows__caption')).toBeNull();
    });

    it('renders no captions when labels is explicitly false', () => {
      const { container } = renderWithProviders(
        <JustifiedRows figures={FIXTURE_FIGURES} density="compact" labels={false} />,
      );
      expect(container.querySelector('.jrows__caption')).toBeNull();
    });

    it('shows a bottom-gradient caption with name + manufacturer when labels is on', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      const { container } = renderWithProviders(
        <JustifiedRows figures={[rem]} density="compact" labels />,
      );
      const caption = container.querySelector('.jrows__caption')!;
      expect(caption).not.toBeNull();
      expect(caption.querySelector('.jrows__caption-name')!.textContent).toBe(rem.name);
      expect(caption.querySelector('.jrows__caption-mfr')!.textContent).toBe(rem.manufacturer);
    });

    it('keeps the caption out of the accessible name (aria-hidden, decorative)', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      renderWithProviders(<JustifiedRows figures={[rem]} density="compact" labels />);
      expect(screen.getByRole('button', { name: rem.name })).toBeInTheDocument();
    });
  });

  describe('row-level virtualization (large collections)', () => {
    it('renders only a windowed subset of rows for a large collection with a real scroll container', async () => {
      mockScrollViewport(780);
      const many = getFixtureFigures(60);
      const { container } = renderWithProviders(
        <div class="app-content" style={{ height: '780px', overflow: 'auto' }}>
          <JustifiedRows figures={many} density="compact" />
        </div>,
      );
      await waitFor(() => {
        const rows = container.querySelectorAll('.jrows__row');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(40);
      });
    });

    it('renders every figure when no .app-content scroll ancestor is present (fallback)', () => {
      const many = getFixtureFigures(20);
      const { container } = renderWithProviders(<JustifiedRows figures={many} density="compact" />);
      expect(container.querySelectorAll('.jrows__item')).toHaveLength(many.length);
    });
  });
});

describe('JustifiedRows on local figures (WK-15)', () => {
  const local = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      _id: id,
      name: `Figure ${id}`,
      manufacturer: 'Alter',
      scale: '',
      userId: 'u',
      createdAt: '',
      updatedAt: '',
      quantity: 1,
      local: { headId: id, kind: 'owned', sync: 'known', asOf: null },
      ...extra,
    }) as never;

  it('draws a placeholder plate with the name and maker where there is no image', () => {
    const { container } = renderWithProviders(<JustifiedRows figures={[local('a')]} density="compact" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.jrows__plate')).toHaveTextContent('Figure aAlter');
    expect(screen.getByRole('button', { name: 'Figure a' })).toBeInTheDocument();
  });

  it('stacks: xN for more than one copy, nothing for one', () => {
    renderWithProviders(<JustifiedRows figures={[local('a', { quantity: 3 }), local('b')]} density="compact" />);
    expect(screen.getByRole('button', { name: 'Figure a' })).toHaveAttribute('data-quantity', '3');
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.queryByText('×1')).toBeNull();
  });

  it('carries one sync badge per item, as the item description', () => {
    renderWithProviders(
      <JustifiedRows
        figures={[local('a', { local: { headId: 'a', kind: 'owned', sync: 'pending', asOf: null } }), local('b')]}
        density="compact"
      />,
    );
    const a = screen.getByRole('button', { name: 'Figure a' });
    expect(a).toHaveAttribute('data-sync', 'pending');
    expect(a).toHaveAccessibleDescription('Pending');
    expect(screen.getByRole('button', { name: 'Figure b' })).toHaveAccessibleDescription('Synced');
  });

  it('shows selection in select mode', () => {
    renderWithProviders(<JustifiedRows figures={[local('a'), local('b')]} density="compact" isSelected={(f) => f._id === 'b'} />);
    expect(screen.getByRole('button', { name: 'Figure a' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Figure b' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks nothing on a fixture figure, which has no local state', () => {
    renderWithProviders(<JustifiedRows figures={FIXTURE_FIGURES.slice(0, 1)} density="compact" />);
    const b = screen.getByRole('button', { name: FIXTURE_FIGURES[0]!.name });
    expect(b).not.toHaveAttribute('data-sync');
    expect(b).not.toHaveAttribute('aria-pressed');
  });
});
