import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { useFigureListParams, DEFAULT_CAT, DEFAULT_TYPE } from '../useFigureListParams';
import { renderWithProviders } from '../../test/testUtils';

afterEach(() => localStorage.clear());

function Probe() {
  const p = useFigureListParams();
  return (
    <div>
      <span data-testid="layout">{p.layout}</span>
      <span data-testid="density">{p.density}</span>
      <span data-testid="motif">{p.motif}</span>
      <span data-testid="mfr">{p.filters.mfr.join(',')}</span>
      <span data-testid="cat">{p.filters.cat.join(',')}</span>
      <span data-testid="type">{p.filters.type.join(',')}</span>
      <span data-testid="sort">{p.sort}:{p.order}</span>
      <button type="button" onClick={() => p.setLayout('rows')}>set-rows</button>
      <button type="button" onClick={() => p.setDensity('gallery')}>set-gallery</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, mfr: ['Good Smile Company', 'Max Factory'] })}>set-mfr</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, cat: [] })}>clear-cat</button>
      <button type="button" onClick={() => p.setSort('name', 'desc')}>set-sort</button>
    </div>
  );
}

describe('useFigureListParams', () => {
  it('defaults: case layout, compact density, detolf motif, Prepainted+Figures preselected', () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('layout').textContent).toBe('case');
    expect(screen.getByTestId('density').textContent).toBe('compact');
    expect(screen.getByTestId('motif').textContent).toBe('detolf-dark');
    expect(screen.getByTestId('cat').textContent).toBe(DEFAULT_CAT.join(','));
    expect(screen.getByTestId('type').textContent).toBe(DEFAULT_TYPE.join(','));
    expect(screen.getByTestId('sort').textContent).toBe('activity:asc');
  });

  it('reads state from URL params using fc-frontend names and pipe lists', () => {
    renderWithProviders(<Probe />, {
      initialPath: '/?layout=rows&density=gallery&mfr=Good%20Smile%20Company|Max%20Factory&sort=name&order=desc',
    });
    expect(screen.getByTestId('layout').textContent).toBe('rows');
    expect(screen.getByTestId('density').textContent).toBe('gallery');
    expect(screen.getByTestId('mfr').textContent).toBe('Good Smile Company,Max Factory');
    expect(screen.getByTestId('sort').textContent).toBe('name:desc');
  });

  it('writes layout to URL and persists it in localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByText('set-rows'));
    expect(screen.getByTestId('layout').textContent).toBe('rows');
    expect(localStorage.getItem('fc-list-layout')).toBe('rows');
  });

  it('falls back to the localStorage preference when the URL is silent', () => {
    localStorage.setItem('fc-list-density', 'comfortable');
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('density').textContent).toBe('comfortable');
  });

  it('serializes multi-value facets as pipe-separated params', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByText('set-mfr'));
    expect(screen.getByTestId('mfr').textContent).toBe('Good Smile Company,Max Factory');
  });

  it('keeps removed defaults removed via the explicit all sentinel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByText('clear-cat'));
    expect(screen.getByTestId('cat').textContent).toBe('');
  });

  it('records sort changes with default elision', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByText('set-sort'));
    expect(screen.getByTestId('sort').textContent).toBe('name:desc');
  });
});
