import { describe, it, expect } from 'vitest';
import { CI_PROPERTY_SEED, propertySeed } from './propertySeed';

describe('propertySeed (PACKCAB-SEED)', () => {
  it('FC_SEED replays a logged seed, in CI or not', () => {
    expect(propertySeed({ FC_SEED: '1067213541' })).toBe(1067213541);
    expect(propertySeed({ FC_SEED: '-1285633959', CI: 'true' })).toBe(-1285633959);
  });

  it('CI runs the fixed seed', () => {
    expect(propertySeed({ CI: 'true' })).toBe(CI_PROPERTY_SEED);
    expect(propertySeed({ CI: '1', FC_SEED: '' })).toBe(CI_PROPERTY_SEED);
  });

  it('a local run rotates: a fresh 32-bit seed from the random source', () => {
    expect(propertySeed({}, () => 0)).toBe(0);
    expect(propertySeed({}, () => 0.75)).toBe(-(2 ** 30));
    expect(propertySeed({ CI: 'false' }, () => 0.25)).toBe(2 ** 30);
    const s = propertySeed({});
    expect(Number.isInteger(s) && s >= -(2 ** 31) && s < 2 ** 31).toBe(true);
  });

  it('a malformed FC_SEED throws rather than silently running another seed', () => {
    expect(() => propertySeed({ FC_SEED: 'abc' })).toThrow(RangeError);
    expect(() => propertySeed({ FC_SEED: '1.5' })).toThrow(RangeError);
    expect(() => propertySeed({ FC_SEED: '4294967296' })).toThrow(RangeError);
  });
});
