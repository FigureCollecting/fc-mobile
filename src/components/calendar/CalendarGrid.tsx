import { useMemo } from 'preact/hooks';

interface CalendarGridProps {
  year: number;
  month: number;
  /** Set of day numbers (1-31) that have releases */
  releaseDays: Set<number>;
  /** Currently selected day (or null) */
  selectedDay: number | null;
  /** Day tap handler */
  onDayTap: (day: number) => void;
  /** Color map: day -> 'ordered' | 'wished' | 'both' for dot color */
  dayStatus?: Map<number, 'ordered' | 'wished' | 'both'>;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarGrid({
  year,
  month,
  releaseDays,
  selectedDay,
  onDayTap,
  dayStatus,
}: CalendarGridProps) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = isCurrentMonth ? today.getDate() : -1;

  const { blanks, daysInMonth } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    return { blanks: firstDay, daysInMonth: lastDate };
  }, [year, month]);

  const days = useMemo(() => {
    const result: number[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      result.push(i);
    }
    return result;
  }, [daysInMonth]);

  return (
    <div class="cal-grid">
      {/* Weekday headers */}
      <div class="cal-grid__header">
        {WEEKDAYS.map((day, i) => (
          <span key={i} class="cal-grid__weekday">{day}</span>
        ))}
      </div>

      {/* Day cells */}
      <div class="cal-grid__days">
        {/* Empty cells for offset */}
        {Array.from({ length: blanks }).map((_, i) => (
          <div key={`blank-${i}`} class="cal-grid__cell cal-grid__cell--blank" />
        ))}

        {days.map((day) => {
          const hasRelease = releaseDays.has(day);
          const isToday = day === todayDate;
          const isSelected = day === selectedDay;
          const status = dayStatus?.get(day);

          let dotClass = 'cal-grid__dot';
          if (status === 'ordered') dotClass += ' cal-grid__dot--ordered';
          else if (status === 'wished') dotClass += ' cal-grid__dot--wished';
          else if (status === 'both') dotClass += ' cal-grid__dot--both';
          else dotClass += ' cal-grid__dot--default';

          return (
            <button
              key={day}
              type="button"
              class={
                'cal-grid__cell' +
                (isToday ? ' cal-grid__cell--today' : '') +
                (isSelected ? ' cal-grid__cell--selected' : '') +
                (hasRelease ? ' cal-grid__cell--has-release' : '')
              }
              onClick={() => hasRelease && onDayTap(day)}
              disabled={!hasRelease}
              aria-label={`${day}${hasRelease ? ', has releases' : ''}`}
            >
              <span class="cal-grid__day-num">{day}</span>
              {hasRelease && <span class={dotClass} />}
            </button>
          );
        })}
      </div>

      <style>{calendarGridStyles}</style>
    </div>
  );
}

const calendarGridStyles = `
  .cal-grid {
    padding: 0 var(--space-2);
  }

  .cal-grid__header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    margin-bottom: var(--space-1);
  }

  .cal-grid__weekday {
    text-align: center;
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    padding: var(--space-1) 0;
  }

  .cal-grid__days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  .cal-grid__cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 44px;
    min-width: 44px;
    border-radius: var(--radius-md);
    position: relative;
    transition: background var(--transition-fast);
  }

  .cal-grid__cell--blank {
    pointer-events: none;
  }

  .cal-grid__cell--has-release {
    cursor: pointer;
  }

  .cal-grid__cell--has-release:active {
    background: var(--surface-tertiary);
  }

  .cal-grid__cell--today .cal-grid__day-num {
    color: var(--brand-500);
    font-weight: var(--font-weight-bold);
  }

  .cal-grid__cell--selected {
    background: var(--brand-500);
  }

  .cal-grid__cell--selected .cal-grid__day-num {
    color: white;
    font-weight: var(--font-weight-bold);
  }

  .cal-grid__cell--selected .cal-grid__dot {
    background: white !important;
  }

  .cal-grid__day-num {
    font-size: var(--font-sm);
    color: var(--text-primary);
    line-height: 1;
  }

  .cal-grid__cell:disabled:not(.cal-grid__cell--blank) .cal-grid__day-num {
    color: var(--text-tertiary);
  }

  .cal-grid__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .cal-grid__dot--ordered {
    background: var(--accent-warning);
  }

  .cal-grid__dot--wished {
    background: var(--accent-info);
  }

  .cal-grid__dot--both {
    background: linear-gradient(135deg, var(--accent-warning) 50%, var(--accent-info) 50%);
    width: 6px;
    height: 6px;
  }

  .cal-grid__dot--default {
    background: var(--brand-500);
  }
`;
