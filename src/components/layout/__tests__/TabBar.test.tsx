import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { act, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';
import { useChromeStore } from '../../../stores/chrome';
import { offerJog, useJogStore } from '../../../stores/jog';
import { hostAddInHeader, openAdd, useAddStore } from '../../../stores/add';
import { HeaderAdd } from '../HeaderAdd';
import { localSession } from '../../../local/session';
import { stubSessionStatus } from '../../../test/sessionStatus';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';

beforeEach(() => {
  useChromeStore.setState({ hidden: false });
  useJogStore.setState({ target: null });
  useAddStore.setState({ open: false, inHeader: 0 });
  // Add is for account holders (SIGNED-OUT-ADD): the bar's own tests run signed in.
  stubSessionStatus('signed-in');
});

afterEach(() => {
  localSession.value = undefined;
});

// SIGNED-OUT-ADD (Ross, phone, 11-23): signed out the collection showed the bar's raised +, the pre-rework look. Adding
// figures needs an account, so while signed out (or while the session is still loading: never a flash of +) no Add shows
// and the sheet never opens; the dock stays so no tab moves. Signed in, ADDFAB b stands as it was.
describe('TabBar: no Add while signed out (SIGNED-OUT-ADD)', () => {
  const addButton = () => document.querySelector('.tab-bar__add');
  const tabs = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

  it('signed out: no +, the dock and the four tabs stay where they are', () => {
    stubSessionStatus('signed-out');
    const { container } = renderWithProviders(<TabBar />);
    expect(addButton()).toBeNull();
    expect(screen.queryByRole('button', { name: /add figures/i })).toBeNull();
    expect(container.querySelector('.tab-bar__dock')).not.toBeNull();
    expect(tabs()).toEqual(['Collection', 'Search', 'Stats', 'Profile']);
  });

  it('still loading (no session yet, or a session whose status is loading): no + flashes', () => {
    stubSessionStatus(undefined);
    const first = renderWithProviders(<TabBar />);
    expect(addButton()).toBeNull();
    first.unmount();
    stubSessionStatus('loading');
    const { container } = renderWithProviders(<TabBar />);
    expect(addButton()).toBeNull();
    expect(container.querySelector('.tab-bar__dock')).not.toBeNull();
  });

  it('loading settles to signed in: the + arrives; signing out takes it away', () => {
    const status = stubSessionStatus('loading');
    renderWithProviders(<TabBar />);
    expect(addButton()).toBeNull();
    act(() => {
      status.value = 'signed-in';
    });
    expect(addButton()).not.toBeNull();
    act(() => {
      status.value = 'signed-out';
    });
    expect(addButton()).toBeNull();
  });

  it('signed in on a page with no header Add: the + is in the bar', () => {
    renderWithProviders(<TabBar />);
    expect(addButton()).not.toBeNull();
  });

  it('signed in on the collection (header hosts Add): the + is away and the header has the one Add', () => {
    renderWithProviders(<TabBar />);
    renderWithProviders(<HeaderAdd />);
    expect(addButton()).toBeNull();
    expect(screen.getAllByRole('button', { name: /add figures/i })).toHaveLength(1);
  });

  it.each(['offline', 'reauth-required', 'reload-required'] as const)('an account holder whose session is %s keeps the +', (status) => {
    stubSessionStatus(status);
    renderWithProviders(<TabBar />);
    expect(addButton()).not.toBeNull();
  });

  it('signed out, the Add sheet never shows, even with the store set open', () => {
    stubSessionStatus('signed-out');
    renderWithProviders(<TabBar />);
    act(() => {
      useAddStore.setState({ open: true });
    });
    expect(screen.queryByText(/import your mfc export/i)).toBeNull();
  });

  it('dev fixture mode (no account, the demo collection) keeps the + signed out', () => {
    setFixtureMode(true);
    stubSessionStatus('signed-out');
    renderWithProviders(<TabBar />);
    expect(addButton()).not.toBeNull();
  });
});

describe('TabBar', () => {
  it('renders the 4 tab slots and the docked Add action', () => {
    renderWithProviders(<TabBar />);
    for (const label of ['Collection', 'Search', 'Stats', 'Profile']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /add figures/i })).toBeInTheDocument();
  });

  it('navigates when a tab is pressed', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(currentPath()).toBe('/stats');
  });

  it('opens the Add sheet with the import and the barcode lookup', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    // MFC Sync has no backend (src/config/features.ts) and is off by default.
    expect(screen.queryByText(/sync from mfc/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    await user.click(screen.getByText(/look up a barcode/i));
    expect(currentPath()).toBe('/discover');
  });

  it('carries no notification badge: notifications have no backend', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('slides away when chrome is hidden', () => {
    useChromeStore.setState({ hidden: true });
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.tab-bar--hidden')).not.toBeNull();
  });
});

// NAV-FLOAT (handoff FINAL 11-17): the bottom-centre button is no jog any more (the hat floats over the case: NavHat); it
// is the plain Add button whatever the case offers. ADDFAB b: where the header hosts Add (the collection, beside
// Case / Tiles) the raised + leaves the bar, its dock kept so no tab moves, and the one Add sheet opens from either.
describe('TabBar: the Add button after the jog (NAV-FLOAT)', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const addButton = () => document.querySelector('.tab-bar__add') as HTMLElement | null;

  it('the bar and its Add button are the DOM they were before the jog, to the byte (hashed from fe967a7..4bedd00)', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(hash(container.querySelector('.tab-bar')!.outerHTML)).toBe('4e9b61312f46cbbc');
  });

  it('a jog on offer changes nothing: the + is the Add button, with no data-jog, no knob and no move label', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<TabBar />);
    const before = container.querySelector('.tab-bar')!.outerHTML;
    act(() => {
      offerJog({ start: () => true, aim: () => {}, stop: () => {}, depth: { start: () => true, rate: () => {}, stop: () => {} } });
    });
    expect(container.querySelector('.tab-bar')!.outerHTML).toBe(before);
    expect(addButton()!.hasAttribute('data-jog')).toBe(false);
    expect(container.querySelector('.tab-bar__jog-knob')).toBeNull();
    expect(screen.queryByRole('button', { name: /move the camera/i })).toBeNull();
    // and a tap is the menu
    await user.click(addButton()!);
    expect(screen.getByText(/import your mfc export/i)).toBeInTheDocument();
  });

  it('the header hosts Add: the raised + leaves the bar, its dock and the four tabs stay; released, the + is back', () => {
    const { container } = renderWithProviders(<TabBar />);
    const before = container.querySelector('.tab-bar')!.outerHTML;
    let release = () => {};
    act(() => {
      release = hostAddInHeader();
    });
    expect(addButton()).toBeNull();
    expect(container.querySelector('.tab-bar__dock')).not.toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Collection', 'Search', 'Stats', 'Profile']);
    act(() => release());
    expect(container.querySelector('.tab-bar')!.outerHTML).toBe(before);
  });

  it('two hosts (a page leaving as the next arrives): the + stays away until both have let go; a second release of one is nothing', () => {
    renderWithProviders(<TabBar />);
    let a = () => {};
    let b = () => {};
    act(() => {
      a = hostAddInHeader();
      b = hostAddInHeader();
    });
    act(() => a());
    act(() => a());
    expect(addButton()).toBeNull();
    act(() => b());
    expect(addButton()).not.toBeNull();
  });

  it('the Add sheet is the bar\'s wherever Add is pressed: opened from the store it shows, and its choice closes it', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    act(() => {
      hostAddInHeader();
      openAdd();
    });
    await user.click(screen.getByText(/look up a barcode/i));
    expect(currentPath()).toBe('/discover');
    expect(useAddStore.getState().open).toBe(false);
  });
});
