import { motion } from 'framer-motion';

interface PageDotsProps {
  total: number;
  active: number;
  onDotClick?: (index: number) => void;
}

export function PageDots({ total, active, onDotClick }: PageDotsProps) {
  return (
    <div class="page-dots" role="tablist" aria-label="Page indicators">
      {Array.from({ length: total }, (_, i) => (
        <motion.button
          key={i}
          class="page-dots__dot"
          role="tab"
          aria-selected={i === active}
          aria-label={`Page ${i + 1}`}
          onClick={() => onDotClick?.(i)}
          animate={{
            width: i === active ? 24 : 8,
            backgroundColor: i === active
              ? 'var(--brand-500)'
              : 'var(--text-tertiary)',
            opacity: i === active ? 1 : 0.4,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      ))}

      <style>{`
        .page-dots {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          padding: var(--space-4) 0;
        }

        .page-dots__dot {
          height: 8px;
          border-radius: var(--radius-full);
          border: none;
          padding: 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
    </div>
  );
}
