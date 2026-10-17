import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

import { DetentSheet } from '../DetentSheet';
import { renderWithProviders } from '../../../test/testUtils';

describe('DetentSheet', () => {
  it('portals the sheet to document.body to escape the container-query containing block', () => {
    const { container } = renderWithProviders(
      <DetentSheet open onClose={() => {}} footer={<div>foot</div>}>
        <p>sheet body</p>
      </DetentSheet>,
    );
    // The sheet is NOT in the component's own subtree — a container-query
    // ancestor there would become its `position: fixed` containing block.
    expect(container.querySelector('.detent-sheet')).toBeNull();
    // It is a direct child of document.body instead.
    const sheet = document.body.querySelector('.detent-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.parentElement).toBe(document.body);
    // Content and footer still render through the portal.
    expect(screen.getByText('sheet body')).toBeInTheDocument();
    expect(screen.getByText('foot')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    renderWithProviders(
      <DetentSheet open={false} onClose={() => {}}>
        <p>hidden</p>
      </DetentSheet>,
    );
    expect(document.body.querySelector('.detent-sheet')).toBeNull();
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('its handle is a button a finger lands on (not a chip beside it), and a tap raises the card to full and lowers it to half', () => {
    renderWithProviders(
      <DetentSheet open onClose={() => {}}>
        <p>body</p>
      </DetentSheet>,
    );
    const sheet = document.body.querySelector('.detent-sheet')!;
    expect(sheet).toHaveAttribute('data-detent', 'half');
    fireEvent.click(screen.getByRole('button', { name: 'Raise the card' }));
    expect(sheet).toHaveAttribute('data-detent', 'full');
    fireEvent.click(screen.getByRole('button', { name: 'Lower the card' }));
    expect(sheet).toHaveAttribute('data-detent', 'half');
  });
});

describe('DetentSheet: a field a keyboard types into (SEARCH-1)', () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    scrolled.mockReset();
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      scrolled(this, arg);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  /** Focus moves to `el`, as a tap on it does (focusin bubbles to the card's contents). */
  const focus = (el: HTMLElement) => act(() => el.focus());

  const card = (open = true) => (
    <DetentSheet open={open} onClose={() => {}}>
      <input type="search" aria-label="Search makers" />
      <textarea aria-label="Note" />
      <button type="button">A chip</button>
    </DetentSheet>
  );

  it('raises the card to full and brings the field to the top of the contents, with room below it, above the keyboard', () => {
    renderWithProviders(card());
    const sheet = document.body.querySelector('.detent-sheet')!;
    expect(sheet).not.toHaveAttribute('data-keyboard');
    const box = screen.getByRole('searchbox', { name: 'Search makers' });
    focus(box);
    expect(sheet).toHaveAttribute('data-detent', 'full');
    expect(sheet).toHaveAttribute('data-keyboard');
    expect(scrolled).toHaveBeenCalledWith(box, { block: 'start' });
  });

  it('does the same for a text area, and again for each field that takes focus', () => {
    renderWithProviders(card());
    const note = screen.getByRole('textbox', { name: 'Note' });
    focus(note);
    focus(screen.getByRole('searchbox', { name: 'Search makers' }));
    focus(note);
    expect(scrolled.mock.calls.map(([el]) => (el as HTMLElement).getAttribute('aria-label'))).toEqual(['Note', 'Search makers', 'Note']);
  });

  it('leaves the card where it stands for a control no keyboard comes up for', () => {
    renderWithProviders(card());
    focus(screen.getByRole('button', { name: 'A chip' }));
    const sheet = document.body.querySelector('.detent-sheet')!;
    expect(sheet).toHaveAttribute('data-detent', 'half');
    expect(sheet).not.toHaveAttribute('data-keyboard');
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('keeps the room after the field lets go (nothing jumps under a finger), and opens again at half without it', () => {
    const { rerender } = renderWithProviders(card());
    const box = screen.getByRole('searchbox', { name: 'Search makers' });
    focus(box);
    act(() => box.blur());
    expect(document.body.querySelector('.detent-sheet')).toHaveAttribute('data-keyboard');
    rerender(card(false));
    rerender(card(true));
    const reopened = document.body.querySelector('.detent-sheet')!;
    expect(reopened).toHaveAttribute('data-detent', 'half');
    expect(reopened).not.toHaveAttribute('data-keyboard');
  });
});
