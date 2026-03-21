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

// --- Mock data ---

const MOCK_DNA: CollectionDnaData = {
  archetype: {
    type: 'SCALE PURIST',
    subtitle: 'You value precision and presentation. Your shelves are curated galleries, not clutter.',
  },
  scores: {
    diversity: 72,
    rarity: 58,
    loyalty: 85,
  },
  topSeries: [
    { label: 'Fate Series', count: 11 },
    { label: 'Hatsune Miku', count: 7 },
    { label: 'Re:Zero', count: 5 },
    { label: 'Sword Art Online', count: 4 },
    { label: 'Demon Slayer', count: 3 },
    { label: 'Genshin Impact', count: 3 },
    { label: 'Spy x Family', count: 2 },
  ],
  topManufacturers: [
    { label: 'Good Smile Company', count: 14 },
    { label: 'Alter', count: 8 },
    { label: 'Kotobukiya', count: 6 },
    { label: 'Max Factory', count: 5 },
    { label: 'Bandai Spirits', count: 4 },
    { label: 'FREEing', count: 3 },
  ],
  scaleDistribution: [
    { label: '1/7', value: 18, color: 'var(--accent-success)' },
    { label: '1/8', value: 10, color: 'var(--accent-info)' },
    { label: '1/4', value: 5, color: 'var(--accent-warning)' },
    { label: 'Nendoroid', value: 8, color: '#8b5cf6' },
    { label: 'Other', value: 6, color: 'var(--text-tertiary)' },
  ],
  funFacts: {
    favoriteCharacter: 'Saber (Artoria Pendragon)',
    busiestMonth: 'March 2025',
    averagePrice: 16_800,
    estimatedValue: 789_600,
  },
};

// --- Hook ---

export function useCollectionDna() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CollectionDnaData>({
    queryKey: ['collection-dna'],
    queryFn: async () => {
      try {
        const response = await api.get('/analytics/collection/dna');
        return (response as { data: { dna: CollectionDnaData } }).data.dna;
      } catch {
        // API not available yet — serve mock data
        return MOCK_DNA;
      }
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
