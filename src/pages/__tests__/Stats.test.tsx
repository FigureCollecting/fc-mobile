// Stats from the local store (WK-15): copies per kind and the top makers, offline too.
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import { Stats } from '../Stats';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';

afterEach(() => {
  localSession.value = undefined;
});

const tile = (label: string) => screen.getByText(label, { selector: '.page-stats__label' }).previousElementSibling?.textContent;

describe('Stats page', () => {
  it('counts copies per kind and lists the top makers, from the local store', async () => {
    const r = await localRig();
    await seedFigures(r, [
      { title: 'A', manufacturer: 'Alter', copies: 2 },
      { title: 'B', manufacturer: 'Alter', status: 'ordered' },
      { title: 'C', manufacturer: 'Max Factory', status: 'wished' },
      { title: 'D', manufacturer: 'Alter', status: 'former', disposal: { reason: 'sold' } },
    ]);
    renderWithProviders(<Stats />, { initialPath: '/stats' });
    await waitFor(() => expect(tile('Total')).toBe('4'));
    expect(tile('Owned')).toBe('2');
    expect(tile('Ordered')).toBe('1');
    expect(tile('Wished')).toBe('1');
    expect(screen.getByText('Top manufacturers')).toBeInTheDocument();
    const makers = [...document.querySelectorAll('.page-stats__bar-label')].map((e) => e.textContent);
    expect(makers).toEqual(['Alter', 'Max Factory']);
  });

  it('asks a signed-out visitor to sign in', async () => {
    await localRig({ status: 'signed-out' });
    renderWithProviders(<Stats />, { initialPath: '/stats' });
    expect(screen.getByText('Sign in to see your stats')).toBeInTheDocument();
  });
});
