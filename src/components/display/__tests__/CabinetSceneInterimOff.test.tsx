import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';

// CASE-FB2a: with the interim re-pack rule switched off (as a saved-layout mode will), a new filter keeps the view.
vi.mock('../caseInterim', async (importOriginal) => ({ ...(await importOriginal<typeof import('../caseInterim')>()), REPACK_ON_FILTER: false }));

afterEach(() => cleanup());

describe('CASE-FB2a: REPACK_ON_FILTER off', () => {
  it('a new filter keeps the walk and the cabinet in view', () => {
    const many = getFixtureFigures(8);
    const props = { figures: many, onSelect: vi.fn(), prefs: { ...DEFAULT_CASE_PREFS, view: 'cabinet' as const, swipe: 'camera' as const }, frameFallback: { width: 443, height: 558 } };
    const { container, rerender } = render(<CabinetScene {...props} filterKey="all" />);
    const host = container.querySelector('.cabinet-scene') as HTMLElement;
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 50, clientY: 200 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: -100, clientY: 200 });
    fireEvent.pointerUp(host, { pointerId: 1, clientX: -100, clientY: 200 });
    const walked = { camera: host.dataset.camera, focus: host.dataset.focus };
    expect(walked.focus).not.toBe('0');
    rerender(<CabinetScene {...props} figures={many.slice(0, 40)} filterKey="wished" />);
    expect({ camera: host.dataset.camera, focus: host.dataset.focus }).toEqual(walked);
  });
});
