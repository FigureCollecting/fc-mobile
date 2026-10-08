import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const auth = vi.hoisted(() => ({ getAuthSession: vi.fn() }));
vi.mock('../auth', () => auth);

import { App } from '../app';
import { renderWithProviders } from '../test/testUtils';
import { setFixtureMode } from '../dev-fixtures/fixtures';

describe('dev fixture mode', () => {
  it('lands on the collection with no onboarding, no session and no sign-in prompt', async () => {
    // localStorage 'on' makes isFixtureMode() true even under MODE=test.
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<App />, { initialPath: '/' });
    await waitFor(() => expect(screen.getAllByText(/collection/i).length).toBeGreaterThan(0));
    expect(currentPath()).toBe('/');
    await new Promise((r) => setTimeout(r, 20));
    expect(auth.getAuthSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });
});
