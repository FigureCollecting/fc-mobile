import { showToast } from '../stores/toast';

/** Minimal interface matching the api client's .get method. */
interface ApiClient {
  get(url: string, config?: { responseType?: string }): Promise<{ data: Blob }>;
}

/**
 * Download a Blob as a file by creating a temporary anchor element.
 */
function downloadBlob(blob: Blob, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export the user's collection as a CSV file.
 */
export async function exportCollectionCsv(api: ApiClient): Promise<void> {
  try {
    const response = await api.get('/export/collection/csv', { responseType: 'blob' });
    downloadBlob(response.data, `collection-${Date.now()}.csv`, 'text/csv');
    showToast('CSV exported', 'success');
  } catch {
    showToast('Export failed', 'error');
  }
}

/**
 * Export the user's collection as a JSON file.
 */
export async function exportCollectionJson(api: ApiClient): Promise<void> {
  try {
    const response = await api.get('/export/collection/json', { responseType: 'blob' });
    downloadBlob(response.data, `collection-${Date.now()}.json`, 'application/json');
    showToast('JSON exported', 'success');
  } catch {
    showToast('Export failed', 'error');
  }
}
