import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DetailPane } from '../DetailPane';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

describe('DetailPane (Fold dual-pane, >= 640px)', () => {
  it('renders the figure detail content, not a full-screen takeover', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(
      <DetailPane figure={rem} index={0} total={7} onClose={() => {}} />,
    );
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    // No PhotoSwipe root, no fixed full-screen sheet — just the pane.
    expect(container.querySelector('.pswp')).toBeNull();
    expect(document.body.querySelector('.figure-viewer-sheet')).toBeNull();
  });

  it('a pane, not a sheet: no handle, and every field shown (SHEETS-FB1 6)', () => {
    const dark = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!;
    const { container } = renderWithProviders(<DetailPane figure={dark} index={1} total={7} onClose={() => {}} />);
    expect(container.querySelector('.figure-viewer-sheet__handle')).toBeNull();
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
  });

  it('asks for its image with crossorigin anonymous, a CORS request (src/sw.ts)', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    expect(container.querySelector('.detail-pane__image')).toHaveAttribute('crossorigin', 'anonymous');
  });

  it('draws the placeholder when the image fails to load', async () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    expect(container.querySelector('.detail-pane__placeholder')).toBeNull();
    fireEvent.error(container.querySelector('.detail-pane__image')!);
    await waitFor(() => expect(container.querySelector('.detail-pane__placeholder')).not.toBeNull());
    expect(container.querySelector('.detail-pane__image')).toBeNull();
  });

  it('calls onClose when the close button is tapped', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close detail/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes it, and so does Back: it opens a history entry (SHEETS-FB1 6c)', async () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await new Promise((r) => setTimeout(r, 30));
    const onBack = vi.fn();
    renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onBack} />);
    history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });
});
