interface HeaderProps {
  title: string;
  /** Content rendered before the title (e.g. back button) */
  leading?: preact.ComponentChildren;
  /** Content rendered after the title (e.g. gear icon, action buttons) */
  action?: preact.ComponentChildren;
}

export function Header({ title, leading, action }: HeaderProps) {
  return (
    <header class="header">
      {leading && <div class="header__leading">{leading}</div>}
      <h1 class="header__title">{title}</h1>
      {action && <div class="header__action">{action}</div>}

      <style>{`
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: var(--header-height);
          padding: 0 var(--space-4);
          padding-top: var(--safe-area-top);
          background-color: var(--surface-primary);
          position: sticky;
          top: 0;
          z-index: 10;
          gap: var(--space-1);
        }

        .header__leading {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        /* Chrome diet: headers carry context, not page titles — small and muted. */
        .header__title {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          line-height: var(--line-height-ui);
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .header__action {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }
      `}</style>
    </header>
  );
}
