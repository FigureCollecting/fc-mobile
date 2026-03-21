interface HeaderProps {
  title: string;
  action?: preact.ComponentChildren;
}

export function Header({ title, action }: HeaderProps) {
  return (
    <header class="header">
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
        }

        .header__title {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          line-height: var(--line-height-tight);
        }

        .header__action {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
      `}</style>
    </header>
  );
}
