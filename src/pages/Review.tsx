import { Header } from '../components/layout/Header';
import { useAnswerReview, useReview } from '../hooks/useReview';
import { useAuthPhase } from '../local/useLocal';
import type { ReviewItem } from '../local/review';
import { showToast } from '../stores/toast';
import { Style } from '../styles/Style';

function formatEdited(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

function formatExport(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(y!, m! - 1, d!));
}

const CHOICE: Record<string, string> = { keep: 'keep app', take: 'take MFC', per_copy: 'per copy' };

function ItemCard({ item, onAnswer }: { item: ReviewItem; onAnswer: (choice: 'keep' | 'take') => void }) {
  const mfcWhen = item.exportDate === null ? `import ${item.importNumber}` : `export of ${formatExport(item.exportDate)}`;
  return (
    <li class="review__item">
      <h3 class="review__name">{item.name}</h3>
      <dl class="review__parts">
        {item.parts.map((p) => (
          <div key={p.label} class="review__part">
            <dt>{p.label}</dt>
            <dd>{`App: ${p.app}${p.appEditedAt === null ? '' : ` (${formatEdited(p.appEditedAt)})`}`}</dd>
            <dd>{`MFC: ${p.mfc} (${mfcWhen})`}</dd>
          </div>
        ))}
      </dl>
      {item.answered !== null ? (
        <p class="review__answered">{`You chose: ${CHOICE[item.answered] ?? item.answered}. It syncs next.`}</p>
      ) : (
        <div class="review__actions">
          <button type="button" onClick={() => onAnswer('keep')}>
            Keep app
          </button>
          <button type="button" onClick={() => onAnswer('take')}>
            Take MFC
          </button>
        </div>
      )}
    </li>
  );
}

function Group({ title, items, noun, answer }: { title: string; items: ReviewItem[]; noun: string; answer: (items: ReviewItem[], choice: 'keep' | 'take') => void }) {
  if (items.length === 0) return null;
  const open = items.filter((i) => i.answered === null);
  return (
    <section class="review__group">
      <h2 class="review__title">{title}</h2>
      {open.length > 0 && (
        <div class="review__bulk">
          <button type="button" onClick={() => answer(open, 'keep')}>{`Keep app for all ${open.length} ${noun}`}</button>
          <button type="button" onClick={() => answer(open, 'take')}>{`Take MFC for all ${open.length} ${noun}`}</button>
        </div>
      )}
      <ul class="review__list" aria-label={title}>
        {items.map((item) => (
          <ItemCard key={item.headId} item={item} onAnswer={(choice) => answer([item], choice)} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The conflict review (GR-Q1): what the MFC import found both sides changed (conflicts) or only the
 * app changed (MFC is behind), with the app's value and MFC's and their dates. 'keep app' or 'take
 * MFC', per item or for all: each a normal write that syncs; the server decides what follows.
 */
export function Review() {
  const phase = useAuthPhase();
  const { data } = useReview();
  const write = useAnswerReview();
  const answer = (items: ReviewItem[], choice: 'keep' | 'take') =>
    void write(items, choice).catch((err: unknown) => showToast(`Could not save the answer: ${(err as Error).message}`, 'error'));
  const empty = data !== undefined && data.conflicts.length === 0 && data.divergences.length === 0;

  return (
    <div class="page-review">
      <Header title="Review import" />
      {phase === 'signed-out' && <p class="review__note">Sign in to review your import.</p>}
      {empty && <p class="review__note">Nothing to review.</p>}
      {data !== undefined && (
        <>
          <Group title="Conflicts" noun={data.conflicts.filter((i) => i.answered === null).length === 1 ? 'conflict' : 'conflicts'} items={data.conflicts} answer={answer} />
          <Group title="MFC is behind" noun="items" items={data.divergences} answer={answer} />
        </>
      )}
      <Style css={`
        .page-review {
          padding-bottom: var(--space-6);
        }
        .review__note {
          padding: var(--space-4) var(--space-page);
          color: var(--text-secondary);
          font-size: var(--font-sm);
        }
        .review__group {
          padding: var(--space-3) var(--space-page);
        }
        .review__title {
          font-size: var(--font-lg);
          font-weight: 700;
          margin-bottom: var(--space-2);
        }
        .review__bulk,
        .review__actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }
        .review__bulk button,
        .review__actions button {
          min-height: 40px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-secondary);
          font-size: var(--font-sm);
        }
        .review__list {
          list-style: none;
          margin: var(--space-2) 0 0;
          padding: 0;
        }
        .review__item {
          padding: var(--space-3) 0;
          border-top: 1px solid var(--border-subtle);
        }
        .review__name {
          font-weight: 600;
          margin-bottom: var(--space-1);
        }
        .review__parts {
          margin: 0 0 var(--space-2);
        }
        .review__part {
          display: grid;
          grid-template-columns: 7rem 1fr;
          column-gap: var(--space-2);
          font-size: var(--font-sm);
        }
        .review__part dt {
          font-weight: 600;
          grid-row: span 2;
        }
        .review__part dd {
          margin: 0;
          color: var(--text-secondary);
        }
        .review__answered {
          font-size: var(--font-sm);
          color: var(--accent-success, #16a34a);
        }
      `} />
    </div>
  );
}
