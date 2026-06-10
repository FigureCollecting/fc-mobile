import { showToast } from '../stores/toast';

export interface ShareStats {
  owned: number;
  ordered: number;
  wished: number;
  manufacturers: number;
  scales: number;
}

/**
 * Share or copy a text summary of the user's collection.
 * Uses the Web Share API on supported devices (native share sheet),
 * falling back to clipboard copy.
 */
export async function shareCollectionSummary(stats: ShareStats): Promise<void> {
  const text = [
    'My Figure Collection',
    `${stats.owned} owned | ${stats.ordered} ordered | ${stats.wished} wished`,
    `${stats.manufacturers} manufacturers | ${stats.scales} scales`,
    'Tracked on FigureCollecting.com',
  ].join('\n');

  try {
    if (navigator.share) {
      await navigator.share({ title: 'My Figure Collection', text });
    } else {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'success');
    }
  } catch (err: unknown) {
    // AbortError means user dismissed the share sheet — not a real failure
    if (err instanceof DOMException && err.name === 'AbortError') return;
    showToast('Share failed', 'error');
  }
}
