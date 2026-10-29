import { describe, it, expect, vi, beforeEach } from 'vitest';
import { offerJog, useJogStore, type JogTarget } from '../jog';

const target = (): JogTarget => ({ start: vi.fn(() => true), aim: vi.fn(), stop: vi.fn() });

beforeEach(() => useJogStore.setState({ target: null }));

describe('the jog store (NAV-JOG): what the bottom-centre button drives', () => {
  it('nothing offered: no target', () => {
    expect(useJogStore.getState().target).toBeNull();
  });

  it('an offer stands until its own withdrawal; a later offer replaces it and an earlier withdrawal leaves the later one', () => {
    const a = target();
    const b = target();
    const withdrawA = offerJog(a);
    expect(useJogStore.getState().target).toBe(a);
    const withdrawB = offerJog(b);
    expect(useJogStore.getState().target).toBe(b);
    withdrawA();
    expect(useJogStore.getState().target).toBe(b);
    withdrawB();
    expect(useJogStore.getState().target).toBeNull();
  });
});
