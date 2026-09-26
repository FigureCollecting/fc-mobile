import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { FacetControl } from '../FacetControl';
import { renderWithProviders } from '../../../test/testUtils';
import type { FacetValue } from '../../../utils/facets';

const small: FacetValue[] = [
  { value: '1/7', count: 12 },
  { value: '1/8', count: 8 },
  { value: 'Unspecified', count: 3 },
];

const large: FacetValue[] = Array.from({ length: 20 }, (_, i) => ({
  value: `Maker ${String.fromCharCode(65 + i)}`,
  count: 20 - i,
}));

describe('FacetControl (cardinality-aware)', () => {
  it('renders a plain chip row with counts for small facets', () => {
    renderWithProviders(<FacetControl label="Scale" values={small} selected={[]} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /1\/7\s*12/ })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('switches to shortlist plus type-ahead above the chip limit', () => {
    renderWithProviders(<FacetControl label="Manufacturer" values={large} selected={[]} onToggle={() => {}} />);
    // top-8 shortlist only
    expect(screen.getByText('Maker A')).toBeInTheDocument();
    expect(screen.queryByText('Maker T')).toBeNull();
    expect(screen.getByRole('searchbox', { name: /search manufacturer/i })).toBeInTheDocument();
  });

  it('finds long-tail values through the type-ahead', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithProviders(<FacetControl label="Manufacturer" values={large} selected={[]} onToggle={onToggle} />);
    await user.type(screen.getByRole('searchbox'), 'maker t');
    const option = await screen.findByRole('option', { name: /maker t/i });
    await user.click(option);
    expect(onToggle).toHaveBeenCalledWith('Maker T');
  });

  it('pins selected values into the shortlist', () => {
    renderWithProviders(
      <FacetControl label="Manufacturer" values={large} selected={['Maker T']} onToggle={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /maker t/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles a chip', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithProviders(<FacetControl label="Scale" values={small} selected={[]} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: /1\/8/ }));
    expect(onToggle).toHaveBeenCalledWith('1/8');
  });
});
