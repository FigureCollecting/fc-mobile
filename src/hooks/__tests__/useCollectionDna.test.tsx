import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '../../api/client';
import { useCollectionDna, buildDnaSummary } from '../useCollectionDna';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: unknown }) => (
    <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
  );
}

describe('useCollectionDna', () => {
  it('returns the DNA payload on success', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({
      data: {
        dna: {
          archetype: { type: 'NERD', subtitle: 'You collect.' },
          scores: { diversity: 1, rarity: 2, loyalty: 3 },
          topSeries: [],
          topManufacturers: [],
          scaleDistribution: [],
          funFacts: {
            favoriteCharacter: 'X',
            busiestMonth: 'January',
            averagePrice: 1,
            estimatedValue: 2,
          },
        },
      },
    });

    const { result } = renderHook(() => useCollectionDna(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.archetype.type).toBe('NERD');
  });

  it('propagates failures (no mock fallback)', async () => {
    signIn();
    apiGet.mockRejectedValueOnce({ response: { status: 500 } });
    const { result } = renderHook(() => useCollectionDna(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('buildDnaSummary renders plaintext with expected sections', () => {
    const text = buildDnaSummary({
      archetype: { type: 'ARCH', subtitle: 'Sub' },
      scores: { diversity: 10, rarity: 20, loyalty: 30 },
      topSeries: [{ label: 'Fate', count: 5 }, { label: 'Miku', count: 3 }, { label: 'SAO', count: 2 }, { label: 'Extra', count: 1 }],
      topManufacturers: [{ label: 'GSC', count: 7 }],
      scaleDistribution: [],
      funFacts: { favoriteCharacter: 'Saber', busiestMonth: 'Feb', averagePrice: 1, estimatedValue: 999 },
    });
    expect(text).toContain('My Collection DNA: ARCH');
    expect(text).toContain('Diversity: 10/100');
    expect(text).toContain('Top Series: Fate, Miku, SAO');
    expect(text).toContain('Go-To Maker: GSC');
    expect(text).toContain('figurecollecting.com');
  });
});
