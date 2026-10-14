import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasWebGL2, resetWebGL2Probe } from '../webgl';

afterEach(() => {
  vi.restoreAllMocks();
  resetWebGL2Probe();
});

describe('hasWebGL2', () => {
  it('true when a canvas gives a webgl2 context, and asks once', () => {
    const lose = vi.fn();
    const get = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl2' ? ({ getExtension: () => ({ loseContext: lose }) } as unknown as WebGL2RenderingContext) : null) as never);
    expect(hasWebGL2()).toBe(true);
    expect(hasWebGL2()).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    // the probe's context is given back at once
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('false when there is none, or asking throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(hasWebGL2()).toBe(false);
    resetWebGL2Probe();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasWebGL2()).toBe(false);
  });
});
