import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { GatedScreen } from '../GatedScreen';
import { renderWithProviders } from '../../../test/testUtils';

describe('GatedScreen', () => {
  it('names the gated feature and explains the gate', () => {
    renderWithProviders(<GatedScreen feature="Price Tracker" />);
    expect(screen.getByText('Price Tracker')).toBeInTheDocument();
    expect(screen.getByText(/not in the mobile app yet/i)).toBeInTheDocument();
  });

  it('returns to the collection', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<GatedScreen feature="Analytics" />, {
      initialPath: '/analytics',
    });
    await user.click(screen.getByRole('button', { name: /back to collection/i }));
    expect(currentPath()).toBe('/');
  });
});
