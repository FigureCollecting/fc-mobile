import { useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { ImportMfcExportResponse } from '@figurecollecting/fc-api-contract';
import { Header } from '../components/layout/Header';
import { useMfcImport } from '../hooks/useMfcImport';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAuthPhase } from '../local/useLocal';
import { readFileAsText } from '../utils/fileReader';
import { Style } from '../styles/Style';

/** Today in the device's zone, "YYYY-MM-DD": MFC stamps the export in its own zone, near enough. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const REASON: Record<string, string> = {
  invalid_id: 'not an MFC id',
  duplicate_id: 'a repeated id',
  invalid_count: 'an unreadable count',
  count_over_99: 'a count over 99',
  no_product: 'no product',
  '': 'no product',
};

function counts(res: ImportMfcExportResponse): Array<[string, number]> {
  return [
    ['Rows found', res.resolved],
    ['New figures', res.added],
    ['Moved', res.moved],
    ['Unchanged', res.unchanged],
    ['Removed', res.removed],
    ['Kept for your review', res.keptNewer],
    ['Copies added', res.occurrencesAdded],
    ['Copies changed', res.occurrencesStatusChanged],
    ['Copies removed', res.occurrencesRemoved],
    ['Conflicts to review', res.conflictsPending],
    ['MFC behind the app', res.divergencesPending],
    ['Not found', res.unresolved.length],
  ];
}

/**
 * Import an MyFigureCollection export (WK-15): the CSV goes to the coordinator's ImportService as it
 * is, and the server decides what it means. Online only, after this device's edits have synced.
 */
export function Import() {
  const phase = useAuthPhase();
  const online = useOnlineStatus();
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [exportDate, setExportDate] = useState(today);
  const importer = useMfcImport();
  const result = importer.data;

  const start = async (e: Event) => {
    e.preventDefault();
    if (file === null) return;
    importer.mutate({ csvText: await readFileAsText(file), exportDate });
  };

  return (
    <div class="page-import">
      <Header title="Import" />
      {phase === 'signed-out' ? (
        <p class="page-import__note">Sign in to import your MFC collection.</p>
      ) : (
        <form class="page-import__form" onSubmit={(e) => void start(e)}>
          <p class="page-import__intro">
            Export your collection from MyFigureCollection as CSV and choose the file here. The server matches each row to a figure and
            tells you what changed.
          </p>
          <label class="page-import__label" for="import-file">
            MFC export (CSV)
          </label>
          <input
            id="import-file"
            class="page-import__file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
          />
          <label class="page-import__label" for="import-date">
            Export date
          </label>
          <input id="import-date" class="page-import__date" type="date" value={exportDate} onInput={(e) => setExportDate((e.target as HTMLInputElement).value)} />
          {!online.value && <p class="page-import__note">Importing needs a connection.</p>}
          <button type="submit" class="page-import__go" disabled={file === null || !online.value || importer.isPending}>
            {importer.isPending ? 'Importing…' : 'Import'}
          </button>
          {importer.error !== null && (
            <p class="page-import__note" role="alert">
              {importer.error.name === 'ImportRefusedError' ? importer.error.message : `Import failed: ${importer.error.message}`}
            </p>
          )}
        </form>
      )}

      {result !== undefined && (
        <section class="page-import__result" role="region" aria-label="Import result">
          <h2 class="page-import__title">{`Import ${result.importNumber} done`}</h2>
          <dl class="page-import__counts">
            {counts(result)
              .filter(([, n], i) => n > 0 || i === 0)
              .map(([label, n]) => (
                <div key={label} class="page-import__count">
                  <dt>{label}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
          </dl>
          {result.conflictsPending > 0 && (
            <button type="button" class="page-import__go" onClick={() => setLocation('/review')}>
              {`Review ${result.conflictsPending} ${result.conflictsPending === 1 ? 'conflict' : 'conflicts'}`}
            </button>
          )}
          {result.unresolved.length > 0 && (
            <details class="page-import__unresolved" open={result.unresolved.length <= 10}>
              <summary>{`${result.unresolved.length} rows not imported`}</summary>
              <ul>
                {result.unresolved.map((u) => (
                  <li key={`${u.line}-${u.mfcId}`}>{`${u.mfcId} (line ${u.line}): ${REASON[u.reason] ?? u.reason}`}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <Style css={`
        .page-import__form,
        .page-import__result {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-page);
        }
        .page-import__intro,
        .page-import__note {
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
        .page-import__note {
          padding: 0 var(--space-page);
        }
        .page-import__form .page-import__note {
          padding: 0;
        }
        .page-import__label {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
        }
        .page-import__date,
        .page-import__file {
          min-height: 44px;
          color: var(--text-primary);
        }
        .page-import__go {
          min-height: 44px;
          border-radius: var(--radius-full);
          background: var(--brand-500);
          color: #fff;
          font-weight: 600;
        }
        .page-import__go:disabled {
          opacity: 0.5;
        }
        .page-import__title {
          font-size: var(--font-lg);
          font-weight: 700;
        }
        .page-import__counts {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: var(--space-2);
          margin: 0;
        }
        .page-import__count {
          display: flex;
          flex-direction: column;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          background: var(--surface-secondary);
        }
        .page-import__count dt {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }
        .page-import__count dd {
          margin: 0;
          font-size: var(--font-lg);
          font-weight: 700;
        }
        .page-import__unresolved ul {
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
      `} />
    </div>
  );
}
