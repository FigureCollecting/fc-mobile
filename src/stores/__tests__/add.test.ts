import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeAdd, openAdd, useAddStore } from '../add';
import { localSession } from '../../local/session';
import { stubSessionStatus } from '../../test/sessionStatus';
import { setFixtureMode } from '../../dev-fixtures/fixtures';

// SIGNED-OUT-ADD: the Add sheet is for account holders. openAdd() is its one way in (the bar's +, a header's Add), so it
// refuses while signed out or while the session is still loading.
beforeEach(() => useAddStore.setState({ open: false, inHeader: 0 }));
afterEach(() => {
  localSession.value = undefined;
});

describe('openAdd', () => {
  it.each([
    ['no session yet', undefined],
    ['a loading session', 'loading'],
    ['signed out', 'signed-out'],
  ] as const)('is refused with %s', (_label, status) => {
    stubSessionStatus(status);
    openAdd();
    expect(useAddStore.getState().open).toBe(false);
  });

  it.each(['signed-in', 'offline', 'reauth-required', 'reload-required'] as const)('opens the sheet for an account holder (%s)', (status) => {
    stubSessionStatus(status);
    openAdd();
    expect(useAddStore.getState().open).toBe(true);
    closeAdd();
    expect(useAddStore.getState().open).toBe(false);
  });

  it('opens in dev fixture mode with no account', () => {
    setFixtureMode(true);
    stubSessionStatus('signed-out');
    openAdd();
    expect(useAddStore.getState().open).toBe(true);
  });
});
