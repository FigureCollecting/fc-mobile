import { useState } from 'preact/hooks';
import { Style } from '../styles/Style';
import { recordBuild } from './storage';
import { NOTICE_CSS } from './UpdatePrompt';

/** Once a new build has replaced the last one run here (most often after Reload), names it, once. */
export function UpdatedNotice({ buildId = import.meta.env.VITE_BUILD_ID }: { buildId?: string }) {
  const [show, setShow] = useState(() => recordBuild(buildId));
  if (!show) return null;

  return (
    <div class="pwa-notice" role="status">
      <span class="pwa-notice__text">Updated to build {buildId}</span>
      <button class="pwa-notice__btn pwa-notice__btn--quiet" type="button" onClick={() => setShow(false)}>
        Dismiss
      </button>
      <Style css={NOTICE_CSS} />
    </div>
  );
}
