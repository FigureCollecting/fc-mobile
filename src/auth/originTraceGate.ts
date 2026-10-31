// When a queued edit's origin_trace may leave the phone (LGMOB M2), in one place. The sync engine applies it to
// the Push it is about to send, and the DPoP fetch applies it again to the body of every attempt it makes (a
// use_dpop_nonce retry, a replay after a token refresh), because the switch can go off while a call is in flight.
// A Push without its ids is still the same Push to the coordinator: C3 leaves origin_trace out of replay identity.
import { clone, fromJsonString, toJsonString } from '@bufbuild/protobuf';
import { PushRequestSchema, SyncService, type PushRequest } from '@figurecollecting/fc-api-contract';
import { diagIdsClearPending, diagIdsOn } from './diagIds';

/** Ids may leave only while the switch is on and no off's device-wide clear is still owed. */
export function originTracesMayLeave(): boolean {
  return diagIdsOn() && diagIdsClearPending() === undefined;
}

/** The request with every event's origin_trace taken off. */
export function withoutOriginTraces(request: PushRequest): PushRequest {
  const copy = clone(PushRequestSchema, request);
  for (const event of copy.events) delete event.originTrace;
  return copy;
}

const PUSH_PATH = `/${SyncService.typeName}/${SyncService.method.push.name}`;

/**
 * The body one DPoP attempt sends to `url`: a Push's Connect JSON body without origin_trace while ids may not
 * leave, else the body as given. A Push body it cannot read then is refused, not sent.
 */
export function attemptBody(url: URL, body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (originTracesMayLeave() || !url.pathname.endsWith(PUSH_PATH)) return body;
  if (!ArrayBuffer.isView(body) && typeof body !== 'string') {
    throw new Error('a Push body that cannot be read for diagnostic ids is not sent while they are off');
  }
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return new TextEncoder().encode(toJsonString(PushRequestSchema, withoutOriginTraces(fromJsonString(PushRequestSchema, text))));
}
