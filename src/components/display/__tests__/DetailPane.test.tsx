import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { DetailPane } from '../DetailPane';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

describe('DetailPane (Fold dual-pane, >= 640px)', () => {
  it('renders the figure detail content, not a full-screen takeover', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(
      <DetailPane figure={rem} index={0} total={7} onClose={() => {}} />,
    );
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    // No PhotoSwipe root, no fixed full-screen sheet — just the pane.
    expect(container.querySelector('.pswp')).toBeNull();
    expect(document.body.querySelector('.figure-viewer-sheet')).toBeNull();
  });

  it('a pane, not a sheet: no handle, and every field shown (SHEETS-FB1 6)', () => {
    const dark = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!;
    const { container } = renderWithProviders(<DetailPane figure={dark} index={1} total={7} onClose={() => {}} />);
    expect(container.querySelector('.figure-viewer-sheet__handle')).toBeNull();
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
  });

  it('asks for its image with crossorigin anonymous, a CORS request (src/sw.ts)', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    expect(container.querySelector('.detail-pane__image')).toHaveAttribute('crossorigin', 'anonymous');
  });

  it('draws the placeholder when the image fails to load', async () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    expect(container.querySelector('.detail-pane__placeholder')).toBeNull();
    fireEvent.error(container.querySelector('.detail-pane__image')!);
    await waitFor(() => expect(container.querySelector('.detail-pane__placeholder')).not.toBeNull());
    expect(container.querySelector('.detail-pane__image')).toBeNull();
  });

  // CARD-VIEW-1 (Ross 10-25: "not every card view had zoom available"): the pane's picture zooms as the viewer's does
  it('its picture zooms: a visible zoom control, and its X stays at the top-right', async () => {
    const user = userEvent.setup();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    const frame = container.querySelector('.detail-pane .zoomable') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.querySelector('img.detail-pane__image')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(JSON.parse(frame.dataset.zoom!).k).toBe(2);
    expect(screen.getByRole('button', { name: 'Close detail' })).toBeVisible();
  });

  // CARD-VIEW-1 part 3: the pane's card carries Go to; going leaves the pane open (its host decides: Collection)
  it('carries Go to for the figure it shows, and its reason when it has nowhere to go', async () => {
    const user = userEvent.setup();
    const goTo = vi.fn();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} goTo={goTo} goToBlocked={() => null} />);
    await user.click(screen.getByRole('button', { name: 'Go to' }));
    expect(goTo).toHaveBeenCalledWith(rem);
    expect(onClose).not.toHaveBeenCalled();
    rerender(<DetailPane figure={rem} index={0} total={7} onClose={onClose} goTo={goTo} goToBlocked={() => 'Not on a shelf'} />);
    expect(screen.getByRole('button', { name: 'Go to' })).toBeDisabled();
  });

  it('calls onClose when the close button is tapped', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close detail/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes it, and so does Back: it opens a history entry (SHEETS-FB1 6c)', async () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await new Promise((r) => setTimeout(r, 30));
    const onBack = vi.fn();
    renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={onBack} />);
    history.back();
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });

  // SIDE-RAIL-1 (Ross 10-18): the same rail of the figure card's sections, at the pane's right edge
  it('carries the figure sections on a right rail: Details, Photos and Copies, 24 px in, the pane leaving it room', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    const rail = container.querySelector('.detail-pane .side-rail') as HTMLElement;
    expect(rail.getAttribute('aria-label')).toBe('Figure sections');
    expect(Array.from(rail.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Details', 'Photos', 'Copies']);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-current', 'true');
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.detail-pane__rail\s*\{[^}]*right:\s*calc\(24px \+ var\(--safe-area-right/);
    expect(css).toMatch(/\.detail-pane\s*\{[^}]*padding-right:\s*calc\(24px \+ 60px \+ 8px/);
  });

  // GALLERY-1: Photos opens the figure's photos over the pane
  it('Photos opens the figure\'s photos; a figure with no local item has none, so the tab is disabled', async () => {
    const user = userEvent.setup();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const bare = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Photos' })).toBeDisabled();
    bare.unmount();
    const local = { ...rem, local: { headId: 'h9', kind: 'owned', sync: 'known', asOf: null, copies: [] } } as never;
    renderWithProviders(<DetailPane figure={local} index={0} total={7} onClose={() => {}} />);
    expect(screen.queryByRole('dialog', { name: 'Photos' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Photos' }));
    expect(await screen.findByRole('dialog', { name: 'Photos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close photos' }));
    expect(screen.queryByRole('dialog', { name: 'Photos' })).toBeNull();
  });

  it('Copies opens the figure\'s full page; a figure with no local item has none to open', async () => {
    const user = userEvent.setup();
    const rem = { ...FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!, local: { headId: 'h9', kind: 'owned', sync: 'known', asOf: null } } as never;
    const { currentPath, unmount } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Copies' }));
    expect(currentPath()).toBe('/figure/h9');
    unmount();
    renderWithProviders(<DetailPane figure={FIXTURE_FIGURES[0]!} index={0} total={7} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Copies' })).toBeDisabled();
  });

  it('Details brings the fields into view', async () => {
    const user = userEvent.setup();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(<DetailPane figure={rem} index={0} total={7} onClose={() => {}} />);
    const fields = container.querySelector('.figure-viewer-sheet__more') as HTMLElement;
    const into = vi.fn();
    fields.scrollIntoView = into;
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(into).toHaveBeenCalledTimes(1);
  });
});
