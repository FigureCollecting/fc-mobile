import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { Privacy } from '../Privacy';
import { CONTACT_ADDRESS, PRIVACY } from '../../content/privacyText';
import { renderWithProviders } from '../../test/testUtils';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Privacy page', () => {
  it('shows the title, the version date and every section of the text, in order', () => {
    renderWithProviders(<Privacy />, { initialPath: '/privacy' });
    expect(screen.getByRole('heading', { level: 1, name: PRIVACY.title })).toBeInTheDocument();
    expect(screen.getByText(/^Version of /)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(PRIVACY.sections.map((s) => s.heading));
  });

  it('shows each paragraph and list item exactly as the text has it', () => {
    renderWithProviders(<Privacy />, { initialPath: '/privacy' });
    const article = screen.getByRole('article');
    const shown = Array.from(article.querySelectorAll('h1, h2, p, li')).map((el) => el.textContent);
    const expected = [
      PRIVACY.title,
      ...PRIVACY.intro.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items)),
      ...PRIVACY.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items))]),
    ];
    expect(shown).toEqual(expected);
    const lists = PRIVACY.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'ul');
    expect(within(article).getAllByRole('list')).toHaveLength(lists.length);
  });

  it('makes each contact address a mail link, and has no other link in the text', () => {
    renderWithProviders(<Privacy />, { initialPath: '/privacy' });
    const links = within(screen.getByRole('article')).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', `mailto:${CONTACT_ADDRESS}`);
      expect(link).toHaveTextContent(CONTACT_ADDRESS);
    }
  });

  it('opened by its address: offers a link to the app, not a Back button', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<Privacy standalone />, { initialPath: '/privacy' });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    const open = screen.getByRole('link', { name: 'Open FigureCollecting' });
    expect(open).toHaveAttribute('href', '/');
    expect(document.querySelector('.privacy')).toHaveClass('privacy--standalone');
    await user.click(open);
    expect(view.currentPath()).toBe('/');
  });

  it('shown inside the app: Back returns to where the reader was', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(<Privacy />, { initialPath: '/privacy' });
    expect(screen.queryByRole('link', { name: 'Open FigureCollecting' })).toBeNull();
    expect(document.querySelector('.privacy')).not.toHaveClass('privacy--standalone');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
