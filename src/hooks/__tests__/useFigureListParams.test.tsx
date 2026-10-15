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
      <span data-testid="keys">{Object.keys(p).filter((k) => /motif/i.test(k)).join(',')}</span>
      <span data-testid="mfr">{p.filters.mfr.join(',')}</span>
      <span data-testid="cat">{p.filters.cat.join(',')}</span>
      <span data-testid="type">{p.filters.type.join(',')}</span>
      <span data-testid="sort">{p.sort}:{p.order}</span>
      <span data-testid="labels">{String(p.labels)}</span>
      <button type="button" onClick={() => p.setLayout('rows')}>set-rows</button>
      <button type="button" onClick={() => p.setDensity('gallery')}>set-gallery</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, mfr: ['Good Smile Company', 'Max Factory'] })}>set-mfr</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, cat: [] })}>clear-cat</button>
      <button type="button" onClick={() => p.setSort('name', 'desc')}>set-sort</button>
      <button type="button" onClick={() => p.setLabels(true)}>set-labels-on</button>
      <button type="button" onClick={() => p.setLabels(false)}>set-labels-off</button>
    </div>
  );
}

describe('useFigureListParams', () => {
  it('defaults: case layout, compact density, Prepainted+Figures preselected; no case motif (the cabinet profile replaced it)', () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('layout').textContent).toBe('case');
    expect(screen.getByTestId('density').textContent).toBe('compact');
    expect(screen.getByTestId('keys').textContent).toBe('');
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

  it('defaults labels to off when the URL is silent', () => {
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('labels').textContent).toBe('false');
  });

  it('reads labels=1 from the URL as on', () => {
    renderWithProviders(<Probe />, { initialPath: '/?labels=1' });
    expect(screen.getByTestId('labels').textContent).toBe('true');
  });

  it('treats any non-"1" labels value as off', () => {
    renderWithProviders(<Probe />, { initialPath: '/?labels=true' });
    expect(screen.getByTestId('labels').textContent).toBe('false');
  });

  it('round-trips setLabels through the URL param', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Probe />);
    await user.click(screen.getByText('set-labels-on'));
    expect(screen.getByTestId('labels').textContent).toBe('true');
    await user.click(screen.getByText('set-labels-off'));
    expect(screen.getByTestId('labels').textContent).toBe('false');
  });
});

function HoldProbe({ labelsDefault, holdingsDefault }: { labelsDefault?: boolean; holdingsDefault?: ('owned' | 'ordered' | 'wished' | 'former')[] }) {
  const p = useFigureListParams({ labelsDefault, holdingsDefault });
  return (
    <div>
      <span data-testid="status">{p.filters.status.join(',')}</span>
      <span data-testid="default-status">{p.defaults.status.join(',')}</span>
      <span data-testid="default-cat">{p.defaults.cat.join(',')}</span>
      <span data-testid="labels">{String(p.labels)}</span>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, status: ['wished', 'ordered'] })}>hold-wished-ordered</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, status: ['owned'] })}>hold-owned</button>
      <button type="button" onClick={() => p.setFilters({ ...p.filters, status: [] })}>hold-none</button>
      <button type="button" onClick={() => p.setLabels(false)}>labels-off</button>
      <button type="button" onClick={() => p.setLabels(true)}>labels-on</button>
    </div>
  );
}

describe('useFigureListParams: holdings, chosen in Refine (SHEETS-FB1 3), and the labels default (WK-15)', () => {
  it('holdings default to Owned; status= names them, values it does not know left out, none known the default', () => {
    renderWithProviders(<HoldProbe />);
    expect(screen.getByTestId('status').textContent).toBe('owned');
    expect(screen.getByTestId('default-status').textContent).toBe('owned');
    expect(screen.getByTestId('default-cat').textContent).toBe(DEFAULT_CAT.join(','));
    renderWithProviders(<HoldProbe />, { initialPath: '/?status=wished|bogus|former' });
    expect(screen.getAllByTestId('status')[1]!.textContent).toBe('wished,former');
    renderWithProviders(<HoldProbe />, { initialPath: '/?status=bogus' });
    expect(screen.getAllByTestId('status')[2]!.textContent).toBe('owned');
  });

  it('an old tab= link opens on that holding; status= wins over it', () => {
    renderWithProviders(<HoldProbe />, { initialPath: '/?tab=wished' });
    expect(screen.getByTestId('status').textContent).toBe('wished');
    renderWithProviders(<HoldProbe />, { initialPath: '/?tab=bogus' });
    expect(screen.getAllByTestId('status')[1]!.textContent).toBe('owned');
    renderWithProviders(<HoldProbe />, { initialPath: '/?tab=wished&status=ordered' });
    expect(screen.getAllByTestId('status')[2]!.textContent).toBe('ordered');
  });

  it('writes holdings to the URL, the default left out, none chosen kept by the all sentinel; an old tab= goes', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<HoldProbe />, { initialPath: '/?tab=former' });
    await user.click(screen.getByText('hold-wished-ordered'));
    expect(screen.getByTestId('status').textContent).toBe('wished,ordered');
    expect(currentPath()).toContain('status=wished%7Cordered');
    expect(currentPath()).not.toContain('tab=');
    await user.click(screen.getByText('hold-none'));
    expect(screen.getByTestId('status').textContent).toBe('');
    expect(currentPath()).toContain('status=all');
    await user.click(screen.getByText('hold-owned'));
    expect(screen.getByTestId('status').textContent).toBe('owned');
    expect(currentPath()).not.toContain('status=');
  });

  it('where the holdings default is none (the fixtures), none chosen is the default and needs no URL', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<HoldProbe holdingsDefault={[]} />);
    expect(screen.getByTestId('status').textContent).toBe('');
    expect(screen.getByTestId('default-status').textContent).toBe('');
    await user.click(screen.getByText('hold-wished-ordered'));
    await user.click(screen.getByText('hold-none'));
    expect(currentPath()).not.toContain('status=');
  });

  it('shows labels by default where asked (no images to show), and an explicit 0 turns them off', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<HoldProbe labelsDefault />);
    expect(screen.getByTestId('labels').textContent).toBe('true');
    await user.click(screen.getByText('labels-off'));
    expect(screen.getByTestId('labels').textContent).toBe('false');
    expect(currentPath()).toContain('labels=0');
    await user.click(screen.getByText('labels-on'));
    expect(screen.getByTestId('labels').textContent).toBe('true');
    expect(currentPath()).not.toContain('labels=');
  });
});
