import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

// --- Types ---

export interface CollectorArchetype {
  type: string;
  subtitle: string;
}

export interface DnaScores {
  diversity: number;
  rarity: number;
  loyalty: number;
}

export interface AffinityItem {
  label: string;
  count: number;
}

export interface ScaleSegment {
  label: string;
  value: number;
  color: string;
}

export interface FunFacts {
  favoriteCharacter: string;
  busiestMonth: string;
  averagePrice: number;
  estimatedValue: number;
}

export interface CollectionDnaData {
  archetype: CollectorArchetype;
  scores: DnaScores;
  topSeries: AffinityItem[];
  topManufacturers: AffinityItem[];
  scaleDistribution: ScaleSegment[];
  funFacts: FunFacts;
}

// --- Hook ---
// Previously fell back to fabricated DNA when the endpoint 404'd. That hid
// real backend failures; now the error propagates so the page can render an
// honest state.

export function useCollectionDna() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CollectionDnaData>({
    queryKey: ['collection-dna'],
    queryFn: async () => {
      const response = await api.get('/analytics/collection/dna');
      return (response as { data: { dna: CollectionDnaData } }).data.dna;
    },
    enabled: isAuthenticated,
    staleTime: 10 * 60_000, // 10 min cache
  });
}

/**
 * Build a plain-text summary of the collector DNA for sharing.
 */
export function buildDnaSummary(dna: CollectionDnaData): string {
  const lines = [
    `My Collection DNA: ${dna.archetype.type}`,
    dna.archetype.subtitle,
    '',
    `Diversity: ${dna.scores.diversity}/100`,
    `Rarity: ${dna.scores.rarity}/100`,
    `Loyalty: ${dna.scores.loyalty}/100`,
    '',
    `Top Series: ${dna.topSeries.slice(0, 3).map((s) => s.label).join(', ')}`,
    `Go-To Maker: ${dna.topManufacturers[0]?.label ?? 'N/A'}`,
    `Favorite Character: ${dna.funFacts.favoriteCharacter}`,
    `Est. Collection Value: \u00a5${dna.funFacts.estimatedValue.toLocaleString()}`,
    '',
    'figurecollecting.com',
  ];
  return lines.join('\n');
}
