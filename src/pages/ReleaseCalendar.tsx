import { useState, useCallback, useMemo, useRef, useEffect } from 'preact/hooks';
import { Header } from '../components/layout/Header';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { CalendarGrid } from '../components/calendar/CalendarGrid';
import { ReleaseCard } from '../components/calendar/ReleaseCard';
import { useReleaseCalendar } from '../hooks/useReleaseCalendar';
import { useAuthStore } from '../stores/auth';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button class="rc-back-btn" type="button" onClick={onClick} aria-label="Back">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <style>{`
        .rc-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          margin-left: calc(var(--space-2) * -1);
        }
        .rc-back-btn:active {
          background: var(--surface-tertiary);
          color: var(--text-primary);
        }
      `}</style>
    </button>
  );
}

export function ReleaseCalendar() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { releases, releaseDays, totalReleases, upcomingCount, isLoading, refetch } =
    useReleaseCalendar(year, month);

  // Build day -> status map for dot colors
  const dayStatus = useMemo(() => {
    const map = new Map<number, 'ordered' | 'wished' | 'both'>();
    for (const r of releases) {
      const existing = map.get(r.day);
      const status = r.figure.collectionStatus === 'ordered' ? 'ordered' : 'wished';
      if (!existing) {
        map.set(r.day, status);
      } else if (existing !== status) {
        map.set(r.day, 'both');
      }
    }
    return map;
  }, [releases]);

  // Filter releases by selected day
  const displayReleases = useMemo(() => {
    if (selectedDay === null) return releases;
    return releases.filter((r) => r.day === selectedDay);
  }, [releases, selectedDay]);

  // Scroll list ref for day-tap scroll
  const listRef = useRef<HTMLDivElement>(null);

  const handleDayTap = useCallback((day: number) => {
    setSelectedDay((prev) => (prev === day ? null : day));
  }, []);

  // Scroll to top of list when day selected
  useEffect(() => {
    if (selectedDay !== null && listRef.current) {
      listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDay]);

  const handlePrevMonth = useCallback(() => {
    setSelectedDay(null);
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const handleNextMonth = useCallback(() => {
    setSelectedDay(null);
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const handleRefresh = useCallback(async () => {
    refetch();
  }, [refetch]);

  const handleBack = useCallback(() => {
    history.back();
  }, []);

  if (!isAuthenticated) {
    return (
      <div class="page-rc">
        <Header title="Calendar" leading={<BackButton onClick={handleBack} />} />
        <p class="rc-empty">Sign in to view your release calendar.</p>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div class="page-rc">
      <Header title="Calendar" leading={<BackButton onClick={handleBack} />} />
      <PullToRefresh onRefresh={handleRefresh}>
        <div class="rc-body">
          {/* Month navigation */}
          <div class="rc-month-nav">
            <button
              type="button"
              class="rc-month-nav__btn"
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div class="rc-month-nav__label">
              <span class="rc-month-nav__month">{MONTH_NAMES[month]}</span>
              <span class="rc-month-nav__year">{year}</span>
            </div>
            <button
              type="button"
              class="rc-month-nav__btn"
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Calendar grid */}
          <CalendarGrid
            year={year}
            month={month}
            releaseDays={releaseDays}
            selectedDay={selectedDay}
            onDayTap={handleDayTap}
            dayStatus={dayStatus}
          />

          {/* Summary strip */}
          <div class="rc-summary">
            <div class="rc-summary__item">
              <span class="rc-summary__count">{totalReleases}</span>
              <span class="rc-summary__label">This month</span>
            </div>
            <div class="rc-summary__divider" />
            <div class="rc-summary__item">
              <span class="rc-summary__count">{upcomingCount}</span>
              <span class="rc-summary__label">Upcoming</span>
            </div>
            <div class="rc-summary__divider" />
            <div class="rc-summary__item">
              <div class="rc-summary__legend">
                <span class="rc-summary__dot rc-summary__dot--ordered" />
                <span class="rc-summary__legend-text">Ordered</span>
              </div>
              <div class="rc-summary__legend">
                <span class="rc-summary__dot rc-summary__dot--wished" />
                <span class="rc-summary__legend-text">Wished</span>
              </div>
            </div>
          </div>

          {/* Release list */}
          <div class="rc-releases" ref={listRef}>
            {isLoading ? (
              <div class="rc-loading">
                <div class="rc-loading__spinner" />
                <span class="rc-loading__text">Loading releases...</span>
              </div>
            ) : displayReleases.length === 0 ? (
              <p class="rc-empty">
                {selectedDay !== null
                  ? 'No releases on this day.'
                  : 'No releases this month.'}
              </p>
            ) : (
              <div class="rc-releases__list">
                {selectedDay !== null && (
                  <button
                    type="button"
                    class="rc-releases__clear"
                    onClick={() => setSelectedDay(null)}
                  >
                    Show all {totalReleases} releases
                  </button>
                )}
                {displayReleases.map((r) => (
                  <ReleaseCard
                    key={`${r.figure._id}-${r.release.date}`}
                    figure={r.figure}
                    release={r.release}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </PullToRefresh>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-rc {
    min-height: 100%;
  }

  .rc-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-bottom: var(--space-8);
  }

  /* Month navigation */
  .rc-month-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
  }

  .rc-month-nav__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    color: var(--text-secondary);
    border-radius: var(--radius-full);
    transition: background var(--transition-fast);
  }

  .rc-month-nav__btn:active {
    background: var(--surface-tertiary);
    color: var(--text-primary);
  }

  .rc-month-nav__label {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .rc-month-nav__month {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .rc-month-nav__year {
    font-size: var(--font-sm);
    color: var(--text-secondary);
  }

  /* Summary strip */
  .rc-summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    margin: 0 var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
  }

  .rc-summary__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .rc-summary__count {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: 1;
  }

  .rc-summary__label {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .rc-summary__divider {
    width: 1px;
    height: 28px;
    background: var(--border-subtle);
  }

  .rc-summary__legend {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .rc-summary__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .rc-summary__dot--ordered {
    background: var(--accent-warning);
  }

  .rc-summary__dot--wished {
    background: var(--accent-info);
  }

  .rc-summary__legend-text {
    font-size: 0.625rem;
    color: var(--text-tertiary);
  }

  /* Release list */
  .rc-releases {
    padding: 0 var(--space-4);
  }

  .rc-releases__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .rc-releases__clear {
    font-size: var(--font-xs);
    color: var(--brand-400);
    font-weight: var(--font-weight-semibold);
    padding: var(--space-2);
    text-align: center;
    border-radius: var(--radius-md);
    min-height: var(--touch-min);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rc-releases__clear:active {
    background: var(--surface-tertiary);
  }

  .rc-empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-4);
    font-size: var(--font-sm);
  }

  .rc-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8);
  }

  .rc-loading__spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--surface-tertiary);
    border-top-color: var(--brand-500);
    border-radius: 50%;
    animation: rc-spin 0.7s linear infinite;
  }

  .rc-loading__text {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
  }

  @keyframes rc-spin {
    to { transform: rotate(360deg); }
  }
`;
