import { describe, expect, it } from 'vitest';
import { isIosBrowserTab } from '../platform';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';
const IPADOS_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

function env(userAgent: string, over: { maxTouchPoints?: number; standalone?: boolean; displayStandalone?: boolean } = {}) {
  return {
    navigator: { userAgent, maxTouchPoints: over.maxTouchPoints ?? 5, standalone: over.standalone },
    matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' && over.displayStandalone === true }),
  };
}

describe('isIosBrowserTab', () => {
  it('is true for an iPhone browser tab, Safari or not (every iOS browser is WebKit with tab storage)', () => {
    expect(isIosBrowserTab(env(IPHONE_SAFARI))).toBe(true);
    expect(isIosBrowserTab(env(IPHONE_CHROME))).toBe(true);
  });

  it('is true for iPadOS, which reports a desktop Mac user agent but has touch', () => {
    expect(isIosBrowserTab(env(IPADOS_DESKTOP, { maxTouchPoints: 5 }))).toBe(true);
    expect(isIosBrowserTab(env(IPADOS_DESKTOP, { maxTouchPoints: 0 }))).toBe(false);
  });

  it('is false once installed to the Home Screen', () => {
    expect(isIosBrowserTab(env(IPHONE_SAFARI, { standalone: true }))).toBe(false);
    expect(isIosBrowserTab(env(IPHONE_SAFARI, { displayStandalone: true }))).toBe(false);
  });

  it('is false off iOS', () => {
    expect(isIosBrowserTab(env(ANDROID))).toBe(false);
  });
});
