import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';

const noop = () => {};

describe('DisplayToggle', () => {
  it('offers the A/B display modes with the active one checked', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" labels={false} onLayout={noop} onDensity={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('radio', { name: /display case/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /justified rows/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches layout on tap', async () => {
    const user = userEvent.setup();
    const onLayout = vi.fn();
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" onLayout={onLayout} onDensity={noop} />,
    );
    await user.click(screen.getByRole('radio', { name: /justified rows/i }));
    expect(onLayout).toHaveBeenCalledWith('rows');
  });

  it('a tap on the mode already showing changes nothing', async () => {
    const user = userEvent.setup();
    const onLayout = vi.fn();
    const { unmount } = renderWithProviders(<DisplayToggle layout="case" density="compact" onLayout={onLayout} onDensity={noop} />);
    await user.click(screen.getByRole('radio', { name: /display case/i }));
    unmount();
    renderWithProviders(<DisplayToggle layout="rows" density="compact" onLayout={onLayout} onDensity={noop} />);
    await user.click(screen.getByRole('radio', { name: /justified rows/i }));
    expect(onLayout).not.toHaveBeenCalled();
  });

  it('draws each density as its own grid: one tile, four, nine', () => {
    const tiles = (density: 'comfortable' | 'compact' | 'gallery') => {
      const { unmount } = renderWithProviders(<DisplayToggle layout="rows" density={density} onLayout={noop} onDensity={noop} />);
      const n = screen.getByRole('button', { name: /density/i }).querySelectorAll('rect').length;
      unmount();
      return n;
    };
    expect([tiles('comfortable'), tiles('compact'), tiles('gallery')]).toEqual([1, 4, 9]);
  });

  it('cycles density presets for the rows', async () => {
    const user = userEvent.setup();
    const onDensity = vi.fn();
    renderWithProviders(<DisplayToggle layout="rows" density="compact" onLayout={noop} onDensity={onDensity} />);
    await user.click(screen.getByRole('button', { name: /density: compact/i }));
    expect(onDensity).toHaveBeenCalledWith('gallery');
  });

  it('offers no density or motif in the case: the cabinet profile and the View card set its look', () => {
    renderWithProviders(<DisplayToggle layout="case" density="compact" onLayout={noop} onDensity={noop} />);
    expect(screen.queryByRole('button', { name: /density/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /motif/i })).toBeNull();
  });

  it('shows the nameplate labels toggle, off by default', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" labels={false} onLayout={noop} onDensity={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('button', { name: /labels: off/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects labels on when active', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" labels onLayout={noop} onDensity={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('button', { name: /labels: on/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles labels on tap', async () => {
    const user = userEvent.setup();
    const onLabels = vi.fn();
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" labels={false} onLayout={noop} onDensity={noop} onLabels={onLabels} />,
    );
    await user.click(screen.getByRole('button', { name: /labels: off/i }));
    expect(onLabels).toHaveBeenCalledWith(true);
  });
});
