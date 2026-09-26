export interface PlatformEnv {
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean };
  matchMedia: (query: string) => { matches: boolean };
}

/**
 * An iOS/iPadOS browser tab, not the installed app. Every iOS browser is
 * WebKit, and a tab's storage is separate from the Home Screen app's and is
 * cleared after 7 days without a visit.
 */
export function isIosBrowserTab(env: PlatformEnv = { navigator, matchMedia: (q) => window.matchMedia(q) }): boolean {
  const { userAgent, maxTouchPoints, standalone } = env.navigator;
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  return standalone !== true && !env.matchMedia('(display-mode: standalone)').matches;
}
