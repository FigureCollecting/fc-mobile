// LOADBAR-2 (Ross 11-04): on the collection, in the case and in rows, the catalogue's load is said by a strip over the filter
// chips row while one stands, the row out of reach under it; where none stands no strip is drawn (challenge B1: it would
// cover the case's controls and the first figures), the bar's own label saying it in the case. The strip's own behaviour is
// CatalogueLoadStrip's test; its box, its taps and what it leaves still are the e2e's (e2e/loadbar-strip.shots.spec.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

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

describe('Collection: the catalogue load strip over the filter row (LOADBAR-2)', () => {
  it.each(['case', 'rows'])('%s, filtered: the strip stands in the row\'s slot, over it, the row out of reach', async (layout) => {
    const { strip } = await open(`/?layout=${layout}&mfr=Good%20Smile%20Company&fxloadbar=cards:120:400`);
    const slot = strip.parentElement!;
    expect(slot).toHaveClass('catalogue-strip-slot');
    await waitFor(() => expect(strip).toHaveClass('catalogue-strip'));
    const row = slot.querySelector('.applied-chips')!;
    expect(row).not.toBeNull();
    expect(row.closest('[inert]')).not.toBeNull();
  });

  it.each(['case', 'rows'])('%s, nothing filtered: no strip is drawn, the live region says it; the slot under the top bar, ahead of the figures', async (layout) => {
    const { strip, container } = await open(`/?layout=${layout}&fxloadbar=cards:120:400`);
    expect(strip).not.toHaveClass('catalogue-strip');
    expect(strip).toHaveClass('sr-only');
    expect(container.querySelector('.catalogue-strip')).toBeNull();
    const slot = strip.parentElement!;
    expect(slot).toHaveClass('catalogue-strip-slot');
    expect(slot.querySelector('.applied-chips')).toBeNull();
    const page = container.querySelector('.page-collection')!;
    const order = [...page.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('slim-header')).toBeLessThan(order.indexOf('catalogue-strip-slot'));
    expect(order.indexOf('catalogue-strip-slot')).toBeLessThan(order.indexOf('page-collection__body'));
  });
});
