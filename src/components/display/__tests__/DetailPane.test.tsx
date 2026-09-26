import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
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

  it('calls onClose when the close button is tapped', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close detail/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
