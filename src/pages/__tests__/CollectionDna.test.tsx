import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

import { api } from '../../api/client';
import { CollectionDna } from '../CollectionDna';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

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

describe('CollectionDna page', () => {
  it('renders archetype, scores, and fun facts from the API response', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({
      data: {
        dna: {
          archetype: {
            type: 'SCALE PURIST',
            subtitle: 'Your shelves are curated galleries, not clutter.',
          },
          scores: { diversity: 72, rarity: 58, loyalty: 85 },
          topSeries: [{ label: 'Fate', count: 11 }],
          topManufacturers: [{ label: 'Good Smile Company', count: 14 }],
          scaleDistribution: [{ label: '1/7', value: 18, color: '#22c55e' }],
          funFacts: {
            favoriteCharacter: 'Saber',
            busiestMonth: 'March 2025',
            averagePrice: 16_800,
            estimatedValue: 789_600,
          },
        },
      },
    });

    renderWithProviders(<CollectionDna />, { initialPath: '/collection-dna' });

    expect(await screen.findByText('SCALE PURIST')).toBeInTheDocument();
    expect(screen.getByText('Saber')).toBeInTheDocument();
    expect(screen.getByText('Good Smile Company')).toBeInTheDocument();
  });

  it('renders a coming-soon placeholder when the endpoint is 404', async () => {
    signIn();
    apiGet.mockRejectedValueOnce({ response: { status: 404 } });

    renderWithProviders(<CollectionDna />, { initialPath: '/collection-dna' });

    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument();
  });

  it('renders an error state with retry on generic failures', async () => {
    signIn();
    apiGet.mockRejectedValueOnce({ response: { status: 500 } });

    renderWithProviders(<CollectionDna />, { initialPath: '/collection-dna' });

    expect(
      await screen.findByText(/couldn't analyze your collection/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
