// The search worker's message handling, apart from the worker global so it can be tested as is.
import { NgramIndex, type SearchDoc } from './ngram';

export type ToWorker = { type: 'build'; docs: SearchDoc[] } | { type: 'query'; id: number; query: string };
export type FromWorker = { type: 'result'; id: number; ids: string[] };

/** Messages are handled in order, so a query sent after a build is answered from that build. */
export function createWorkerHandler(post: (message: FromWorker) => void): (message: ToWorker) => void {
  let index: NgramIndex | undefined;
  return (message) => {
    if (message.type === 'build') index = NgramIndex.build(message.docs);
    else post({ type: 'result', id: message.id, ids: index?.search(message.query) ?? [] });
  };
}
