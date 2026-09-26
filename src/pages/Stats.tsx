import { SlimHeader } from '../components/layout/SlimHeader';
import { useCollectionStats } from '../hooks/useCollectionStats';
import { useCollectionBreakdown } from '../hooks/useAnalytics';
import { useAuthStore } from '../stores/auth';

/**
 * Stats tab — compact at-a-glance numbers. The full Analytics experience is
 * gated until its own mobile condensation pass; this stays intentionally slim.
 */
export function Stats() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: counts } = useCollectionStats();
  const { data: manufacturers } = useCollectionBreakdown('manufacturer');

  if (!isAuthenticated) {
    return (
      <div class="page-stats">
        <p class="page-stats__empty">Sign in to see your stats</p>
        <style>{styles}</style>
      </div>
    );
  }

  const tiles = [
    { label: 'Total', value: counts?.total ?? 0, tone: 'var(--brand-400)' },
    { label: 'Owned', value: counts?.owned ?? 0, tone: 'var(--accent-success)' },
    { label: 'Ordered', value: counts?.ordered ?? 0, tone: 'var(--accent-info)' },
    { label: 'Wished', value: counts?.wished ?? 0, tone: 'var(--accent-warning)' },
  ];

  const topMakers = (manufacturers ?? []).slice(0, 8);
  const maxCount = topMakers[0]?.count ?? 1;

  return (
    <div class="page-stats">
      <SlimHeader context={<span>Stats</span>} />

      <div class="page-stats__tiles">
        {tiles.map((t) => (
          <div key={t.label} class="page-stats__tile">
            <span class="page-stats__value" style={{ color: t.tone }}>{t.value}</span>
            <span class="page-stats__label">{t.label}</span>
          </div>
        ))}
      </div>

      {topMakers.length > 0 && (
        <section class="page-stats__section">
          <h3 class="page-stats__section-title">Top manufacturers</h3>
          {topMakers.map((m) => (
            <div key={m._id} class="page-stats__bar-row">
              <span class="page-stats__bar-label">{m.label ?? m._id}</span>
              <div class="page-stats__bar-track">
                <div
                  class="page-stats__bar-fill"
                  style={{ width: `${Math.max(4, Math.round((m.count / maxCount) * 100))}%` }}
                />
              </div>
              <span class="page-stats__bar-count">{m.count}</span>
            </div>
          ))}
        </section>
      )}

      <p class="page-stats__gated-note">
        Deeper analytics arrive after their mobile redesign pass.
      </p>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-stats {
    padding-bottom: var(--space-6);
  }

  .page-stats__empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-page);
    font-size: var(--font-sm);
  }

  .page-stats__tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-gap);
    padding: var(--space-2) var(--space-page);
  }

  .page-stats__tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: var(--surface-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-1);
  }

  .page-stats__value {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-tight);
  }

  .page-stats__label {
    font-size: var(--font-2xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .page-stats__section {
    padding: var(--space-3) var(--space-page);
  }

  .page-stats__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-2);
  }

  .page-stats__bar-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 24px;
  }

  .page-stats__bar-label {
    flex: 0 0 38%;
    font-size: var(--font-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .page-stats__bar-track {
    flex: 1;
    height: 6px;
    background: var(--surface-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .page-stats__bar-fill {
    height: 100%;
    background: var(--brand-500);
    border-radius: var(--radius-full);
  }

  .page-stats__bar-count {
    flex: 0 0 24px;
    text-align: right;
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .page-stats__gated-note {
    padding: var(--space-4) var(--space-page);
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    text-align: center;
  }
`;
