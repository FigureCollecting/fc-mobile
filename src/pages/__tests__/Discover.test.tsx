import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

const pswpInstances: any[] = [];
class FakePswp {
  options: any;
  handlers: Record<string, () => void> = {};
  currIndex: number;
  constructor(options: any) {
    this.options = options;
    this.currIndex = options.index ?? 0;
    pswpInstances.push(this);
  }
  on(event: string, cb: () => void) { this.handlers[event] = cb; }
  init() {}
  destroy() { this.handlers['destroy']?.(); }
}
vi.mock('photoswipe', () => ({ default: FakePswp }));
vi.mock('photoswipe/style.css', () => ({}));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    searchFigures: vi.fn(),
    getFigures: vi.fn().mockResolvedValue({
      success: true, data: [], count: 0, page: 1, pages: 0, total: 0,
    }),
  };
});

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: { breakdown: [] } }),
      post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    },
  };
});

import { searchFigures } from '@figurecollecting/fc-shared';
import { Discover } from '../Discover';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedSearch = searchFigures as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      username: 't',
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

function makeResult(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Figure ${id}`,
    manufacturer: 'Good Smile',
    scale: '1/7',
    mfcLink: '',
    imageUrl: `https://example.com/${id}.png`,
    ...extra,
  };
}

describe('Discover page', () => {
  beforeEach(() => {
    pswpInstances.length = 0;
  });

  afterEach(() => localStorage.clear());

  it('renders the search field and a default placeholder', () => {
    signIn();
    renderWithProviders(<Discover />, { initialPath: '/discover' });
    expect(screen.getByPlaceholderText(/search figures/i)).toBeInTheDocument();
    expect(screen.getByText(/browse the catalog/i)).toBeInTheDocument();
  });

  it('shows a retry error state when search fails', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockRejectedValue(new Error('boom'));

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'abc');

    expect(await screen.findByText(/search failed/i)).toBeInTheDocument();
  });

  it('shows empty state when the search returns no matches', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockResolvedValue([]);

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'nothing-like-this-exists');

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });

  it('renders matches as condensed justified rows', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockResolvedValue([makeResult('1'), makeResult('2')]);

    const { container } = renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'figure');

    await screen.findByRole('button', { name: 'Figure 1' });
    expect(container.querySelector('.jrows')).not.toBeNull();
  });

  it('opens the full-screen viewer on tap, over the current result set', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockResolvedValue([makeResult('1'), makeResult('2'), makeResult('3')]);

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'figure');

    await user.click(await screen.findByRole('button', { name: 'Figure 2' }));
    await waitFor(() => expect(pswpInstances).toHaveLength(1));
    expect(pswpInstances[0].options.index).toBe(1);
    expect(pswpInstances[0].options.dataSource).toHaveLength(3);
  });

  it('saves the query as a recent search when a result is tapped', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockResolvedValue([makeResult('1')]);

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'figure');
    await user.click(await screen.findByRole('button', { name: 'Figure 1' }));

    expect(JSON.parse(localStorage.getItem('fc-recent-searches') ?? '[]')).toContain('figure');
  });
});
