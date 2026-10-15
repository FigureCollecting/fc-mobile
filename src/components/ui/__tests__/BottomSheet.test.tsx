import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

import { BottomSheet } from '../BottomSheet';
import { renderWithProviders } from '../../../test/testUtils';

describe('BottomSheet', () => {
  it('its handle is a button a finger lands on (not a control beside it); a card with one detent closes on its tap', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BottomSheet open onClose={onClose} snapPoint="fit">
        <button type="button">inside</button>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    renderWithProviders(
      <BottomSheet open={false} onClose={() => {}}>
        <p>hidden</p>
      </BottomSheet>,
    );
    expect(screen.queryByText('hidden')).toBeNull();
  });
});
