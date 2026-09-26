import { render, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallBanner } from '../InstallBanner';

afterEach(() => sessionStorage.clear());

describe('InstallBanner', () => {
  it('shows nothing outside an iOS browser tab', () => {
    const { container } = render(<InstallBanner isIosTab={() => false} unsyncedCount={async () => 0} />);
    expect(container.innerHTML).toBe('');
  });

  it('asks an iOS tab to install before any data is kept, with the Share steps', async () => {
    render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => 0} />);
    expect(await screen.findByText('Install to keep offline data')).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it('holds the install steps back while edits made in this tab are unsynced', async () => {
    render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => 2} />);
    expect(await screen.findByText(/2 edits in this tab are waiting to sync/i)).toBeInTheDocument();
    expect(screen.getByText(/installed app re-syncs from the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/add to home screen/i)).toBeNull();
  });

  it('uses the singular for one edit', async () => {
    render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => 1} />);
    expect(await screen.findByText(/1 edit in this tab is waiting to sync/i)).toBeInTheDocument();
  });

  it('shows the steps when the outbox cannot be read', async () => {
    render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => Promise.reject(new Error('x'))} />);
    expect(await screen.findByText(/add to home screen/i)).toBeInTheDocument();
  });

  it('re-reads the outbox, so the steps appear once it drains', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 1;
    render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => n} pollMs={1000} />);
    expect(await screen.findByText(/1 edit in this tab/i)).toBeInTheDocument();
    n = 0;
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(screen.getByText(/add to home screen/i)).toBeInTheDocument());
    vi.useRealTimers();
  });

  it('can be put off for this session', async () => {
    const { container } = render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => 0} />);
    await userEvent.click(await screen.findByRole('button', { name: /not now/i }));
    expect(container.innerHTML).toBe('');
    const again = render(<InstallBanner isIosTab={() => true} unsyncedCount={async () => 0} />);
    expect(again.container.innerHTML).toBe('');
  });
});
