// One sync badge per item (WK-15): known, pending, or offline-stale with its as-of time and zone.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { SyncBadge, formatAsOf } from '../SyncBadge';

const NOW = Date.parse('2026-10-07T19:30:00Z'); // 14:30 CDT

/** The declarations the rendered stylesheet holds for `selector` (jsdom takes Style's <style> fallback), whitespace collapsed. */
function declarations(selector: string): string {
  const css = Array.from(document.head.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!rule) throw new Error(`no rule for ${selector} in the rendered styles`);
  return rule[1].replace(/\s+/g, ' ').trim();
}

describe('formatAsOf', () => {
  it('gives the time and the zone for today, and the date too for another day', () => {
    expect(formatAsOf('2026-10-07T19:05:00.000000Z', { now: NOW, timeZone: 'America/Chicago' })).toBe('as of 14:05 CDT');
    expect(formatAsOf('2026-10-03T19:05:00Z', { now: NOW, timeZone: 'America/Chicago' })).toBe('as of Oct 3, 14:05 CDT');
    expect(formatAsOf('2026-10-07T19:05:00Z', { now: NOW, timeZone: 'Asia/Tokyo' })).toBe('as of 04:05 GMT+9') // same day in Tokyo;
  });

  it('reads epoch milliseconds too, and says nothing for an unreadable time', () => {
    expect(formatAsOf(Date.parse('2026-10-07T19:05:00Z'), { now: NOW, timeZone: 'UTC' })).toBe('as of 19:05 UTC');
    expect(formatAsOf('not a time', { now: NOW })).toBe('as of an unknown time');
  });
});

describe('SyncBadge', () => {
  it('shows pending', () => {
    render(<SyncBadge sync="pending" asOf={null} id="b1" />);
    expect(screen.getByText('Pending')).toHaveAttribute('data-sync', 'pending');
  });

  it('shows offline-stale with its as-of', () => {
    const { container } = render(<SyncBadge sync="offline-stale" asOf="2026-10-07T19:05:00Z" id="b2" now={NOW} timeZone="America/Chicago" />);
    const badge = container.querySelector('#b2');
    expect(badge).toHaveTextContent(/^as of 14:05 CDT$/);
    expect(badge).toHaveAttribute('data-sync', 'offline-stale');
  });

  it('keeps the clock time of an as-of in one piece that never wraps, today and another day', () => {
    const { container } = render(
      <>
        <SyncBadge sync="offline-stale" asOf="2026-10-07T19:05:00Z" id="today" now={NOW} timeZone="America/Chicago" />
        <SyncBadge sync="offline-stale" asOf="2026-10-03T19:05:00Z" id="earlier" now={NOW} timeZone="America/Chicago" />
      </>,
    );
    for (const [id, text] of [['today', 'as of 14:05 CDT'], ['earlier', 'as of Oct 3, 14:05 CDT']]) {
      const badge = container.querySelector(`#${id}`)!;
      expect(badge.textContent).toBe(text);
      expect([...badge.querySelectorAll('.sync-badge__time')].map((t) => t.textContent)).toEqual(['14:05']);
    }
    expect(declarations('.sync-badge__time')).toContain('white-space: nowrap;');
  });

  it('draws no time piece for Pending or Offline', () => {
    const { container } = render(
      <>
        <SyncBadge sync="pending" asOf={null} id="p" />
        <SyncBadge sync="offline-stale" asOf={null} id="o" />
      </>,
    );
    expect(container.querySelectorAll('.sync-badge__time')).toHaveLength(0);
  });

  it('shows an offline-stale item with no as-of as offline', () => {
    render(<SyncBadge sync="offline-stale" asOf={null} id="b3" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('marks known quietly, for screen readers only', () => {
    render(<SyncBadge sync="known" asOf={null} id="b4" />);
    expect(screen.getByText('Synced')).toHaveClass('sync-badge--known');
  });
});
