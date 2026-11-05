/**
 * NAV-2A2 (Ross 11-04, "just do away with the mode switch icon"): the case header has no swipe button on either
 * camera, so the page hands its display controls nothing for one: no swipe mode, no handler, no Free camera flag.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

const seen = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../../components/display/DisplayToggle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/display/DisplayToggle')>();
  return {
    DisplayToggle: (props: Parameters<typeof actual.DisplayToggle>[0]) => {
      seen.push(props as unknown as Record<string, unknown>);
      return <actual.DisplayToggle {...props} />;
    },
  };
});

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { CASE_PREFS_KEY } from '../../components/display/casePrefs';

afterEach(() => {
  seen.length = 0;
  localStorage.clear();
  localSession.value = undefined;
});

describe('NAV-2A2: Collection hands the header no swipe props', () => {
  for (const freeCamera of [false, true]) {
    it(`Free camera ${freeCamera ? 'on' : 'off'}, Pan the wall stored before: no swipe, onSwipe or freeCamera prop, and no swipe button`, async () => {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera, swipe: 'pan' }));
      const r = await localRig();
      await seedFigures(r, [{ title: 'Figure 1', manufacturer: 'Good Smile' }]);
      renderWithProviders(<Collection />, { initialPath: '/' });
      // a cold first render of the page on a loaded host takes past findBy's 1 s default
      await screen.findByRole('button', { name: 'Figure 1' }, { timeout: 5000 });
      expect(document.querySelector('.cabinet-scene[data-free-camera]') !== null).toBe(freeCamera);
      expect(seen.length).toBeGreaterThan(0);
      for (const props of seen) {
        expect(props.layout).toBe('case');
        expect(Object.keys(props).filter((k) => ['swipe', 'onSwipe', 'freeCamera'].includes(k))).toEqual([]);
      }
      expect(screen.queryByRole('button', { name: /^Swipe/ })).toBeNull();
    });
  }
});
