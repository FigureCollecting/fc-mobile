import { useState, useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFigure } from '@figurecollecting/fc-shared';
import type { FigureFormData, CollectionStatus } from '@figurecollecting/fc-shared';
import { Header } from '../components/layout/Header';
import { ImportPreview } from '../components/import/ImportPreview';
import { ColumnMapper } from '../components/import/ColumnMapper';
import type { ImportItem } from '../components/import/ImportPreview';
import type { ColumnMapping, MappableField } from '../components/import/ColumnMapper';
import { readFileAsText, parseCsv, parseJson, detectFormat } from '../utils/fileReader';
import { api } from '../api/client';
import { hapticMedium, hapticHeavy } from '../utils/haptics';

type Step = 'select' | 'mapping' | 'preview' | 'importing' | 'complete';

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** Normalise a status string to a valid CollectionStatus. */
function normalizeStatus(raw: unknown): CollectionStatus {
  if (typeof raw !== 'string') return 'owned';
  const lower = raw.toLowerCase().trim();
  if (lower === 'owned' || lower === 'own') return 'owned';
  if (lower === 'ordered' || lower === 'order' || lower === 'preorder' || lower === 'pre-order') return 'ordered';
  if (lower === 'wished' || lower === 'wish' || lower === 'wishlist' || lower === 'want') return 'wished';
  return 'owned';
}

/** Build ImportItems from raw JSON objects. */
function jsonToImportItems(rows: unknown[]): ImportItem[] {
  return rows.map((row, index) => {
    const obj = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
    return {
      index,
      name: String(obj.name ?? obj.title ?? obj.figureName ?? ''),
      manufacturer: String(obj.manufacturer ?? obj.maker ?? obj.brand ?? ''),
      scale: String(obj.scale ?? obj.size ?? ''),
      status: normalizeStatus(obj.collectionStatus ?? obj.status),
      selected: true,
      raw: obj as Record<string, unknown>,
    };
  });
}

/** Build ImportItems from CSV rows using the user's column mapping. */
function csvToImportItems(
  rows: Array<Record<string, string>>,
  mapping: ColumnMapping,
): ImportItem[] {
  // Invert: field -> csv header
  const fieldToHeader: Partial<Record<MappableField, string>> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field !== '(skip)') fieldToHeader[field] = header;
  }

  return rows.map((row, index) => {
    const get = (field: MappableField): string => {
      const h = fieldToHeader[field];
      return h ? (row[h] ?? '') : '';
    };

    return {
      index,
      name: get('name'),
      manufacturer: get('manufacturer'),
      scale: get('scale'),
      status: normalizeStatus(get('collectionStatus')),
      selected: true,
      raw: row as Record<string, unknown>,
    };
  });
}

/** Build a FigureFormData from an ImportItem. */
function itemToFormData(item: ImportItem, mapping?: ColumnMapping): FigureFormData {
  const raw = item.raw;

  // If we have a mapping (CSV), use it to pull additional fields
  if (mapping) {
    const fieldToHeader: Partial<Record<MappableField, string>> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field !== '(skip)') fieldToHeader[field] = header;
    }
    const get = (field: MappableField): string => {
      const h = fieldToHeader[field];
      return h ? String((raw as Record<string, unknown>)[h] ?? '') : '';
    };

    const form: FigureFormData = {
      name: item.name,
      manufacturer: item.manufacturer || 'Unknown',
      scale: item.scale || 'N/A',
      collectionStatus: item.status,
    };

    const origin = get('origin');
    if (origin) form.origin = origin;
    const category = get('category');
    if (category) form.category = category;
    const mfcLink = get('mfcLink');
    if (mfcLink) form.mfcLink = mfcLink;
    const note = get('note');
    if (note) form.note = note;
    const imageUrl = get('imageUrl');
    if (imageUrl) form.imageUrl = imageUrl;
    const priceStr = get('purchasePrice');
    if (priceStr) {
      const parsed = parseFloat(priceStr);
      if (!Number.isNaN(parsed)) form.purchasePrice = parsed;
    }
    const currency = get('purchaseCurrency');
    if (currency) form.purchaseCurrency = currency;
    const purchaseDate = get('purchaseDate');
    if (purchaseDate) form.purchaseDate = purchaseDate;

    return form;
  }

  // JSON path: pull directly from raw object
  const form: FigureFormData = {
    name: item.name,
    manufacturer: item.manufacturer || String(raw.manufacturer ?? 'Unknown'),
    scale: item.scale || String(raw.scale ?? 'N/A'),
    collectionStatus: item.status,
  };

  if (raw.origin) form.origin = String(raw.origin);
  if (raw.category) form.category = String(raw.category);
  if (raw.mfcLink) form.mfcLink = String(raw.mfcLink);
  if (raw.note ?? raw.notes) form.note = String(raw.note ?? raw.notes);
  if (raw.imageUrl ?? raw.image) form.imageUrl = String(raw.imageUrl ?? raw.image);
  if (raw.mfcId) form.mfcId = Number(raw.mfcId);

  return form;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="import__back-btn"
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

export function Import() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [format, setFormat] = useState<'csv' | 'json' | 'unknown'>('unknown');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // CSV-specific
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);

  // Preview items
  const [items, setItems] = useState<ImportItem[]>([]);

  // Import results
  const [result, setResult] = useState<ImportResult>({ imported: 0, skipped: 0, failed: 0, errors: [] });
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  // ---------- File selection ----------

  const handleFileSelect = useCallback(async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);
    const fmt = detectFormat(file.name);
    setFormat(fmt);

    if (fmt === 'unknown') {
      setError('Unsupported file type. Please select a .csv or .json file.');
      return;
    }

    try {
      const text = await readFileAsText(file);

      if (fmt === 'json') {
        const parsed = parseJson(text);
        if (parsed.length === 0) {
          setError('No items found in the JSON file.');
          return;
        }
        const importItems = jsonToImportItems(parsed);
        setItems(importItems);
        setStep('preview');
      } else {
        // CSV: need column mapping first
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
          setError('No data rows found in the CSV file.');
          return;
        }
        const headers = Object.keys(parsed[0]);
        setCsvHeaders(headers);
        setCsvRows(parsed);
        setStep('mapping');
      }
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const handleTapToSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ---------- Column mapping (CSV) ----------

  const handleMappingConfirm = useCallback(
    (mapping: ColumnMapping) => {
      setColumnMapping(mapping);
      const importItems = csvToImportItems(csvRows, mapping);
      setItems(importItems);
      setStep('preview');
    },
    [csvRows],
  );

  // ---------- Preview ----------

  const handleToggleItem = useCallback((index: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.index === index ? { ...item, selected: !item.selected } : item,
      ),
    );
  }, []);

  const handleToggleAll = useCallback((selected: boolean) => {
    setItems((prev) => prev.map((item) => ({ ...item, selected })));
  }, []);

  // ---------- Import ----------

  const importMutation = useMutation({
    mutationFn: async () => {
      const selected = items.filter((i) => i.selected);
      const total = selected.length;
      setProgressTotal(total);
      setProgress(0);

      const outcome: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        try {
          if (!item.name.trim()) {
            outcome.skipped++;
            outcome.errors.push(`Row ${item.index + 1}: skipped (no name)`);
          } else {
            const formData = itemToFormData(item, columnMapping ?? undefined);
            await createFigure(api, formData);
            outcome.imported++;
          }
        } catch (err) {
          outcome.failed++;
          outcome.errors.push(
            `Row ${item.index + 1} (${item.name}): ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
        setProgress(i + 1);
      }

      return outcome;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep('complete');
      queryClient.invalidateQueries({ queryKey: ['collection'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      hapticMedium();
    },
    onError: () => {
      hapticHeavy();
    },
  });

  const handleStartImport = useCallback(() => {
    setStep('importing');
    importMutation.mutate();
  }, [importMutation]);

  // ---------- Navigation ----------

  const handleBack = useCallback(() => {
    switch (step) {
      case 'mapping':
        setStep('select');
        setError(null);
        break;
      case 'preview':
        if (format === 'csv') {
          setStep('mapping');
        } else {
          setStep('select');
          setError(null);
        }
        break;
      default:
        setLocation('/');
    }
  }, [step, format, setLocation]);

  const handleDone = useCallback(() => {
    setLocation('/');
  }, [setLocation]);

  const selectedCount = items.filter((i) => i.selected).length;

  // ---------- Step titles ----------

  const stepTitle =
    step === 'select'
      ? 'Import Collection'
      : step === 'mapping'
        ? 'Map Columns'
        : step === 'preview'
          ? 'Preview Import'
          : step === 'importing'
            ? 'Importing...'
            : 'Import Complete';

  return (
    <div class="page-import">
      <Header
        title={stepTitle}
        leading={step !== 'importing' && step !== 'complete' ? <BackButton onClick={handleBack} /> : undefined}
      />

      <div class="import__content">
        {/* ─── File Selection ─── */}
        {step === 'select' && (
          <div class="import__select">
            <button
              class="import__file-zone"
              type="button"
              onClick={handleTapToSelect}
            >
              <svg class="import__file-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span class="import__file-text">Tap to select a file</span>
              <span class="import__file-hint">CSV or JSON</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              class="import__file-input"
              onChange={handleFileSelect}
            />

            {error && (
              <div class="import__error">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {fileName && !error && (
              <div class="import__selected-file">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>{fileName}</span>
              </div>
            )}

            <div class="import__help">
              <h3 class="import__help-title">Supported Formats</h3>
              <div class="import__help-item">
                <strong>CSV</strong> - Comma-separated values with a header row. You will map columns to figure fields.
              </div>
              <div class="import__help-item">
                <strong>JSON</strong> - Array of objects or {"{ figures: [...] }"} format. Fields are auto-detected.
              </div>
            </div>
          </div>
        )}

        {/* ─── Column Mapping (CSV) ─── */}
        {step === 'mapping' && (
          <ColumnMapper
            headers={csvHeaders}
            sampleRows={csvRows.slice(0, 3)}
            onConfirm={handleMappingConfirm}
          />
        )}

        {/* ─── Preview ─── */}
        {step === 'preview' && (
          <div class="import__preview">
            <ImportPreview
              items={items}
              onToggle={handleToggleItem}
              onToggleAll={handleToggleAll}
            />
            <button
              class="import__start-btn"
              type="button"
              onClick={handleStartImport}
              disabled={selectedCount === 0}
            >
              {selectedCount > 0
                ? `Import ${selectedCount} Figure${selectedCount !== 1 ? 's' : ''}`
                : 'Select items to import'}
            </button>
          </div>
        )}

        {/* ─── Progress ─── */}
        {step === 'importing' && (
          <div class="import__progress">
            <div class="import__progress-ring">
              <svg viewBox="0 0 100 100" class="import__progress-svg">
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke="var(--surface-tertiary)"
                  stroke-width="6"
                />
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke="var(--brand-500)"
                  stroke-width="6"
                  stroke-linecap="round"
                  stroke-dasharray={2 * Math.PI * 42}
                  stroke-dashoffset={
                    progressTotal > 0
                      ? 2 * Math.PI * 42 * (1 - progress / progressTotal)
                      : 2 * Math.PI * 42
                  }
                  transform="rotate(-90 50 50)"
                  style={{ transition: 'stroke-dashoffset 200ms ease' }}
                />
              </svg>
              <span class="import__progress-label">
                {progress} / {progressTotal}
              </span>
            </div>
            <p class="import__progress-text">Importing figures...</p>
          </div>
        )}

        {/* ─── Complete ─── */}
        {step === 'complete' && (
          <div class="import__complete">
            <div class="import__complete-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>

            <h2 class="import__complete-title">Import Complete</h2>

            <div class="import__complete-stats">
              <div class="import__stat import__stat--success">
                <span class="import__stat-num">{result.imported}</span>
                <span class="import__stat-label">Imported</span>
              </div>
              {result.skipped > 0 && (
                <div class="import__stat import__stat--warning">
                  <span class="import__stat-num">{result.skipped}</span>
                  <span class="import__stat-label">Skipped</span>
                </div>
              )}
              {result.failed > 0 && (
                <div class="import__stat import__stat--danger">
                  <span class="import__stat-num">{result.failed}</span>
                  <span class="import__stat-label">Failed</span>
                </div>
              )}
            </div>

            {result.errors.length > 0 && (
              <div class="import__errors">
                <h3 class="import__errors-title">Issues</h3>
                <ul class="import__errors-list">
                  {result.errors.slice(0, 20).map((err, i) => (
                    <li key={i} class="import__errors-item">{err}</li>
                  ))}
                  {result.errors.length > 20 && (
                    <li class="import__errors-item">
                      ...and {result.errors.length - 20} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            <button
              class="import__done-btn"
              type="button"
              onClick={handleDone}
            >
              View Collection
            </button>
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-import {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .import__content {
    flex: 1;
    padding: var(--space-4);
    padding-bottom: var(--space-12);
  }

  /* Back button */
  .import__back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    transition: color var(--transition-fast);
  }

  .import__back-btn:active {
    color: var(--text-primary);
    background: var(--surface-tertiary);
  }

  /* File selection */
  .import__select {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .import__file-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-4);
    border: 2px dashed var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-secondary);
    min-height: 180px;
    transition: all var(--transition-fast);
    cursor: pointer;
    width: 100%;
  }

  .import__file-zone:active {
    border-color: var(--brand-400);
    background: var(--surface-tertiary);
  }

  .import__file-icon {
    opacity: 0.8;
  }

  .import__file-text {
    font-size: var(--font-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .import__file-hint {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
  }

  .import__file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .import__error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    color: var(--accent-danger);
  }

  .import__selected-file {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    color: var(--accent-success);
  }

  .import__help {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
  }

  .import__help-title {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin-bottom: var(--space-1);
  }

  .import__help-item {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .import__help-item strong {
    color: var(--brand-400);
  }

  /* Preview step */
  .import__preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .import__start-btn {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-base);
    font-weight: var(--font-weight-semibold);
    color: white;
    background: var(--brand-500);
    border-radius: var(--radius-lg);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
  }

  .import__start-btn:active:not(:disabled) {
    background: var(--brand-600);
  }

  .import__start-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Progress step */
  .import__progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-12) 0;
  }

  .import__progress-ring {
    position: relative;
    width: 140px;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .import__progress-svg {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
  }

  .import__progress-label {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    z-index: 1;
  }

  .import__progress-text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
  }

  /* Complete step */
  .import__complete {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-8) 0;
  }

  .import__complete-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.1);
  }

  .import__complete-title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .import__complete-stats {
    display: flex;
    gap: var(--space-6);
  }

  .import__stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .import__stat-num {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
  }

  .import__stat-label {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .import__stat--success .import__stat-num {
    color: var(--accent-success);
  }

  .import__stat--warning .import__stat-num {
    color: var(--accent-warning);
  }

  .import__stat--danger .import__stat-num {
    color: var(--accent-danger);
  }

  .import__errors {
    width: 100%;
    max-width: 400px;
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
  }

  .import__errors-title {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin-bottom: var(--space-2);
  }

  .import__errors-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .import__errors-item {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .import__done-btn {
    width: 100%;
    max-width: 300px;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-base);
    font-weight: var(--font-weight-semibold);
    color: white;
    background: var(--brand-500);
    border-radius: var(--radius-lg);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
  }

  .import__done-btn:active {
    background: var(--brand-600);
  }
`;
