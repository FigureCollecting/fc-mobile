export interface CountdownResult {
  text: string;
  urgency: 'past' | 'imminent' | 'soon' | 'future';
}

export function releaseCountdown(date: Date | string): CountdownResult {
  const now = Date.now();
  const release = new Date(date).getTime();
  const days = Math.round((release - now) / 86400000);

  if (days < -30) return { text: `Released ${Math.abs(days)} days ago`, urgency: 'past' };
  if (days < 0) return { text: `Released ${Math.abs(days)} days ago`, urgency: 'past' };
  if (days === 0) return { text: 'Releasing today!', urgency: 'imminent' };
  if (days === 1) return { text: 'Tomorrow!', urgency: 'imminent' };
  if (days <= 7) return { text: `In ${days} days`, urgency: 'imminent' };
  if (days <= 30) return { text: `In ${days} days`, urgency: 'soon' };
  if (days <= 60) return { text: 'In 1 month', urgency: 'future' };
  return { text: `In ${Math.floor(days / 30)} months`, urgency: 'future' };
}

/** Format a date as "Mar 15, 2026" */
export function formatReleaseDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
