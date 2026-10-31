import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';

// PACK1 (Ross 10-26): the case stands its figures in its own arrangement (series, then scale, then name by default), not
// in the list's sort; each figure keeps its list index for the tap, and a new arrangement starts the view again

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => cleanup());

const COVER = { width: 443, height: 558 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, pattern: 'ikea-detolf', clearanceMm: 0, ...patch });
const fig = (id: string, name: string, origin: string | undefined, scale: string, createdAt: string): Figure =>
  ({ _id: id, name, origin, scale, createdAt, dimensions: { heightMm: 200, widthMm: 100 } }) as Figure;

/** The list's own order (its sort): none of the arrangements'. */
const LIST: Figure[] = [
  fig('m', 'Miku', 'Vocaloid', '1/8', '2026-05-01T00:00:00Z'),
  fig('r', 'Rem', 'Re:Zero', '1/7', '2026-01-01T00:00:00Z'),
  fig('a', 'Archer', 'Fate', '1/7', '2026-03-01T00:00:00Z'),
  fig('s', 'Saber', 'Fate', '1/4', '2026-02-01T00:00:00Z'),
  fig('e', 'Emilia', 'Re:Zero', '', '2026-04-01T00:00:00Z'),
];

function scene(patch: Partial<CasePrefs> = {}, extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const onSelect = vi.fn();
  const props = { figures: LIST, onSelect, prefs: prefs(patch), frameFallback: COVER, ...extra };
  const utils = render(<CabinetScene {...props} />);
  const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
  const again = (next: Partial<Parameters<typeof CabinetScene>[0]>) => utils.rerender(<CabinetScene {...props} {...next} />);
  return { ...utils, onSelect, host, again };
}
/** The figures' ids as the case stands them, in reading order (cabinet by cabinet, its top first). */
const order = (host: HTMLElement) => (JSON.parse(host.dataset.order!) as string[][]).flat();

describe('CabinetScene: the case arrangement (PACK1)', () => {
  it('packs by series, then scale, then name on a fresh device, whatever the list order', () => {
    const { host } = scene();
    expect(host.dataset.arrange).toBe('series-scale-name');
    // Fate (Saber 1/4, Archer 1/7), Re:Zero (Rem 1/7, Emilia no scale), Vocaloid (Miku)
    expect(order(host)).toEqual(['s', 'a', 'r', 'e', 'm']);
  });

  it('each of the other orders, the list untouched', () => {
    const cases: [CasePrefs['arrange'], string[]][] = [
      ['scale-series-name', ['s', 'a', 'r', 'm', 'e']],
      ['series-name', ['a', 's', 'e', 'r', 'm']],
      ['scale-name', ['s', 'a', 'r', 'm', 'e']],
      ['name', ['a', 'e', 'm', 'r', 's']],
      ['date-added', ['m', 'e', 'a', 's', 'r']],
    ];
    for (const [arrange, ids] of cases) {
      const { host, unmount } = scene({ arrange });
      expect(order(host), arrange).toEqual(ids);
      unmount();
    }
    expect(LIST.map((f) => f._id)).toEqual(['m', 'r', 'a', 's', 'e']);
  });

  it('a tap opens the figure at its place in the list, wherever the case stands it', () => {
    const { onSelect } = scene({ arrange: 'name' });
    fireEvent.click(screen.getByRole('button', { name: 'Saber' }));
    expect(onSelect).toHaveBeenCalledWith(LIST[3], 3);
    expect(screen.getByRole('button', { name: 'Archer' }).dataset.index).toBe('2');
  });

  it('a new arrangement packs again', () => {
    const { host, again } = scene({ arrange: 'name' });
    expect(order(host)).toEqual(['a', 'e', 'm', 'r', 's']);
    again({ prefs: prefs({ arrange: 'date-added' }) });
    expect(host.dataset.arrange).toBe('date-added');
    expect(order(host)).toEqual(['m', 'e', 'a', 's', 'r']);
  });

  it('in the Free camera too', () => {
    const { host } = scene({ freeCamera: true, arrange: 'scale-name' });
    expect(host.dataset.freeCamera).toBe('1');
    expect(order(host)).toEqual(['s', 'a', 'r', 'm', 'e']);
  });
});

describe('CabinetScene: a new arrangement starts the view at the wall\'s start, as a new sort does', () => {
  // forty figures, three Detolfs: the one-cabinet view can step along them
  const forty = Array.from({ length: 40 }, (_, i) => fig(`f${i}`, `Figure ${String(i).padStart(2, '0')}`, i % 2 ? 'Odd' : 'Even', '1/8', `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));

  it('the one-cabinet view, stepped along, comes back to the first cabinet; the same arrangement again does not move it', () => {
    const props = { figures: forty, onSelect: vi.fn(), prefs: prefs({ view: 'cabinet' }), frameFallback: COVER };
    const { rerender, container } = render(<CabinetScene {...props} />);
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
    expect(host.dataset.focus).toBe('1');
    rerender(<CabinetScene {...props} prefs={prefs({ view: 'cabinet' })} />);
    expect(host.dataset.focus).toBe('1');
    rerender(<CabinetScene {...props} prefs={prefs({ view: 'cabinet', arrange: 'date-added' })} />);
    expect(host.dataset.focus).toBe('0');
  });

  it('Go to finds a figure where the new arrangement stands it', () => {
    const onWentTo = vi.fn();
    const props = { figures: forty, onSelect: vi.fn(), frameFallback: COVER, onWentTo };
    const { rerender, container } = render(<CabinetScene {...props} prefs={prefs({ view: 'shelf', arrange: 'name' })} />);
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    const cabinetOf = (id: string) => (JSON.parse(host.dataset.order!) as string[][]).findIndex((ids) => ids.includes(id));
    // by name f0 is first; arranged by series (Even, Odd) f1 stands with the odd ones, past the even ones' cabinet
    expect(cabinetOf('f1')).toBe(0);
    rerender(<CabinetScene {...props} prefs={prefs({ view: 'shelf', arrange: 'series-name' })} />);
    const there = cabinetOf('f1');
    expect(there).toBeGreaterThan(0);
    rerender(<CabinetScene {...props} prefs={prefs({ view: 'shelf', arrange: 'series-name' })} goTo={{ figureId: 'f1', seq: 1 }} />);
    expect(onWentTo).toHaveBeenCalledWith('f1', true);
    expect(Number(host.dataset.focus)).toBe(there);
    expect(screen.getByRole('button', { name: 'Figure 01' })).toBeInTheDocument();
  });
});
