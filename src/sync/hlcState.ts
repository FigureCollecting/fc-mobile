import { parseVersion, type HlcState } from '@figurecollecting/fc-api-contract';
import type { HlcRecord } from '../storage/records';

export const ZERO_HLC: HlcRecord = { micros: '0', counter: 0 };

export function toHlcState(rec: HlcRecord): HlcState {
  return { micros: BigInt(rec.micros), counter: rec.counter };
}

export function toHlcRecord(state: HlcState): HlcRecord {
  return { micros: state.micros.toString(), counter: state.counter };
}

function cmp(aMicros: bigint, aCounter: number, bMicros: bigint, bCounter: number): number {
  if (aMicros !== bMicros) return aMicros > bMicros ? 1 : -1;
  return Math.sign(aCounter - bCounter);
}

export function maxHlc(a: HlcRecord, b: HlcRecord): HlcRecord {
  return cmp(BigInt(a.micros), a.counter, BigInt(b.micros), b.counter) >= 0 ? a : b;
}

/** Whether a minted version lies past the clock state `present` (Hlc.snapshot after a rebase). */
export function isPast(version: string, present: HlcRecord): boolean {
  const p = parseVersion(version)!;
  return cmp(p.micros, p.counter ?? 0, BigInt(present.micros), present.counter) > 0;
}
