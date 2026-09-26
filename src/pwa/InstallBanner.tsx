import { useEffect, useState } from 'preact/hooks';
import { Style } from '../styles/Style';
import { NOTICE_CSS } from './UpdatePrompt';
import { isIosBrowserTab } from './platform';

const DISMISSED_KEY = 'fc-install-banner-dismissed';

interface Props {
  /** Edits queued in this tab and not yet on the server. */
  unsyncedCount: () => Promise<number>;
  isIosTab?: () => boolean;
  pollMs?: number;
}

/**
 * iOS keeps a tab's storage apart from the installed app's, so it asks for the
 * install before sign-in. While this tab holds unsynced edits the steps are
 * withheld: installing would strand them here.
 */
export function InstallBanner({ unsyncedCount, isIosTab = isIosBrowserTab, pollMs = 15_000 }: Props) {
  const [show] = useState(() => isIosTab() && sessionStorage.getItem(DISMISSED_KEY) === null);
  const [dismissed, setDismissed] = useState(false);
  const [unsynced, setUnsynced] = useState<number | null>(null);

  useEffect(() => {
    if (!show) return;
    let live = true;
    const read = () =>
      unsyncedCount().then(
        (n) => live && setUnsynced(n),
        () => live && setUnsynced(0),
      );
    void read();
    const id = setInterval(() => void read(), pollMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [show, unsyncedCount, pollMs]);

  if (!show || dismissed || unsynced === null) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  return (
    <div class="pwa-notice pwa-notice--install" role="note">
      <div class="pwa-notice__text">
        <strong class="pwa-notice__title">Install to keep offline data</strong>
        {unsynced > 0 ? (
          <p class="pwa-notice__body">
            {unsynced === 1 ? '1 edit in this tab is' : `${unsynced} edits in this tab are`} waiting to sync. Keep
            this tab until {unsynced === 1 ? 'it syncs' : 'they sync'}; the installed app re-syncs from the server, not
            from this tab.
          </p>
        ) : (
          <p class="pwa-notice__body">
            iOS clears data saved in a browser tab after 7 days without a visit. Tap Share, then Add to Home Screen.
          </p>
        )}
      </div>
      <button class="pwa-notice__btn pwa-notice__btn--quiet" type="button" onClick={dismiss}>
        Not now
      </button>
      <Style css={NOTICE_CSS} />
      <Style css={INSTALL_CSS} />
    </div>
  );
}

// In the flow of the app shell (a flex column): the screen below shrinks and scrolls.
const INSTALL_CSS = `
  .pwa-notice--install {
    flex-shrink: 0;
    margin: var(--space-3) var(--space-3) 0;
    box-shadow: none;
  }
`;
