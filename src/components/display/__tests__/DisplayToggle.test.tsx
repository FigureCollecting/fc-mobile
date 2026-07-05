import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DisplayToggle } from '../DisplayToggle';
import { renderWithProviders } from '../../../test/testUtils';

const noop = () => {};

describe('DisplayToggle', () => {
  it('offers the A/B display modes with the active one checked', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" labels={false} onLayout={noop} onDensity={noop} onMotif={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('radio', { name: /display case/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /justified rows/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches layout on tap', async () => {
    const user = userEvent.setup();
    const onLayout = vi.fn();
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" onLayout={onLayout} onDensity={noop} onMotif={noop} />,
    );
    await user.click(screen.getByRole('radio', { name: /justified rows/i }));
    expect(onLayout).toHaveBeenCalledWith('rows');
  });

  it('cycles density presets', async () => {
    const user = userEvent.setup();
    const onDensity = vi.fn();
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" onLayout={noop} onDensity={onDensity} onMotif={noop} />,
    );
    await user.click(screen.getByRole('button', { name: /density: compact/i }));
    expect(onDensity).toHaveBeenCalledWith('gallery');
  });

  it('cycles case motifs only in case mode', async () => {
    const user = userEvent.setup();
    const onMotif = vi.fn();
    const { rerender } = renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" onLayout={noop} onDensity={noop} onMotif={onMotif} />,
    );
    await user.click(screen.getByRole('button', { name: /case motif/i }));
    expect(onMotif).toHaveBeenCalledWith('glass-clear');

    rerender(
      <DisplayToggle layout="rows" density="compact" motif="detolf-dark" onLayout={noop} onDensity={noop} onMotif={onMotif} />,
    );
    expect(screen.queryByRole('button', { name: /case motif/i })).toBeNull();
  });

  it('shows the nameplate labels toggle, off by default', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" labels={false} onLayout={noop} onDensity={noop} onMotif={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('button', { name: /labels: off/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects labels on when active', () => {
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" labels onLayout={noop} onDensity={noop} onMotif={noop} onLabels={noop} />,
    );
    expect(screen.getByRole('button', { name: /labels: on/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles labels on tap', async () => {
    const user = userEvent.setup();
    const onLabels = vi.fn();
    renderWithProviders(
      <DisplayToggle layout="case" density="compact" motif="detolf-dark" labels={false} onLayout={noop} onDensity={noop} onMotif={noop} onLabels={onLabels} />,
    );
    await user.click(screen.getByRole('button', { name: /labels: off/i }));
    expect(onLabels).toHaveBeenCalledWith(true);
  });
});
