// LOADBAR-2 (Ross 11-04): on the collection, in the case and in rows, the catalogue's load is said by a strip over the filter
// chips row's place, the row under it while it shows, and taking that place under the top bar where no row stands. The
// strip's own behaviour is CatalogueLoadStrip's test; its box, its taps and what it leaves still are the e2e's
// (e2e/loadbar-strip.shots.spec.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Collection } from '../Collection';
import { renderWithProviders } from '../../test/testUtils';
import { setFixtureMode } from '../../dev-fixtures/fixtures';

afterEach(() => {
  setFixtureMode(false);
  window.history.pushState({}, '', '/');
});

async function open(path: string) {
  setFixtureMode(true);
  window.history.pushState({}, '', path);
  const utils = renderWithProviders(<Collection />, { initialPath: path });
  const strip = await screen.findByText('Loading catalogue · 120 of 400', { selector: '[role="status"]' }, { timeout: 3_000 });
  return { container: utils.container, strip };
}

describe('Collection: the catalogue load strip in the filter row\'s place (LOADBAR-2)', () => {
  it.each(['case', 'rows'])('%s, filtered: the strip stands in the same slot as the row of chips, over it', async (layout) => {
    const { strip } = await open(`/?layout=${layout}&mfr=Good%20Smile%20Company&fxloadbar=cards:120:400`);
    const slot = strip.parentElement!;
    expect(slot).toHaveClass('page-collection__chips-slot');
    expect(slot.querySelector('.applied-chips')).not.toBeNull();
    expect(strip).toHaveClass('catalogue-strip');
  });

  it.each(['case', 'rows'])('%s, nothing filtered: the strip takes the slot alone, under the top bar and ahead of the figures', async (layout) => {
    const { strip, container } = await open(`/?layout=${layout}&fxloadbar=cards:120:400`);
    const slot = strip.parentElement!;
    expect(slot).toHaveClass('page-collection__chips-slot');
    expect(slot.querySelector('.applied-chips')).toBeNull();
    const page = container.querySelector('.page-collection')!;
    const order = [...page.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('slim-header')).toBeLessThan(order.indexOf('page-collection__chips-slot'));
    expect(order.indexOf('page-collection__chips-slot')).toBeLessThan(order.indexOf('page-collection__body'));
  });
});
