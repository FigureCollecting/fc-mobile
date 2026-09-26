import { describe, expect, it } from 'vitest';
import { ZERO_HLC, isPast, maxHlc, toHlcRecord, toHlcState } from '../hlcState';
import { T0, iso, token } from './harness';

describe('hlcState', () => {
  const at = (ms: number, counter: number) => ({ micros: String(BigInt(ms) * 1000n), counter });

  it('round-trips the Hlc state through its stored form', () => {
    const rec = at(T0, 7);
    expect(toHlcRecord(toHlcState(rec))).toEqual(rec);
    expect(toHlcState(ZERO_HLC)).toEqual({ micros: 0n, counter: 0 });
  });

  it('keeps the higher state, by micros then counter', () => {
    expect(maxHlc(at(T0, 1), at(T0 + 1, 0))).toEqual(at(T0 + 1, 0));
    expect(maxHlc(at(T0 + 1, 0), at(T0, 9))).toEqual(at(T0 + 1, 0));
    expect(maxHlc(at(T0, 2), at(T0, 1))).toEqual(at(T0, 2));
    expect(maxHlc(at(T0, 1), at(T0, 2))).toEqual(at(T0, 2));
  });

  it('says whether a version lies past a clock state', () => {
    expect(isPast(token(T0, 1), at(T0, 0))).toBe(true);
    expect(isPast(token(T0, 0), at(T0, 0))).toBe(false);
    expect(isPast(token(T0 - 1, 5), at(T0, 0))).toBe(false);
    expect(isPast(iso(T0 + 1), at(T0, 0))).toBe(true);
    expect(isPast(iso(T0), at(T0, 0))).toBe(false);
  });
});
