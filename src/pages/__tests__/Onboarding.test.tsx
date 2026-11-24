import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

const auth = vi.hoisted(() => ({ signIn: vi.fn(async () => undefined) }));
vi.mock('../../auth', async () => {
  const { fakeAuthSession } = await import('../../test/appSession');
  const session = { ...fakeAuthSession('signed-out'), signIn: auth.signIn };
  return { getAuthSession: () => session };
});
vi.mock('../../sync/browser', async () => {
  const { fakeBrowserSync } = await import('../../test/appSession');
  const sync = await fakeBrowserSync();
  return { startBrowserSync: () => sync };
});

import { Onboarding } from '../Onboarding';
import { PRIVACY_LINK_LABEL } from '../../content/privacyText';
import { DIAG_IDS_TEXT } from '../../auth/diagIds';
import { LEGACY_SCREENS_ENABLED } from '../../config/features';
import { App } from '../../app';
import { renderWithProviders } from '../../test/testUtils';

describe('Onboarding page', () => {
  it('renders the first screen with a Skip button', () => {
    renderWithProviders(<Onboarding onComplete={() => {}} />, { initialPath: '/' });
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    expect(screen.getByText(/your collection, anywhere/i)).toBeInTheDocument();
  });

  // P1: the privacy page is one tap from every slide, the create-account one included, before any choice is made.
  it('links "How we use your data" to /privacy on every slide, without completing the onboarding', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const view = renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    expect(PRIVACY_LINK_LABEL).toBe(DIAG_IDS_TEXT.privacyLink);
    for (const dot of screen.getAllByRole('tab')) {
      await user.click(dot);
      const link = screen.getByRole('link', { name: PRIVACY_LINK_LABEL });
      expect(link).toHaveAttribute('href', '/privacy');
      expect(document.querySelectorAll('a[href="/privacy"]')).toHaveLength(1);
    }
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: PRIVACY_LINK_LABEL }));
    expect(view.currentPath()).toBe('/privacy');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('calls onComplete("guest") when Skip is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onComplete).toHaveBeenCalledWith('guest');
  });

  it('advances through screens when dot indicators are clicked and lands on CTA buttons', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    // PageDots renders 4 dot buttons; jump to the last (index 3).
    const dots = screen.getAllByRole('tab');
    expect(dots.length).toBeGreaterThanOrEqual(4);
    await user.click(dots[3]);
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('answers Create Account with the invitation note and the Sign In it offers, starting nothing', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    await user.click(screen.getAllByRole('tab')[3]!);
    const create = await screen.findByRole('button', { name: /create account/i });
    expect(create).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/accounts are by invitation/i)).not.toBeInTheDocument();

    await user.click(create);
    expect(onComplete).not.toHaveBeenCalled();
    expect(create).toHaveAttribute('aria-expanded', 'true');
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Accounts are by invitation. If you have an invitation link, open it to create your account.');
    expect(create.getAttribute('aria-controls')).toBe(note.id);

    // A second tap keeps the note: it is an answer, not a toggle that could hide it again.
    await user.click(create);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onComplete).toHaveBeenCalledWith('login');
  });

  it('routes to login when Sign In is chosen on the last screen', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    const dots = screen.getAllByRole('tab');
    await user.click(dots[3]);
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));
    expect(onComplete).toHaveBeenCalledWith('login');
  });

  it('routes to "guest" via the Browse as Guest button on the last screen', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<Onboarding onComplete={onComplete} />, { initialPath: '/' });
    const dots = screen.getAllByRole('tab');
    await user.click(dots[3]);
    await user.click(await screen.findByRole('button', { name: /browse as guest/i }));
    expect(onComplete).toHaveBeenCalledWith('guest');
  });

  it('is not shown once completed, and its Sign In starts the Authentik sign-in', async () => {
    localStorage.setItem('onboarding_complete', '1');
    const first = renderWithProviders(<App />, { initialPath: '/' });
    expect(screen.queryByText(/your collection, anywhere/i)).not.toBeInTheDocument();
    first.unmount();

    localStorage.removeItem('onboarding_complete');
    auth.signIn.mockClear();
    const user = userEvent.setup();
    const view = renderWithProviders(<App />, { initialPath: '/discover' });
    await user.click(screen.getAllByRole('tab')[3]!);
    await user.click(await screen.findByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('/'));
    expect(view.currentPath()).toBe('/');
    expect(localStorage.getItem('onboarding_complete')).toBe('1');
    view.unmount();
  });

  it('starts no sign-in from Create Account, where Authentik has no sign-up, and stays on the onboarding', async () => {
    localStorage.removeItem('onboarding_complete');
    auth.signIn.mockClear();
    const user = userEvent.setup();
    const view = renderWithProviders(<App />, { initialPath: '/discover' });
    await user.click(screen.getAllByRole('tab')[3]!);
    await user.click(await screen.findByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/accounts are by invitation/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding_complete')).toBeNull();
    expect(view.currentPath()).toBe('/discover');
    view.unmount();
  });

  describe('claims', () => {
    // With VITE_ENABLE_LEGACY_SCREENS unset, these features are off or redirect to the collection
    // (src/config/features.ts), so no slide may promise them. "export from MFC" is fine: that is MFC's export.
    const GATED = /price|alert|notif|push|export (your|to|as)|calendar|analytics|DNA|watchlist|automatic|\bfree\b|worldwide|\d+\+ sites/i;

    async function slideTexts() {
      const user = userEvent.setup();
      renderWithProviders(<Onboarding onComplete={() => {}} />, { initialPath: '/' });
      const texts: string[] = [];
      const dots = screen.getAllByRole('tab');
      for (const dot of dots) {
        await user.click(dot);
        await waitFor(() => expect(dot).toHaveAttribute('aria-selected', 'true'));
        texts.push(screen.getAllByRole('heading', { level: 1 }).map((h) => `${h.textContent} ${h.nextElementSibling?.textContent ?? ''}`).join(' '));
      }
      return texts;
    }

    it('promises no feature that is off with the legacy screens flag unset', async () => {
      expect(LEGACY_SCREENS_ENABLED).toBe(false);
      const texts = await slideTexts();
      expect(texts).toHaveLength(4);
      for (const text of texts) expect(text).not.toMatch(GATED);
    });

    it('describes what the live app does: search and barcode lookup, and importing an MFC export', async () => {
      const [, search, mfc] = await slideTexts();
      expect(search).toMatch(/search/i);
      expect(search).toMatch(/barcode/i);
      expect(mfc).toMatch(/import/i);
      expect(mfc).toMatch(/export/i);
    });
  });
});
