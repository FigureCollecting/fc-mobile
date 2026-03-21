import { motion, AnimatePresence } from 'framer-motion';
import { toasts, dismissToast } from '../../stores/toast';
import type { ToastMessage } from '../../stores/toast';

function ToastItem({ toast }: { toast: ToastMessage }) {
  const bgColor =
    toast.type === 'error'
      ? 'var(--accent-danger)'
      : toast.type === 'success'
        ? 'var(--accent-success)'
        : 'var(--surface-elevated, #333)';

  return (
    <motion.div
      class="toast-item"
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      style={{ background: bgColor }}
      onClick={() => dismissToast(toast.id)}
    >
      {toast.message}
    </motion.div>
  );
}

export function ToastContainer() {
  const items = toasts.value;

  return (
    <div class="toast-container">
      <AnimatePresence>
        {items.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>

      <style>{`
        .toast-container {
          position: fixed;
          bottom: calc(var(--bottom-nav-height, 64px) + var(--safe-area-bottom, 0px) + var(--space-3, 12px));
          left: var(--space-4, 16px);
          right: var(--space-4, 16px);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 8px);
          pointer-events: none;
        }

        .toast-item {
          padding: var(--space-3, 12px) var(--space-4, 16px);
          border-radius: var(--radius-lg, 12px);
          color: #fff;
          font-size: var(--font-sm, 14px);
          font-weight: var(--font-weight-medium, 500);
          line-height: var(--line-height-normal, 1.5);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          pointer-events: auto;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
    </div>
  );
}
