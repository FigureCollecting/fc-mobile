import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';

// FETCH-FIRST (10-31: on a slow link, the case arranged by series, its first figure in view stood as its plate for a minute):
// the case tells its owner the figures it draws now, then every other it stands, in the order it stands them, so the image
// sync fetches the pictures of what is in view first

beforeEach(() => {
  __clearAlphaMarginCache();
});
afterEach(() => cleanup());

const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, ...patch });
const drawn = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => b.dataset.figureId!);
/** The figures' ids as the case stands them, in reading order (cabinet by cabinet, its top first). */
const standing = (host: HTMLElement) => (JSON.parse(host.dataset.order!) as string[][]).flat();

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}) {
  const onViewOrder = vi.fn<(shown: readonly Figure[]) => void>();
  const props = { figures, onSelect: vi.fn(), prefs: prefs(patch), onViewOrder };
  const utils = render(<CabinetScene {...props} />);
  const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
  const told = () => onViewOrder.mock.lastCall![0].map((f) => f._id);
  const again = () => utils.rerender(<CabinetScene {...props} />);
  return { ...utils, host, onViewOrder, told, again };
}

describe('CabinetScene: the figures in view first, then the rest as the case stands them (FETCH-FIRST)', () => {
  it('tells the figures it draws, in its reading order, then every other figure it stands, in the order it stands them', () => {
    const { host, told } = scene(getFixtureFigures(40), { view: 'cabinet' });
    const shown = drawn(host);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(standing(host).length);
    expect(told()).toEqual([...shown, ...standing(host).filter((id) => !shown.includes(id))]);
  });

  it('a step to the next cabinet tells the figures it draws there first', () => {
    const { host, told } = scene(getFixtureFigures(40), { view: 'cabinet' });
    const before = drawn(host);
    fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
    const after = drawn(host);
    expect(after).not.toEqual(before);
    expect(told()).toEqual([...after, ...standing(host).filter((id) => !after.includes(id))]);
  });

  it('tells nothing again while what it draws and what it stands are the same', () => {
    const { onViewOrder, again } = scene(getFixtureFigures(40), { view: 'cabinet' });
    const calls = onViewOrder.mock.calls.length;
    again();
    again();
    expect(onViewOrder.mock.calls.length).toBe(calls);
  });
});
