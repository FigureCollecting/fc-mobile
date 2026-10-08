import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { SyncState } from '../../../sync/engine';
import { SyncStatusLine } from '../SyncStatusLine';

const base: SyncState = { reachability: 'reachable', phase: 'idle', pending: 0, rejected: [], overwritten: 0, lastSyncedAt: null, lastError: null };

function show(patch: Partial<SyncState>, onDismissRejected = vi.fn()) {
  const state = signal<SyncState>({ ...base, ...patch });
  render(<SyncStatusLine state={state} onDismissRejected={onDismissRejected} />);
  return { state, onDismissRejected };
}

describe('SyncStatusLine', () => {
  it('shows nothing while everything is synced', () => {
    show({});
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("reads 'can't reach server' with the edits waiting, and keeps them on the device", () => {
    show({ reachability: 'unreachable', pending: 4 });
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach server. 4 changes waiting to sync. Your changes are kept on this device.");
    expect(screen.getByRole('status')).toHaveAttribute('data-pending', '4');
  });

  it("reads 'can't reach server' alone when nothing waits", () => {
    show({ reachability: 'unreachable' });
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach server. Your changes are kept on this device.");
  });

  it('counts the edits waiting while the server is reachable', () => {
    show({ pending: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting to sync.');
  });

  it("says when another device overwrote this device's edits", () => {
    show({ overwritten: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('1 edit overwritten by another device.');
  });

  it('pluralises the overwritten count', () => {
    show({ overwritten: 3 });
    expect(screen.getByRole('status')).toHaveTextContent('3 edits overwritten by another device.');
  });

  it('shows the REJECTED edits by their reason codes, until dismissed', () => {
    const { onDismissRejected } = show({
      rejected: [
        { id: 1, facet_key: 'uf/x/note', reason: 'payload_invalid: too long' },
        { id: 2, facet_key: 'uf/y/note', reason: 'payload_invalid' },
        { id: 3, facet_key: 'uf/z/note', reason: '' },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('3 changes could not be saved (payload_invalid, refused).');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissRejected).toHaveBeenCalledTimes(1);
  });

  it('follows the state as it changes', async () => {
    const { state } = show({});
    state.value = { ...base, reachability: 'unreachable' };
    expect(await screen.findByRole('status')).toHaveTextContent("Can't reach server.");
  });
});
