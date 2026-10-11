import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LAST_BUILD_KEY } from '../storage';
import { UpdatedNotice } from '../UpdatedNotice';

describe('UpdatedNotice', () => {
  it('names the new build after an update, once, and can be dismissed', async () => {
    localStorage.setItem(LAST_BUILD_KEY, 'build-41');
    render(<UpdatedNotice buildId="build-42" />);
    expect(screen.getByRole('status')).toHaveTextContent('Updated to build build-42');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/updated to build/i)).toBeNull();

    cleanup();
    render(<UpdatedNotice buildId="build-42" />);
    expect(screen.queryByText(/updated to build/i)).toBeNull();
  });

  it('shows nothing on the first install', () => {
    const { container } = render(<UpdatedNotice buildId="build-42" />);
    expect(container.innerHTML).toBe('');
    expect(localStorage.getItem(LAST_BUILD_KEY)).toBe('build-42');
  });

  it('shows nothing when the build is unchanged', () => {
    localStorage.setItem(LAST_BUILD_KEY, 'build-42');
    const { container } = render(<UpdatedNotice buildId="build-42" />);
    expect(container.innerHTML).toBe('');
  });

  it("names this build's id by default", () => {
    localStorage.setItem(LAST_BUILD_KEY, `before-${import.meta.env.VITE_BUILD_ID}`);
    render(<UpdatedNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(`Updated to build ${import.meta.env.VITE_BUILD_ID}`);
  });
});
