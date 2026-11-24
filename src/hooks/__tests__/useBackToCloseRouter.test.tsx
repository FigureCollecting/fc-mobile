import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act, render } from '@testing-library/preact';
import { useBackToClose } from '../useBackToClose';

/**
 * Its own file: the router's popstate listener (wouter's, added as the app mounts) goes on the window after this module
 * has loaded and before any overlay opens, as in the app. What the router reads at a popstate is the page it renders:
 * in a browser its render lands before a later listener runs (a microtask between listeners), so a popstate that reads
 * the address an overlay's entry was pushed at draws that old page for a moment (FIX4: Go to from the cover viewer drew
 * the tiles again between the case's two mounts, and the first mount's Go to was lost with it).
 */
const routerRead: string[] = [];
beforeAll(() => {
  window.addEventListener('popstate', () => routerRead.push(location.search));
});

function Overlay() {
  useBackToClose(() => {});
  return null;
}

/** Let jsdom run the history traversal queued, and its popstate. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));

afterEach(async () => {
  await settle();
  routerRead.length = 0;
  history.replaceState(null, '', '/');
});

describe('useBackToClose under the router: the router never reads the address an overlay took its entry off at', () => {
  it('closed by the app as the page writes a new layout (Go to closes the card), the router reads only the new layout', async () => {
    history.replaceState(null, '', '/?layout=rows');
    const overlay = render(<Overlay />);
    // Go to, in one handler: the page writes the case into its address in place, and the card closes
    history.replaceState(history.state, '', '/?layout=case');
    overlay.unmount();
    await settle();
    expect(location.search).toBe('?layout=case');
    expect(routerRead).toEqual(['?layout=case']);
  });

  it('closed by Back after the page wrote a filter, the router reads the filtered address, never the one before it', async () => {
    history.replaceState(null, '', '/?layout=case');
    const overlay = render(<Overlay />);
    history.replaceState(history.state, '', '/?layout=case&mfr=Alter');
    // the page renders after its write, and the overlay with it
    overlay.rerender(<Overlay />);
    history.back();
    await settle();
    expect(location.search).toBe('?layout=case&mfr=Alter');
    expect(routerRead).toEqual(['?layout=case&mfr=Alter']);
  });
});
