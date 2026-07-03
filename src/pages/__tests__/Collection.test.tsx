import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

// Mock the shared API helpers — this is the edge the tests exercise.
vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    getFigures: vi.fn(),
  };
});

import { getFigures } from '@figurecollecting/fc-shared';
import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGetFigures = getFigures as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      username: 'tester',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

function makeFigure(id: string) {
  return {
    _id: id,
    user: 'u1',
    manufacturer: 'Good Smile',
    name: `Figure ${id}`,
    scale: '1/7',
    mfcLink: '',
    imageUrl: '',
    location: '',
  } as any;
}

describe('Collection page', () => {
  beforeEach(() => mockedGetFigures.mockReset());

  it('renders skeleton cards while loading', async () => {
    signIn();
    // Resolve after a delay so we observe the skeleton before data arrives.
    mockedGetFigures.mockImplementation(
      () => new Promise((res) => {
        setTimeout(() => res({
          success: true,
          data: [makeFigure('late')],
          count: 1,
          page: 1,
          pages: 1,
          total: 1,
        }), 50);
      }),
    );
    const { container } = renderWithProviders(<Collection />, { initialPath: '/' });
    // The skeleton grid always contains at least one skeleton element.
    expect(container.querySelectorAll('.skeleton-card, [class*="skeleton"]').length).toBeGreaterThan(0);
    // Wait for the data to arrive so vitest teardown doesn't chase a promise.
    await screen.findByText('Figure late');
  });

  it('renders figures returned by the API', async () => {
    signIn();
    mockedGetFigures.mockResolvedValueOnce({
      success: true,
      data: [makeFigure('1'), makeFigure('2')],
      count: 2,
      page: 1,
      pages: 1,
      total: 2,
    });

    renderWithProviders(<Collection />, { initialPath: '/' });

    expect(await screen.findByText('Figure 1')).toBeInTheDocument();
    expect(await screen.findByText('Figure 2')).toBeInTheDocument();
  });

  it('shows the empty state when the collection has no figures', async () => {
    signIn();
    mockedGetFigures.mockResolvedValueOnce({
      success: true,
      data: [],
      count: 0,
      page: 1,
      pages: 0,
      total: 0,
    });

    renderWithProviders(<Collection />, { initialPath: '/' });

    expect(await screen.findByText(/your collection is empty/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry button when the API fails', async () => {
    const user = userEvent.setup();
    signIn();
    // First call fails, second succeeds (to verify Retry wires up).
    mockedGetFigures.mockRejectedValueOnce(new Error('boom'));
    mockedGetFigures.mockResolvedValueOnce({
      success: true,
      data: [makeFigure('retry-1')],
      count: 1,
      page: 1,
      pages: 1,
      total: 1,
    });

    renderWithProviders(<Collection />, { initialPath: '/' });

    expect(await screen.findByText(/couldn't load your collection/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    await user.click(retry);
    expect(await screen.findByText('Figure retry-1')).toBeInTheDocument();
  });

  it('shows an offline state when the fetch fails while offline', async () => {
    signIn();
    mockedGetFigures.mockRejectedValueOnce(new Error('offline'));

    renderWithProviders(<Collection />, { initialPath: '/' });

    // Flip the signal AFTER render so the useEffect listener is wired up in
    // time to catch the `offline` event.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));

    expect(await screen.findByText(/you're offline/i)).toBeInTheDocument();
  });

  it('shows the authenticated-but-no-data hint when the user is signed out', () => {
    renderWithProviders(<Collection />, { initialPath: '/' });
    expect(screen.getByText(/sign in to see your collection/i)).toBeInTheDocument();
  });

  it('shows the total count in the header when data is present', async () => {
    signIn();
    mockedGetFigures.mockResolvedValueOnce({
      success: true,
      data: [makeFigure('1'), makeFigure('2'), makeFigure('3')],
      count: 3, page: 1, pages: 1, total: 3,
    });
    renderWithProviders(<Collection />, { initialPath: '/' });
    expect(await screen.findByText(/collection \(3\)/i)).toBeInTheDocument();
  });
});
