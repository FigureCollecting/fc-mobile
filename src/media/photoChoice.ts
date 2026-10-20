// GALLERY-1 (Ross 10-18): the photo a user chose to display for a figure (Info and the case), kept per user on this device.
// Keyed by product (head id), the value the chosen image's public address. "Use for me" for every copy; a choice for one copy
// has no home until the case can show each copy (COPY1), so this is product level only.
//
// THE SEAM, NOT THE END: a choice that follows the user to another device is a synced facet (a new family in
// fc-api-contract, accepted by the coordinator) and the mask for a chosen photo is asked of media-manager once its API
// exists; neither is built. Readers ask this module (readPhotoChoices, usePhotoChoices) and never storage, so the facet
// replaces what is behind it. Until then a choice lives on this device only.
//
// Only an address on the public image address is kept (src/media/address.ts): whatever a record holds, nothing else is
// ever fetched for a choice. A damaged record reads as what is sound in it; a device that refuses the write keeps the
// choice for the session in memory.
import { useEffect, useState } from 'preact/hooks';
import { localSession } from '../local/session';
import { isMediaUrl } from './address';

export type PhotoChoices = ReadonlyMap<string, string>;

/** The most choices kept for a user; the oldest go first. */
export const MAX_PHOTO_CHOICES = 2000;
export const PHOTO_CHOICES_KEY = (sub: string): string => `fc-photo-choices-v1:${sub}`;

const EMPTY: PhotoChoices = new Map();
/** Each user's choices as this document holds them, oldest first (a Map keeps insertion order); replaced, never edited, when they change. */
const held = new Map<string, PhotoChoices>();
const listeners = new Set<() => void>();

function parse(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (raw === null) return out;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return out;
  for (const [head, address] of Object.entries(record)) {
    if (head !== '' && typeof address === 'string' && isMediaUrl(address)) out.set(head, address);
  }
  return out;
}

function load(sub: string): PhotoChoices {
  let choices = held.get(sub);
  if (choices === undefined) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PHOTO_CHOICES_KEY(sub));
    } catch {
      /* storage unavailable: no choices from it */
    }
    choices = parse(raw);
    held.set(sub, choices);
  }
  return choices;
}

/** What `sub` chose, head id to image address; nothing for nobody. */
export function readPhotoChoices(sub: string | undefined): PhotoChoices {
  return sub === undefined ? EMPTY : load(sub);
}

/** Choose `address` for `headId`, or (null) go back to the default photo. A choice made again is the newest. */
export function setPhotoChoice(sub: string, headId: string, address: string | null): void {
  const next = new Map(load(sub));
  next.delete(headId);
  if (address !== null && isMediaUrl(address)) next.set(headId, address);
  while (next.size > MAX_PHOTO_CHOICES) next.delete(next.keys().next().value!);
  held.set(sub, next);
  try {
    localStorage.setItem(PHOTO_CHOICES_KEY(sub), JSON.stringify(Object.fromEntries(next)));
  } catch {
    /* the device refused the write (full, or storage off): the choice stands for this session */
  }
  for (const heard of listeners) heard();
}

/** Test-only: forget what this document holds, so the next read comes from storage. */
export function __resetPhotoChoices(): void {
  held.clear();
  listeners.clear();
}

/** The signed-in user's choices (or `forSub`'s, for the dev fixtures, which have no session): the same map until one changes here or in another tab of the app. */
export function usePhotoChoices(forSub?: string): PhotoChoices {
  const sub = forSub ?? localSession.value?.sub();
  const [, redraw] = useState(0);
  useEffect(() => {
    const heard = () => redraw((n) => n + 1);
    listeners.add(heard);
    // another document of the app wrote the record: drop what this one holds and read it again
    const storage = (e: StorageEvent) => {
      if (sub !== undefined && e.key === PHOTO_CHOICES_KEY(sub)) {
        held.delete(sub);
        heard();
      }
    };
    window.addEventListener('storage', storage);
    return () => {
      listeners.delete(heard);
      window.removeEventListener('storage', storage);
    };
  }, [sub]);
  return readPhotoChoices(sub);
}
