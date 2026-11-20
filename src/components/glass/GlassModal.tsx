import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { triggerHaptic } from '@/lib/telegram';

interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClass?: string;
}

const MODAL_SPRING = {
  type: 'spring' as const,
  stiffness: 390,
  damping: 30,
  mass: 0.85,
};

export function GlassModal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidthClass = 'max-w-md',
}: GlassModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-4">
          <motion.div
            key="glass-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            key="glass-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 28, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={MODAL_SPRING}
            className={`liquid-glass-dock relative z-10 flex max-h-[86dvh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-[26px]`}
          >
            {/* Drag handle + Sticky Header */}
            <div className="shrink-0 border-b border-slate-300/25 px-4 pb-3 pt-2.5 dark:border-white/10">
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-slate-400/45 dark:bg-white/25 sm:hidden" />
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    onClose();
                  }}
                  aria-label="Close"
                  className="liquid-glass-pill flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-600 dark:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-4 py-3.5">{children}</div>

            {/* Always-Visible Sticky Footer */}
            {footer && (
              <div className="shrink-0 border-t border-slate-300/25 px-4 py-3 dark:border-white/10">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
