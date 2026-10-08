// preact/hooks flushes effects after paint. A render late in a test file leaves that flush pending,
// and vitest's jsdom teardown deletes the window globals (requestAnimationFrame and
// cancelAnimationFrame) before it runs. The flush must not need them then: when it did, it threw
// 'ReferenceError: cancelAnimationFrame is not defined' after the file and the run exited 1 with
// every test passed. src/test/setup.ts gives preact a scheduler that survives the teardown.
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { useEffect } from 'preact/hooks';

const FRAME_GLOBALS = ['requestAnimationFrame', 'cancelAnimationFrame'] as const;

describe('the after-paint flush across jsdom teardown', () => {
  it('runs a pending effect after the window frame globals are gone, without throwing', async () => {
    let ran = false;
    function Painted() {
      useEffect(() => {
        ran = true;
      }, []);
      return null;
    }
    const root = document.createElement('div');
    // Outside act: preact schedules its after-paint flush, as an update after a test's last await does.
    render(h(Painted, null), root);
    const saved = FRAME_GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
    // What the environment teardown does to the window keys it installed.
    for (const k of FRAME_GLOBALS) delete (globalThis as Record<string, unknown>)[k];
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(ran).toBe(true);
    } finally {
      for (const [k, d] of saved) if (d !== undefined) Object.defineProperty(globalThis, k, d);
      render(null, root);
    }
  });
});
