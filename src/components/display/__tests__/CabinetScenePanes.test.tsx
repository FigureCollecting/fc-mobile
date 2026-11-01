import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { CabinetScene } from '../CabinetScene';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { IKEA_KLINGSBO } from '../cabinetPresets';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

/** The wall the case stands: a test may swap in its own cabinet. */
const wall = vi.hoisted(() => ({ profiles: null as unknown[] | null }));

vi.mock('../casePrefs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../casePrefs')>();
  return { ...real, wallPatternProfiles: (id: string) => (wall.profiles as ReturnType<typeof real.wallPatternProfiles> | null) ?? real.wallPatternProfiles(id) };
});

afterEach(() => {
  cleanup();
  wall.profiles = null;
});

describe('CabinetScene: glass only where the cabinet has glass (CC13)', () => {
  it('a cabinet with solid sides and back and an open front draws no pane; its glass twin draws all four', () => {
    const solid = { ...IKEA_KLINGSBO, id: 'solid-klingsbo', materials: { sides: 'wood', back: 'solid', front: 'open' } as const };
    wall.profiles = [solid];
    const { container } = render(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={LEGACY_PREFS} />);
    expect(container.querySelector('.cab')).not.toBeNull();
    expect(container.querySelectorAll('.cab-pane')).toHaveLength(0);
    cleanup();
    wall.profiles = null;
    const glass = render(<CabinetScene figures={FIXTURE_FIGURES} onSelect={vi.fn()} prefs={LEGACY_PREFS} />).container;
    for (const kind of ['side', 'back', 'door']) expect(glass.querySelectorAll(`.cab-pane--${kind}`).length).toBeGreaterThan(0);
  });
});
