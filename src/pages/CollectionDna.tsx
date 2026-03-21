import { useCallback } from 'preact/hooks';
import { Header } from '../components/layout/Header';
import { ScoreRing } from '../components/dna/ScoreRing';
import { AffinityChips } from '../components/dna/AffinityChips';
import { DonutChart } from '../components/dna/DonutChart';
import { BarChart } from '../components/analytics/BarChart';
import { useCollectionDna, buildDnaSummary } from '../hooks/useCollectionDna';
import { useAuthStore } from '../stores/auth';

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="dna-back-btn"
      onClick={onClick}
      type="button"
      aria-label="Go back"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>

      <style>{`
        .dna-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast);
          margin-left: calc(-1 * var(--space-2));
        }

        .dna-back-btn:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }
      `}</style>
    </button>
  );
}

function formatYen(value: number): string {
  return `\u00a5${value.toLocaleString()}`;
}

async function handleShare(summary: string) {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'My Collection DNA',
        text: summary,
      });
      return;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }

  // Clipboard fallback
  try {
    await navigator.clipboard.writeText(summary);
    // Could show a toast here, but keeping it simple
  } catch {
    // Ignore — nothing else we can do
  }
}

export function CollectionDna() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: dna, isLoading } = useCollectionDna();

  const onShare = useCallback(() => {
    if (dna) handleShare(buildDnaSummary(dna));
  }, [dna]);

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div class="page-dna">
        <Header title="Collection DNA" leading={<BackButton onClick={() => history.back()} />} />
        <div class="dna__empty">
          <p>Sign in to discover your Collection DNA</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Loading
  if (isLoading || !dna) {
    return (
      <div class="page-dna">
        <Header title="Collection DNA" leading={<BackButton onClick={() => history.back()} />} />
        <div class="dna__loading">
          <div class="dna__loading-spinner" />
          <p class="dna__loading-text">Analyzing your collection...</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div class="page-dna">
      <Header title="Collection DNA" leading={<BackButton onClick={() => history.back()} />} />

      <div class="dna__content">

        {/* Hero Section */}
        <section class="dna__hero">
          <div class="dna__hero-bg" />
          <span class="dna__hero-eyebrow">Your collector type</span>
          <h2 class="dna__hero-type">{dna.archetype.type}</h2>
          <p class="dna__hero-subtitle">{dna.archetype.subtitle}</p>
        </section>

        {/* Score Rings */}
        <section class="dna__section">
          <div class="dna__rings">
            <ScoreRing score={dna.scores.diversity} label="Diversity" />
            <ScoreRing score={dna.scores.rarity} label="Rarity" />
            <ScoreRing score={dna.scores.loyalty} label="Loyalty" />
          </div>
        </section>

        {/* Top Series */}
        <section class="dna__section">
          <AffinityChips title="Your Top Series" items={dna.topSeries} />
        </section>

        {/* Manufacturers Bar Chart */}
        <section class="dna__section">
          <h3 class="dna__section-title">Your Go-To Manufacturers</h3>
          <div class="dna__card">
            <BarChart
              items={dna.topManufacturers.map((m) => ({
                label: m.label,
                value: m.count,
              }))}
              limit={6}
              barColor="var(--brand-400)"
              loading={false}
            />
          </div>
        </section>

        {/* Scale Distribution Donut */}
        <section class="dna__section">
          <div class="dna__card">
            <DonutChart
              title="Preferred Scales"
              segments={dna.scaleDistribution}
            />
          </div>
        </section>

        {/* Fun Facts */}
        <section class="dna__section">
          <h3 class="dna__section-title">Fun Facts</h3>
          <div class="dna__facts-card">
            <div class="dna__fact">
              <span class="dna__fact-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </span>
              <div class="dna__fact-text">
                <span class="dna__fact-label">Favorite character</span>
                <span class="dna__fact-value">{dna.funFacts.favoriteCharacter}</span>
              </div>
            </div>

            <div class="dna__fact">
              <span class="dna__fact-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-info)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <div class="dna__fact-text">
                <span class="dna__fact-label">Most active month</span>
                <span class="dna__fact-value">{dna.funFacts.busiestMonth}</span>
              </div>
            </div>

            <div class="dna__fact">
              <span class="dna__fact-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <div class="dna__fact-text">
                <span class="dna__fact-label">Average figure price</span>
                <span class="dna__fact-value">{formatYen(dna.funFacts.averagePrice)}</span>
              </div>
            </div>

            <div class="dna__fact">
              <span class="dna__fact-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </span>
              <div class="dna__fact-text">
                <span class="dna__fact-label">Estimated collection value</span>
                <span class="dna__fact-value dna__fact-value--highlight">{formatYen(dna.funFacts.estimatedValue)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Share Button */}
        <section class="dna__section dna__section--share">
          <button class="dna__share-btn" type="button" onClick={onShare}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share Your Collection DNA
          </button>
        </section>

      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-dna {
    min-height: 100%;
  }

  .dna__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-bottom: var(--space-12);
  }

  .dna__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    color: var(--text-secondary);
    font-size: var(--font-sm);
  }

  /* Loading */
  .dna__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-12) var(--space-4);
  }

  .dna__loading-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--surface-tertiary);
    border-top-color: var(--brand-500);
    border-radius: 50%;
    animation: dna-spin 0.7s linear infinite;
  }

  .dna__loading-text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
  }

  @keyframes dna-spin {
    to { transform: rotate(360deg); }
  }

  /* Hero */
  .dna__hero {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-8) var(--space-6) var(--space-6);
    overflow: hidden;
  }

  .dna__hero-bg {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(9, 103, 210, 0.25) 0%,
      rgba(139, 92, 246, 0.2) 50%,
      rgba(236, 72, 153, 0.15) 100%
    );
    z-index: 0;
  }

  .dna__hero-eyebrow {
    position: relative;
    z-index: 1;
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: var(--space-2);
  }

  .dna__hero-type {
    position: relative;
    z-index: 1;
    font-size: 2rem;
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
    letter-spacing: 0.02em;
    margin-bottom: var(--space-2);
  }

  .dna__hero-subtitle {
    position: relative;
    z-index: 1;
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
    max-width: 320px;
  }

  /* Sections */
  .dna__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-4);
  }

  .dna__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--space-1);
  }

  .dna__card {
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    padding: var(--space-4);
  }

  /* Score rings row */
  .dna__rings {
    display: flex;
    justify-content: space-around;
    padding: var(--space-2) 0;
  }

  /* Fun Facts */
  .dna__facts-card {
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  .dna__fact {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .dna__fact:last-child {
    border-bottom: none;
  }

  .dna__fact-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
  }

  .dna__fact-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .dna__fact-label {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  .dna__fact-value {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .dna__fact-value--highlight {
    color: var(--accent-success);
  }

  /* Share */
  .dna__section--share {
    padding: var(--space-2) var(--space-4) var(--space-4);
  }

  .dna__share-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-recommended);
    padding: var(--space-3) var(--space-4);
    background: linear-gradient(135deg, var(--brand-500), #8b5cf6);
    color: white;
    font-size: var(--font-base);
    font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-lg);
    transition: opacity var(--transition-fast);
  }

  .dna__share-btn:active {
    opacity: 0.85;
  }
`;
