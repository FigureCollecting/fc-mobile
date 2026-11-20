import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, renderHook } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, useCasePrefs, writeCasePrefs, type CasePrefs } from '../casePrefs';
import { CaseViewCard } from '../CaseViewCard';
import { CabinetScene } from '../CabinetScene';
import { LOOK_HOLD_MS } from '../casePose';
import { __clearAlphaMarginCache } from '../alphaMargin';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

// NAV-GRAD: the Free camera is the case's only camera. The View card has no box to turn it off, a device that had it
// off (a stored freeCamera: false) opens the Free camera all the same, and the next write of the prefs drops the field.

const COVER = { width: 443, height: 418 };
const FIGURES = Array.from({ length: 40 }, (_, i) => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm: 200, widthMm: 100 } }) as Figure);
/** What a device that had unticked the box holds. */
const storeOff = (more: Record<string, unknown> = {}) => localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: false, ...more }));
const stored = () => JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!) as Record<string, unknown>;
const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const yaw = () => (JSON.parse(host().dataset.camera!) as { yaw?: number }).yaw;
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** A still hold at a point of the scene, then a drag to the right: Look. */
function holdLook() {
  fireEvent.pointerDown(host(), { pointerId: 1, clientX: 220, clientY: 200, button: 0 });
  tick(LOOK_HOLD_MS + 10);
  const armed = host().dataset.gesture;
  for (const x of [230, 240, 250]) {
    fireEvent.pointerMove(host(), { pointerId: 1, clientX: x, clientY: 200 });
    tick(16);
  }
  const turned = yaw();
  fireEvent.pointerUp(host(), { pointerId: 1, clientX: 250, clientY: 200 });
  tick(20);
  return { armed, turned };
}

beforeEach(() => {
  localStorage.clear();
  __clearAlphaMarginCache();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NAV-GRAD (a): the View card has no Free camera control', () => {
  it('no checkbox, switch or text of that name; "Show estimated sizes" is the card\'s one checkbox', () => {
    render(<CaseViewCard open prefs={DEFAULT_CASE_PREFS} onChange={vi.fn()} onClose={() => {}} />);
    expect(screen.queryByRole('checkbox', { name: /free camera/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /free camera/i })).toBeNull();
    expect(screen.queryByText(/free camera/i)).toBeNull();
    expect(screen.getAllByRole('checkbox').map((b) => b.closest('label')!.textContent!.trim())).toEqual(['Show estimated sizes']);
  });

  it('no tap on the card patches freeCamera, and the Depth control group shows whatever a caller hands it', () => {
    const onChange = vi.fn();
    render(<CaseViewCard open prefs={{ ...DEFAULT_CASE_PREFS, freeCamera: false } as CasePrefs} onChange={onChange} onClose={() => {}} />);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(onChange.mock.calls.flatMap(([patch]) => Object.keys(patch as object))).not.toContain('freeCamera');
    expect(screen.getByRole('group', { name: 'Depth control' })).toBeInTheDocument();
  });
});

describe('NAV-GRAD (b): a stored freeCamera: false still opens the Free camera', () => {
  beforeEach(() => vi.useFakeTimers());

  it('read from the device: data-free-camera is there, and a still hold then a drag looks', () => {
    storeOff({});
    render(<CabinetScene figures={FIGURES} onSelect={vi.fn()} prefs={readCasePrefs()} frameFallback={COVER} />);
    expect(host().dataset.freeCamera).toBe('1');
    expect(host().hasAttribute('data-pan'), 'the old path published its pan').toBe(false);
    expect(yaw()).toBe(0);
    const { armed, turned } = holdLook();
    expect(armed).toBe('look');
    // finger right: the eye turns left
    expect(turned).toBeLessThan(0);
  });

  it('handed straight to the scene by a caller that still has the field: the same', () => {
    render(<CabinetScene figures={FIGURES} onSelect={vi.fn()} prefs={{ ...DEFAULT_CASE_PREFS, freeCamera: false } as CasePrefs} frameFallback={COVER} />);
    expect(host().dataset.freeCamera).toBe('1');
    expect(host().querySelector('.cabinet-scene__look-ring')).not.toBeNull();
    expect(holdLook().turned).toBeLessThan(0);
  });

  it.each([true, 0, 'false', null, {}, undefined])('whatever the field holds (%j), the prefs read carry no freeCamera', (value) => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: value, ceilingMm: 2700 }));
    const read = readCasePrefs();
    expect(read).not.toHaveProperty('freeCamera');
    expect(read.ceilingMm).toBe(2700);
    expect(DEFAULT_CASE_PREFS).not.toHaveProperty('freeCamera');
  });
});

describe('NAV-GRAD (c): the next prefs write drops freeCamera', () => {
  it('a write of another field keeps what the device chose and drops the field', () => {
    storeOff({ pattern: 'ikea-detolf', ceilingMm: 2700 });
    expect(stored(), 'reading alone rewrites nothing').toHaveProperty('freeCamera', false);
    readCasePrefs();
    expect(stored()).toHaveProperty('freeCamera', false);
    writeCasePrefs({ showEstimated: true });
    expect(stored()).not.toHaveProperty('freeCamera');
    expect(stored()).toMatchObject({ pattern: 'ikea-detolf', ceilingMm: 2700, showEstimated: true });
  });

  it('the hook\'s update does the same', () => {
    storeOff({ ceilingMm: 2700 });
    const { result } = renderHook(() => useCasePrefs());
    expect(result.current[0]).not.toHaveProperty('freeCamera');
    act(() => result.current[1]({ depthRocker: 'horizontal' }));
    expect(stored()).not.toHaveProperty('freeCamera');
    expect(stored()).toMatchObject({ ceilingMm: 2700, depthRocker: 'horizontal' });
  });

  it('storage that refuses the write changes nothing and throws nothing', () => {
    storeOff({ ceilingMm: 2700 });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(writeCasePrefs({ showEstimated: true })).not.toHaveProperty('freeCamera');
    } finally {
      set.mockRestore();
    }
    expect(stored()).toHaveProperty('freeCamera', false);
  });
});
