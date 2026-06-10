import { useState, useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { useCollectionStats } from '../hooks/useCollectionStats';
import { api } from '../api/client';
import { exportCollectionCsv, exportCollectionJson } from '../utils/export';
import { shareCollectionSummary } from '../utils/share';
import { hapticLight } from '../utils/haptics';

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="export__back-btn"
      type="button"
      onClick={onClick}
      aria-label="Go back"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

interface ExportCardProps {
  icon: preact.ComponentChildren;
  title: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
}

function ExportCard({ icon, title, description, onClick, loading }: ExportCardProps) {
  return (
    <button
      class="export__card"
      type="button"
      onClick={onClick}
      disabled={loading}
    >
      <div class="export__card-icon">{icon}</div>
      <div class="export__card-body">
        <span class="export__card-title">{title}</span>
        <span class="export__card-desc">{description}</span>
      </div>
      <div class="export__card-arrow">
        {loading ? (
          <div class="export__spinner" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
    </button>
  );
}

export function Export() {
  const [, setLocation] = useLocation();
  const { data: stats } = useCollectionStats();
  const [csvLoading, setCsvLoading] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  const handleBack = useCallback(() => {
    setLocation('/profile');
  }, [setLocation]);

  const handleExportCsv = useCallback(async () => {
    hapticLight();
    setCsvLoading(true);
    try {
      await exportCollectionCsv(api);
    } finally {
      setCsvLoading(false);
    }
  }, []);

  const handleExportJson = useCallback(async () => {
    hapticLight();
    setJsonLoading(true);
    try {
      await exportCollectionJson(api);
    } finally {
      setJsonLoading(false);
    }
  }, []);

  const handleShareWithFullStats = useCallback(async () => {
    if (!stats) return;
    hapticLight();
    setShareLoading(true);
    try {
      // Fetch full stats for manufacturer and scale counts
      const { getFigureStats } = await import('@figurecollecting/fc-shared');
      const fullStats = await getFigureStats(api);
      await shareCollectionSummary({
        owned: stats.owned,
        ordered: stats.ordered,
        wished: stats.wished,
        manufacturers: fullStats.manufacturerStats?.length ?? 0,
        scales: fullStats.scaleStats?.length ?? 0,
      });
    } catch {
      // Fallback: share without manufacturer/scale counts
      await shareCollectionSummary({
        owned: stats.owned,
        ordered: stats.ordered,
        wished: stats.wished,
        manufacturers: 0,
        scales: 0,
      });
    } finally {
      setShareLoading(false);
    }
  }, [stats]);

  return (
    <div class="page-export">
      <Header title="Export & Share" leading={<BackButton onClick={handleBack} />} />

      <div class="export__content">
        <p class="export__intro">
          Export your collection data or share a summary with friends.
        </p>

        <div class="export__cards">
          <ExportCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            }
            title="Export as CSV"
            description="Download a spreadsheet-compatible file of your collection."
            onClick={handleExportCsv}
            loading={csvLoading}
          />

          <ExportCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-info)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <path d="M9 15l3 3 3-3" />
              </svg>
            }
            title="Export as JSON"
            description="Download a structured data file for backups or migration."
            onClick={handleExportJson}
            loading={jsonLoading}
          />

          <ExportCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            }
            title="Share Collection Summary"
            description="Generate a shareable text summary of your collection stats."
            onClick={handleShareWithFullStats}
            loading={shareLoading}
          />
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-export {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .export__back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    transition: color var(--transition-fast);
  }

  .export__back-btn:active {
    color: var(--text-primary);
    background: var(--surface-tertiary);
  }

  .export__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
    padding-bottom: var(--space-12);
  }

  .export__intro {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .export__cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .export__card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    text-align: left;
    width: 100%;
    min-height: var(--touch-min);
    transition: background var(--transition-fast);
    cursor: pointer;
  }

  .export__card:active:not(:disabled) {
    background: var(--surface-tertiary);
  }

  .export__card:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .export__card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--surface-tertiary);
    flex-shrink: 0;
  }

  .export__card-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .export__card-title {
    font-size: var(--font-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
  }

  .export__card-desc {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .export__card-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  .export__spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--surface-tertiary);
    border-top-color: var(--brand-500);
    border-radius: 50%;
    animation: export-spin 0.7s linear infinite;
  }

  @keyframes export-spin {
    to { transform: rotate(360deg); }
  }
`;
