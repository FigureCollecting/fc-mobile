// ADDR-1: the ONE public image address. Every derivative and mask a client is sent lives at
// <MEDIA_PUBLIC_BASE_URL>/<64 lowercase hex> (the hex is the SHA-256 of the bytes), on its own
// origin and the same in every phase, because a ProductImage.url is cached forever and replayed
// offline (fc-infra nodes/fc-app-01/edge/README.md "The public image address"). The coordinator
// sends only urls of this form; this check keeps anything else out of the caches.

export const DEFAULT_MEDIA_PUBLIC_BASE_URL = 'https://images.figurecollecting.com/d';

/** The build's address (VITE_MEDIA_PUBLIC_BASE_URL), trimmed, else the production one. */
export function resolveMediaBase(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return value === '' ? DEFAULT_MEDIA_PUBLIC_BASE_URL : value;
}

export const MEDIA_PUBLIC_BASE_URL = resolveMediaBase(import.meta.env.VITE_MEDIA_PUBLIC_BASE_URL as string | undefined);
export const MEDIA_ORIGIN = new URL(MEDIA_PUBLIC_BASE_URL).origin;

const HEX64 = /^[0-9a-f]{64}$/;

/** Exactly <base>/<64 lowercase hex>: no other path, no query, no fragment. */
export function isMediaUrl(url: string | URL, base: string = MEDIA_PUBLIC_BASE_URL): boolean {
  const text = typeof url === 'string' ? url : url.href;
  const prefix = `${base}/`;
  return text.startsWith(prefix) && HEX64.test(text.slice(prefix.length));
}
