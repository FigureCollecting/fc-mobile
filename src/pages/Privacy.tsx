import { Link } from 'wouter';
import { PRIVACY, splitContact, type PrivacyBlock } from '../content/privacyText';
import { Style } from '../styles/Style';

/** A line of the text, each contact address in it a mail link. */
function Line({ text }: { text: string }) {
  return (
    <>
      {splitContact(text).map((piece) =>
        typeof piece === 'string' ? piece : <a href={`mailto:${piece.address}`}>{piece.address}</a>,
      )}
    </>
  );
}

function Block({ block }: { block: PrivacyBlock }) {
  if (block.kind === 'p') {
    return (
      <p>
        <Line text={block.text} />
      </p>
    );
  }
  return (
    <ul>
      {block.items.map((item) => (
        <li key={item}>
          <Line text={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * P1: how we use your data, src/content/privacy.md as written. It asks the server for nothing and needs no account.
 * `standalone` is the page opened by its address or from the onboarding (src/app.tsx): it fills the window, scrolls by
 * itself and links to the app. Without it the page is a screen of the app (AppShell), and Back returns to the last one.
 */
export function Privacy({ standalone = false }: { standalone?: boolean }) {
  // Alone it is the document's main content; in the app it stands inside AppShell's <main>.
  const Root = standalone ? 'main' : 'div';
  return (
    <Root class={standalone ? 'privacy privacy--standalone' : 'privacy'}>
      <nav class="privacy__nav" aria-label="Privacy page">
        {standalone ? (
          <Link class="privacy__back" href="/">
            Open FigureCollecting
          </Link>
        ) : (
          <button class="privacy__back" type="button" onClick={() => window.history.back()}>
            Back
          </button>
        )}
      </nav>
      <article class="privacy__text">
        <h1>{PRIVACY.title}</h1>
        {PRIVACY.intro.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        {PRIVACY.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </article>
      <Style css={styles} />
    </Root>
  );
}

const styles = `
  .privacy {
    min-height: 100%;
    background: var(--surface-primary);
    color: var(--text-primary);
    padding: var(--safe-area-top) var(--safe-area-right) 0 var(--safe-area-left);
  }

  .privacy--standalone {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: var(--safe-area-bottom);
  }

  .privacy__nav {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-3) var(--space-4) 0;
  }

  .privacy__back {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--surface-secondary);
    color: var(--text-primary);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
  }

  .privacy__text {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) var(--space-8);
    font-size: var(--font-base);
    line-height: var(--line-height-normal);
    overflow-wrap: break-word;
    user-select: text;
    -webkit-user-select: text;
  }

  .privacy__text h1 {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-tight);
  }

  .privacy__text h2 {
    margin-top: var(--space-6);
    font-size: var(--font-lg);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-tight);
  }

  .privacy__text p,
  .privacy__text ul {
    margin-top: var(--space-3);
  }

  .privacy__text h1 + p {
    color: var(--text-secondary);
    font-size: var(--font-sm);
  }

  .privacy__text ul {
    padding-left: var(--space-5);
  }

  .privacy__text li + li {
    margin-top: var(--space-2);
  }

  .privacy__text a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* On paper: the text alone, black on white, every sheet of it. The app's frame scrolls inside a window-high box,
     which would print one sheet, so while this page is up each of those boxes is as tall as what it holds. */
  @media print {
    html,
    body,
    #app,
    .app-shell,
    .app-content,
    .privacy {
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      position: static !important;
    }

    /* The route transition's box, between the app's frame and the page. */
    .animated-route {
      transform: none !important;
      animation: none !important;
    }

    body,
    .privacy {
      background: #fff !important;
      color: #000 !important;
    }

    .app-shell > :not(main),
    .sync-auth-banner,
    .sync-status-line,
    .pwa-notices,
    .toast-container,
    .privacy__nav {
      display: none !important;
    }

    .app-content,
    .privacy {
      padding: 0 !important;
    }

    .privacy__text {
      max-width: none;
      padding: 0;
      font-size: 11pt;
    }

    .privacy__text h1 + p,
    .privacy__text a {
      color: #000;
    }

    .privacy__text h2 {
      break-after: avoid;
    }

    .privacy__text p,
    .privacy__text li {
      break-inside: avoid;
    }
  }
`;
