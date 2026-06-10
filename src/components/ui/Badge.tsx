interface BadgeProps {
  count: number;
}

export function Badge({ count }: BadgeProps) {
  if (count <= 0) return null;

  const display = count > 9 ? '9+' : String(count);

  return (
    <span class="badge" aria-label={`${count} unread notifications`}>
      {display}

      <style>{`
        .badge {
          position: absolute;
          top: 2px;
          right: 2px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: var(--radius-full);
          background: var(--accent-danger);
          color: white;
          font-size: 0.625rem;
          font-weight: var(--font-weight-bold);
          line-height: 18px;
          text-align: center;
          pointer-events: none;
          z-index: 1;
        }
      `}</style>
    </span>
  );
}
