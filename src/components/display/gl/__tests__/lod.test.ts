import { describe, it, expect } from 'vitest';
import { atlasBytes } from '../atlas';
import { LOD_TIERS_PX, PLACEHOLDER_BELOW_PX, TEXTURE_BUDGET_BYTES, cellSize, planAtlas, tierFor, type LodRequest } from '../lod';

describe('tierFor (distance LOD: the atlas cell height a card drawn this tall needs)', () => {
  it('the smallest tier at least as tall as the card on screen, capped at the largest', () => {
    expect(LOD_TIERS_PX).toEqual([256, 128, 64, 32]);
    expect(tierFor(400)).toBe(256);
    expect(tierFor(256)).toBe(256);
    expect(tierFor(255)).toBe(256);
    expect(tierFor(129)).toBe(256);
    expect(tierFor(128)).toBe(128);
    expect(tierFor(65)).toBe(128);
    expect(tierFor(64)).toBe(64);
    expect(tierFor(33)).toBe(64);
    expect(tierFor(32)).toBe(32);
    expect(tierFor(PLACEHOLDER_BELOW_PX)).toBe(32);
  });

  it('a placeholder card (no texels) below the placeholder height, and for nothing measurable', () => {
    expect(PLACEHOLDER_BELOW_PX).toBe(8);
    expect(tierFor(PLACEHOLDER_BELOW_PX - 0.01)).toBeNull();
    expect(tierFor(0)).toBeNull();
    expect(tierFor(Number.NaN)).toBeNull();
    expect(tierFor(-5)).toBeNull();
  });
});

describe('cellSize', () => {
  it('the tier tall and the aspect wide, at least a px, never wider than the widest cell', () => {
    expect(cellSize(128, 0.5)).toEqual({ w: 64, h: 128 });
    expect(cellSize(32, 0.01)).toEqual({ w: 1, h: 32 });
    // a very wide label: as wide as the cap allows, the height scaled with it
    expect(cellSize(256, 8, 1000)).toEqual({ w: 1000, h: 125 });
    expect(cellSize(64, Number.NaN)).toEqual({ w: 64, h: 64 });
  });
});

const req = (key: string, screenPx: number, aspect = 0.5): LodRequest => ({ key, screenPx, aspect });

describe('planAtlas (the texture budget)', () => {
  it('defaults to 48 MB', () => {
    expect(TEXTURE_BUDGET_BYTES).toBe(48 * 1024 * 1024);
  });

  it('gives each art the tier its largest card needs when the budget holds it', () => {
    const plan = planAtlas([req('near', 300), req('mid', 100), req('far', 20), req('dot', 3)], TEXTURE_BUDGET_BYTES, 1024);
    expect(plan.tiers.get('near')).toBe(256);
    expect(plan.tiers.get('mid')).toBe(128);
    expect(plan.tiers.get('far')).toBe(32);
    expect(plan.tiers.get('dot')).toBeNull();
    expect(plan.pack.places.has('dot')).toBe(false);
    expect(plan.pack.places.get('near')).toMatchObject({ w: 128, h: 256 });
    expect(plan.bytes).toBe(atlasBytes(plan.pack.pages, 1024));
    expect(plan.downgraded).toBe(0);
  });

  it('one art drawn by many cards is one cell, at its largest card', () => {
    const plan = planAtlas([req('a', 40), req('a', 200), req('a', 10)], TEXTURE_BUDGET_BYTES, 1024);
    expect(plan.tiers.get('a')).toBe(256);
    expect(plan.pack.places.size).toBe(1);
  });

  it('over budget: the smallest on screen (the farthest) step down first, the nearest keep their tier', () => {
    // 12 cells of 256 x 256 need 3 pages of 512 at most 2 cells... a budget of one 512 page holds 4 at 256
    const reqs = Array.from({ length: 12 }, (_, i) => req(`k${i}`, 300 - i * 5, 1));
    const plan = planAtlas(reqs, atlasBytes(1, 512), 512);
    expect(plan.bytes).toBeLessThanOrEqual(atlasBytes(1, 512));
    expect(plan.pack.pages).toBe(1);
    expect(plan.pack.overflow).toEqual([]);
    expect(plan.downgraded).toBeGreaterThan(0);
    // tiers never rise as the card shrinks on screen
    const tiers = reqs.map((r) => plan.tiers.get(r.key) ?? 0);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeLessThanOrEqual(tiers[i - 1]);
    expect(tiers[0]).toBeGreaterThan(tiers[tiers.length - 1]);
  });

  it('a budget too small for even the smallest tier: the farthest draw as placeholders, nothing overflows', () => {
    const reqs = Array.from({ length: 400 }, (_, i) => req(`k${i}`, 500 - i, 1));
    const plan = planAtlas(reqs, atlasBytes(1, 256), 256);
    expect(plan.pack.pages).toBeLessThanOrEqual(1);
    expect(plan.pack.overflow).toEqual([]);
    expect(plan.bytes).toBeLessThanOrEqual(atlasBytes(1, 256));
    expect(plan.tiers.get('k0')).toBe(32);
    expect(plan.tiers.get('k399')).toBeNull();
    const placed = reqs.filter((r) => plan.tiers.get(r.key) !== null).length;
    expect(placed).toBe(plan.pack.places.size);
    expect(placed).toBeGreaterThan(30);
  });

  it('a zero budget draws everything as placeholders', () => {
    const plan = planAtlas([req('a', 300)], 0, 1024);
    expect(plan.tiers.get('a')).toBeNull();
    expect(plan.bytes).toBe(0);
  });
});
