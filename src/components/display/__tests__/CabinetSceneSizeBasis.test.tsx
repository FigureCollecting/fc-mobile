// SIZE-BASIS-1 (Ross 10-18): the case can outline the figures whose height or width is an estimate, so he can see which sizes
// are guesses and aim his size chart at them. Off until the View card's "Show estimated sizes" is on; every figure always
// says what it rests on (data-size-estimated), the outline only draws when asked for.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';

afterEach(cleanup);

const fig = (id: string, over: Partial<Figure> = {}): Figure =>
  ({ _id: id, name: id, manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...over }) as Figure;
const FIGURES = [
  fig('listed', { dimensions: { heightMm: 200, widthMm: 120, depthMm: 90 } }),
  fig('width-guessed', { dimensions: { heightMm: 200 } }),
  fig('height-guessed', { scale: '1/8', dimensions: { widthMm: 120 } }),
  fig('both-guessed', { scale: '1/8' }),
  fig('default', {}),
];

const scene = (patch: Partial<CasePrefs> = {}) => {
  const { container } = render(<CabinetScene figures={FIGURES} onSelect={vi.fn()} prefs={{ ...LEGACY_PREFS, ...patch }} />);
  const host = container.querySelector<HTMLElement>('.cabinet-scene')!;
  const estimated = Object.fromEntries(Array.from(container.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => [b.getAttribute('aria-label'), b.dataset.sizeEstimated]));
  return { host, estimated };
};

describe('CabinetScene: which figures are sized from an estimate (SIZE-BASIS-1)', () => {
  it('every figure says what is estimated of it: nothing, its width, its height, or both', () => {
    const { estimated } = scene();
    expect(estimated).toEqual({ listed: '', 'width-guessed': 'width', 'height-guessed': 'height', 'both-guessed': 'both', default: 'both' });
  });

  it('the outline is off to begin with, and on once the pref is on', () => {
    expect(scene().host.dataset.showEstimated).toBe('0');
    expect(scene({ showEstimated: true }).host.dataset.showEstimated).toBe('1');
  });

  it('the outline draws only on the figures that are estimated, only when asked for: dashed, quiet, and never a tap target of its own', () => {
    scene();
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    const rule = /\.cabinet-scene\[data-show-estimated='1'\] \.cab-figure\[data-size-estimated\]:not\(\[data-size-estimated=''\]\)\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'the outline rule').not.toBeNull();
    expect(rule![1]).toMatch(/outline:\s*[\d.]+px dashed/);
    expect(rule![1]).not.toMatch(/pointer-events/);
  });
});
