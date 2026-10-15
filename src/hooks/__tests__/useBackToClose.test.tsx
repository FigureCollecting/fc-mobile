import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useBackToClose } from '../useBackToClose';

function Overlay({ onClose }: { onClose: () => void }) {
  useBackToClose(onClose);
  return <div>overlay</div>;
}

/** Let jsdom run the history traversal history.back() queued, and its popstate. */
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(async () => {
  await settle();
  history.replaceState(null, '', '/');
});

describe('useBackToClose: Android Back / browser Back closes an overlay (SHEETS-FB1 6c)', () => {
  it('opens one history entry; Back closes the overlay, once', async () => {
    const before = history.length;
    const onClose = vi.fn();
    render(<Overlay onClose={onClose} />);
    expect(history.length).toBe(before + 1);
    history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed another way (X, Esc, a swipe), it takes its entry back off, and that pop closes no overlay opened meanwhile', async () => {
    history.replaceState(null, '', '/?layout=case');
    const first = vi.fn();
    const { unmount } = render(<Overlay onClose={first} />);
    unmount();
    // a second one opens before the browser has run the first one's Back
    const second = vi.fn();
    const { unmount: unmountSecond } = render(<Overlay onClose={second} />);
    await settle();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(location.search).toBe('?layout=case');
    // and Back still closes the second
    history.back();
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    unmountSecond();
    await settle();
  });

  it('keeps the address as it stands when it closes: a filter changed while it was open survives an X and a Back', async () => {
    history.replaceState(null, '', '/?layout=case');
    const { unmount } = render(<Overlay onClose={() => {}} />);
    // the page writes its filters in place (replaceState) while the overlay is open
    history.replaceState(history.state, '', '/?layout=case&mfr=Alter');
    unmount();
    await settle();
    expect(location.search).toBe('?layout=case&mfr=Alter');

    const onClose = vi.fn();
    const { rerender, unmount: unmountAgain } = render(<Overlay onClose={onClose} />);
    history.replaceState(history.state, '', '/?layout=case&mfr=Kotobukiya');
    rerender(<Overlay onClose={onClose} />);
    history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(location.search).toBe('?layout=case&mfr=Kotobukiya');
    unmountAgain();
    await settle();
  });

  it('left by a navigation to another page, it does not go back (that would undo the navigation)', async () => {
    history.replaceState(null, '', '/');
    const { unmount } = render(<Overlay onClose={() => {}} />);
    history.replaceState(null, '', '/figure/h1');
    unmount();
    await settle();
    expect(location.pathname).toBe('/figure/h1');
  });
});
