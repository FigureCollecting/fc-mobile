import { useState, useCallback, useMemo, useEffect } from 'preact/hooks';

/** Target fields that CSV columns can be mapped to. */
export type MappableField =
  | 'name'
  | 'manufacturer'
  | 'scale'
  | 'collectionStatus'
  | 'origin'
  | 'category'
  | 'mfcLink'
  | 'note'
  | 'purchasePrice'
  | 'purchaseCurrency'
  | 'purchaseDate'
  | 'imageUrl'
  | '(skip)';

export interface ColumnMapping {
  /** CSV column header -> target field */
  [csvHeader: string]: MappableField;
}

const FIELD_LABELS: Record<MappableField, string> = {
  name: 'Name',
  manufacturer: 'Manufacturer',
  scale: 'Scale',
  collectionStatus: 'Status',
  origin: 'Series / Origin',
  category: 'Category',
  mfcLink: 'MFC Link',
  note: 'Note',
  purchasePrice: 'Purchase Price',
  purchaseCurrency: 'Purchase Currency',
  purchaseDate: 'Purchase Date',
  imageUrl: 'Image URL',
  '(skip)': '-- Skip --',
};

/** Common column name patterns mapped to target fields. */
const AUTO_DETECT_PATTERNS: Array<[RegExp, MappableField]> = [
  [/^name$/i, 'name'],
  [/^figure.?name$/i, 'name'],
  [/^title$/i, 'name'],
  [/^manufacturer$/i, 'manufacturer'],
  [/^maker$/i, 'manufacturer'],
  [/^brand$/i, 'manufacturer'],
  [/^company$/i, 'manufacturer'],
  [/^scale$/i, 'scale'],
  [/^size$/i, 'scale'],
  [/^status$/i, 'collectionStatus'],
  [/^collection.?status$/i, 'collectionStatus'],
  [/^origin$/i, 'origin'],
  [/^series$/i, 'origin'],
  [/^franchise$/i, 'origin'],
  [/^category$/i, 'category'],
  [/^type$/i, 'category'],
  [/^mfc.?link$/i, 'mfcLink'],
  [/^url$/i, 'mfcLink'],
  [/^link$/i, 'mfcLink'],
  [/^note$/i, 'note'],
  [/^notes$/i, 'note'],
  [/^comment$/i, 'note'],
  [/^price$/i, 'purchasePrice'],
  [/^purchase.?price$/i, 'purchasePrice'],
  [/^cost$/i, 'purchasePrice'],
  [/^currency$/i, 'purchaseCurrency'],
  [/^purchase.?currency$/i, 'purchaseCurrency'],
  [/^purchase.?date$/i, 'purchaseDate'],
  [/^date$/i, 'purchaseDate'],
  [/^image$/i, 'imageUrl'],
  [/^image.?url$/i, 'imageUrl'],
  [/^photo$/i, 'imageUrl'],
];

function autoDetect(header: string): MappableField {
  for (const [pattern, field] of AUTO_DETECT_PATTERNS) {
    if (pattern.test(header)) return field;
  }
  return '(skip)';
}

interface ColumnMapperProps {
  headers: string[];
  /** First few rows for preview */
  sampleRows: Array<Record<string, string>>;
  onConfirm: (mapping: ColumnMapping) => void;
}

export function ColumnMapper({ headers, sampleRows, onConfirm }: ColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Auto-detect on mount
  useEffect(() => {
    const initial: ColumnMapping = {};
    const usedFields = new Set<MappableField>();

    for (const header of headers) {
      const detected = autoDetect(header);
      if (detected !== '(skip)' && !usedFields.has(detected)) {
        initial[header] = detected;
        usedFields.add(detected);
      } else {
        initial[header] = '(skip)';
      }
    }
    setMapping(initial);
  }, [headers]);

  const handleChange = useCallback(
    (header: string, field: MappableField) => {
      setMapping((prev) => ({ ...prev, [header]: field }));
    },
    [],
  );

  const hasNameMapping = useMemo(
    () => Object.values(mapping).includes('name'),
    [mapping],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(mapping);
  }, [mapping, onConfirm]);

  return (
    <div class="column-mapper">
      <p class="column-mapper__description">
        Map your CSV columns to figure fields. At minimum, a <strong>Name</strong> column is required.
      </p>

      <div class="column-mapper__table">
        {headers.map((header) => {
          const sample = sampleRows.length > 0 ? sampleRows[0][header] ?? '' : '';
          return (
            <div class="column-mapper__row" key={header}>
              <div class="column-mapper__source">
                <span class="column-mapper__header-name">{header}</span>
                {sample && (
                  <span class="column-mapper__sample">e.g. {sample}</span>
                )}
              </div>
              <svg class="column-mapper__arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <select
                class="column-mapper__select"
                value={mapping[header] ?? '(skip)'}
                onChange={(e) => handleChange(header, (e.target as HTMLSelectElement).value as MappableField)}
              >
                {(Object.keys(FIELD_LABELS) as MappableField[]).map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABELS[field]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <button
        class="column-mapper__confirm"
        type="button"
        onClick={handleConfirm}
        disabled={!hasNameMapping}
      >
        {hasNameMapping ? 'Apply Mapping' : 'Map a Name column to continue'}
      </button>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .column-mapper {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .column-mapper__description {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .column-mapper__description strong {
    color: var(--text-primary);
  }

  .column-mapper__table {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .column-mapper__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface-tertiary);
    border-radius: var(--radius-md);
  }

  .column-mapper__source {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .column-mapper__header-name {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .column-mapper__sample {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-style: italic;
  }

  .column-mapper__arrow {
    flex-shrink: 0;
  }

  .column-mapper__select {
    flex-shrink: 0;
    width: 130px;
    font-size: var(--font-sm);
    color: var(--text-primary);
    background: var(--surface-secondary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    min-height: 40px;
  }

  .column-mapper__confirm {
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

  .column-mapper__confirm:active:not(:disabled) {
    background: var(--brand-600);
  }

  .column-mapper__confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
