// W3C trace context (traceparent) for requests to our own API, nothing else: the coordinator
// joins its log lines on the trace id. Every id is fresh randomness from the CSPRNG: 16 bytes
// for a trace, 8 for a span, never all zero, never derived from the account, the device or its
// key, a client id, a version or a clock. No id outlives one sync pass or one call, and the
// client sends no tracestate and no baggage. While this device's Diagnostic ids switch is off
// (diagIds.ts), neither writer below adds one, and dropTraceIfOff takes one off any attempt
// dpopFetch makes after the switch went off, on a call begun while it was on.
import { createContextKey, type Interceptor } from '@connectrpc/connect';
import { diagIdsOn } from './diagIds';

const HEADER = 'traceparent';
const TRACE_ID = /^[0-9a-f]{32}$/;
const ZERO_TRACE = '0'.repeat(32);

function randomHex(size: number): string {
  const bytes = new Uint8Array(size);
  do crypto.getRandomValues(bytes);
  while (bytes.every((b) => b === 0));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newTraceId(): string {
  return randomHex(16);
}

export function newSpanId(): string {
  return randomHex(8);
}

/** version 00, the given trace (a fresh one if it is not a valid trace id), a fresh span, sampled. */
export function traceparent(traceId: string): string {
  const trace = TRACE_ID.test(traceId) && traceId !== ZERO_TRACE ? traceId : newTraceId();
  return `00-${trace}-${newSpanId()}-01`;
}

/** The trace one sync pass shares across its calls. Unset, each call gets a trace of its own. */
export const kActionTrace = createContextKey<string | undefined>(undefined, { description: 'fc action trace id' });

/** Connect calls: the action's trace if the call is scoped to one, else a fresh trace; a fresh span always. */
export function traceInterceptor(): Interceptor {
  return (next) => (req) => {
    if (diagIdsOn()) req.header.set(HEADER, traceparent(req.contextValues.get(kActionTrace) ?? newTraceId()));
    return next(req);
  };
}

/**
 * A plain (non-Connect) request to our own API: a fresh trace unless the caller set one. Only a
 * same-origin URL under /api/ gets it; any other origin or path is left as it is.
 */
export function addTraceHeader(headers: Headers, url: URL, appOrigin: string): void {
  if (!diagIdsOn() || url.origin !== appOrigin || !url.pathname.startsWith('/api/') || headers.has(HEADER)) return;
  headers.set(HEADER, traceparent(newTraceId()));
}

/** One attempt's headers, just before it is sent: none leaves while the switch is off, whenever the call began. */
export function dropTraceIfOff(headers: Headers): void {
  if (!diagIdsOn()) headers.delete(HEADER);
}
