import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({ applyUpdate: vi.fn(async () => undefined) }));
vi.mock('../updates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../updates')>()),
  applyUpdate: updates.applyUpdate,
}));

import { updateReady } from '../updates';
import { UpdatePrompt } from '../UpdatePrompt';

beforeEach(() => {
  updateReady.value = false;
  updates.applyUpdate.mockClear();
});

describe('UpdatePrompt', () => {
  it('shows nothing until a new version is waiting', () => {
    const { container } = render(<UpdatePrompt />);
    expect(container.innerHTML).toBe('');
  });

  it('offers the reload, which applies the waiting version', async () => {
    updateReady.value = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent(/new version/i);
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(updates.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('says so while the reload is under way', async () => {
    updates.applyUpdate.mockImplementationOnce(() => new Promise(() => {}));
    updateReady.value = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(screen.getByRole('button', { name: /updating/i })).toBeDisabled();
  });
});
