// The "Diagnostic ids" switch: whether this device adds random diagnostic ids (trace.ts) to its
// requests to our servers. The choice is kept per device in localStorage, never synced to the
// account, and survives sign-out like the theme. Only a choice that differs from the default is
// stored; no key means the default, which lives in diagIdsDefault() alone.
//
// diagIdsOn() reads storage on every call, with no cache, so a choice saved in any tab applies to
// the next request in every tab. The one exception: while this page's last write was refused
// (diagIdsSaved() false), this page uses that choice from memory and does not read storage, until
// a later write here is saved.
//
// A browser that will not keep the choice (storage blocked, quota full) never throws here: a read
// that fails gives this page's last choice, or the default if it made none, and a write that fails
// keeps the choice in memory for this page, with diagIdsSaved() false so Settings can say so.
//
// An off also owes a device-wide clear of the ids kept on queued edits (storage/originTraces.ts).
// The same call that stores 'off' writes a marker saying so, which only a clear that has committed
// removes (diagIdsClearDone). It survives a reload and a later on: the sync engine completes the
// clear at its next start or sync whatever the switch says by then, and sends no id while it is owed.
//
// A build without VITE_DIAG_IDS=true (src/config/features.ts) has no switch: diagIdsOn() is false
// whatever storage says, and setDiagIds writes nothing. What an earlier build stored stays as it was.
import { diagIdsEnabled } from '../config/features';

export const DIAG_IDS_KEY = 'fc-diag-ids';
export const DIAG_IDS_CLEAR_KEY = 'fc-diag-ids-clear-pending';

const OFF = 'off';
const ON = 'on';

/** The Settings wording, in one place because it may still change. */
export const DIAG_IDS_TEXT = {
  label: 'Diagnostic ids',
  description:
    "Adds a random id to this device's requests to our servers and to each change you make, so we can find out why something failed. Our normal server logs are kept either way.",
  hint: 'Set for this device only.',
  unsaved: "This browser can't save the choice",
  privacyLink: 'How we use your data',
} as const;

/** The default when this device has made no choice. The only place it is decided. */
export function diagIdsDefault(): boolean {
  return true;
}

/** The last choice made on this page, and whether storage took it. */
let chosen: boolean | undefined;
let saved = true;
/** This page's owed clear, held here only while storage refused its marker. */
let clearHere: string | undefined;

export function diagIdsOn(): boolean {
  if (!diagIdsEnabled()) return false;
  if (!saved) return chosen!;
  try {
    const stored = localStorage.getItem(DIAG_IDS_KEY);
    if (stored === OFF) return false;
    if (stored === ON) return true;
    return diagIdsDefault();
  } catch {
    return chosen ?? diagIdsDefault();
  }
}

export function setDiagIds(on: boolean): void {
  if (!diagIdsEnabled()) return;
  chosen = on;
  if (!on) markClearOwed();
  try {
    if (on === diagIdsDefault()) localStorage.removeItem(DIAG_IDS_KEY);
    else localStorage.setItem(DIAG_IDS_KEY, on ? ON : OFF);
    saved = true;
  } catch {
    saved = false;
  }
}

/** False while the last choice is held in memory only, because this browser would not store it. */
export function diagIdsSaved(): boolean {
  return saved;
}

// Each off gets its own mark, so a clear that began before a newer off cannot complete that one.
// A local value only, never sent anywhere.
function markClearOwed(): void {
  const mark = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(DIAG_IDS_CLEAR_KEY, mark);
    clearHere = undefined;
  } catch {
    clearHere = mark;
  }
}

/** The mark of an off whose device-wide clear has not committed, or undefined when none is owed. */
export function diagIdsClearPending(): string | undefined {
  if (clearHere !== undefined) return clearHere;
  try {
    return localStorage.getItem(DIAG_IDS_CLEAR_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Call only once a device-wide clear has committed, with the mark read before that clear began.
 * Removes that mark alone; one a newer off wrote stays. A removal storage refuses leaves the marker,
 * so the next start or sync clears again.
 */
export function diagIdsClearDone(mark: string): void {
  if (clearHere === mark) clearHere = undefined;
  try {
    if (localStorage.getItem(DIAG_IDS_CLEAR_KEY) === mark) localStorage.removeItem(DIAG_IDS_CLEAR_KEY);
  } catch {
    // Left set: clearing again is harmless.
  }
}
