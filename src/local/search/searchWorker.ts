// The search index off the page's thread, once a build there takes more than 50 ms (searcher.ts).
/// <reference lib="webworker" />
import { createWorkerHandler, type ToWorker } from './workerHandler';

declare const self: DedicatedWorkerGlobalScope;

const handle = createWorkerHandler((message) => self.postMessage(message));
self.addEventListener('message', (event: MessageEvent<ToWorker>) => handle(event.data));
