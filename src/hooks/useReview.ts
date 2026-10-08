// The conflict review's reads and its one write: an answer is a normal writeFacet of
// res/mfc/{head} through the engine (contract 0.3.0), synced like any edit; the server decides.
import { useCallback } from 'preact/hooks';
import { answerKey } from '@figurecollecting/fc-api-contract';
import { buildReview, type ReviewItem, type ReviewSet } from '../local/review';
import { requireSession } from '../local/session';
import { useSnapshot, type Snapshot } from '../local/useLocal';

const select = (s: Snapshot): ReviewSet => buildReview(s);

export function useReview() {
  return useSnapshot(select);
}

/** 'keep app' or 'take MFC' for each item, written together. */
export function useAnswerReview(): (items: ReviewItem[], choice: 'keep' | 'take') => Promise<void> {
  return useCallback(
    (items, choice) =>
      requireSession().engine.write(async (store) => {
        for (const item of items) await store.writeFacet(answerKey('mfc', item.headId), { item: 'figure', rev: item.rev, choice });
      }),
    [],
  );
}
