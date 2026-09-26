import { describe, it, expect } from 'vitest';
import { emptyShelfFill } from '../shelfFill';

describe('emptyShelfFill (empty shelves under a short collection)', () => {
  it('adds whole shelves at the occupied pitch until the next one would not fit', () => {
    // 2 x 90 occupied in 500 px leaves 320 px: three more 90 px shelves (270).
    expect(emptyShelfFill([90, 90], 500)).toEqual([90, 90, 90]);
  });

  it('uses the median occupied shelf as the pitch, so one tall shelf does not set it', () => {
    expect(emptyShelfFill([149, 90, 86], 600)).toEqual([90, 90, 90]);
  });

  it('takes the lower middle shelf for an even count, keeping whole pixels', () => {
    expect(emptyShelfFill([94, 86], 380)).toEqual([86, 86]);
  });

  it('adds nothing when the occupied shelves already fill the space', () => {
    expect(emptyShelfFill([90, 90, 90], 270)).toEqual([]);
    expect(emptyShelfFill([90, 90, 90], 200)).toEqual([]);
  });

  it('adds nothing when less than one shelf is left', () => {
    expect(emptyShelfFill([90], 179)).toEqual([]);
    expect(emptyShelfFill([90], 180)).toEqual([90]);
  });

  it('adds nothing without occupied shelves, space, or a usable pitch', () => {
    expect(emptyShelfFill([], 800)).toEqual([]);
    expect(emptyShelfFill([90], 0)).toEqual([]);
    expect(emptyShelfFill([90], Number.NaN)).toEqual([]);
    expect(emptyShelfFill([0, 0], 800)).toEqual([]);
  });
});
