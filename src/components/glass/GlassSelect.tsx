import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

export interface GlassSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface GlassSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const SHEET_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.85,
};

const TAP_SPRING = {
  type: 'spring' as const,
  stiffness: 480,
  damping: 18,
};

export function GlassSelect({
  value,
  onChange,
  options,
  placeholder = '—',
  label,
  disabled = false,
  className,
  ariaLabel,
}: GlassSelectProps) {
  const [open, setOpen] = useState(false);

  const selected = options.find((opt) => opt.value === value);
  const displayText = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sheetPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {open && (
              <div className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center">
                <motion.div
                  key="glass-select-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setOpen(false)}
                  className="fixed inset-0 bg-black/55 backdrop-blur-sm"
                />

                <motion.div
                  key="glass-select-sheet"
                  role="listbox"
                  aria-label={ariaLabel ?? label ?? placeholder}
                  initial={{ opacity: 0, y: 28, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.96 }}
                  transition={SHEET_SPRING}
                  className="liquid-glass-dock relative z-10 flex max-h-[72dvh] w-full max-w-md flex-col overflow-hidden rounded-[26px] p-3"
                >
                  {/* Top drag indicator */}
                  <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-slate-400/50 dark:bg-white/25" />

                  <div className="mb-2 flex items-center justify-between px-2">
                    <span className="truncate text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                      {label ?? ariaLabel ?? placeholder}
                    </span>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.86 }}
                      transition={TAP_SPRING}
                      onClick={() => {
                        triggerHaptic('light');
                        setOpen(false);
                      }}
                      className="liquid-glass-pill flex h-7 w-7 items-center justify-center rounded-full text-slate-700 dark:text-zinc-200"
                      aria-label="Close"
                    >
                      <X className="h-3.5 w-3.5" />
                    </motion.button>
                  </div>

                  <div className="flex flex-col gap-1 overflow-y-auto px-0.5 pb-1">
                    {options.map((opt) => {
                      const isSelected = opt.value === value;
                      return (
                        <motion.button
                          key={`${opt.value}-${opt.label}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={opt.disabled}
                          whileTap={opt.disabled ? undefined : { scaleX: 1.02, scaleY: 0.95 }}
                          transition={TAP_SPRING}
                          onClick={() => {
                            if (opt.disabled) return;
                            triggerHaptic('selection');
                            onChange(opt.value);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold transition-colors disabled:opacity-40',
                            isSelected
                              ? 'liquid-glass-lens text-white dark:text-slate-950'
                              : 'text-slate-800 hover:bg-slate-900/5 dark:text-zinc-100 dark:hover:bg-white/10',
                          )}
                        >
                          <span className="truncate">{opt.label}</span>
                          {isSelected && <Check className="h-4 w-4 shrink-0" />}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <>
      <motion.button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        whileTap={disabled ? undefined : { scaleX: 1.02, scaleY: 0.96 }}
        transition={TAP_SPRING}
        onClick={() => {
          if (disabled) return;
          triggerHaptic('light');
          setOpen(true);
        }}
        className={cn(
          'liquid-glass-input flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium disabled:opacity-50 sm:text-sm',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-slate-400 dark:text-zinc-400')}>
          {displayText}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200 dark:text-zinc-400',
            open && 'rotate-180',
          )}
        />
      </motion.button>
      {sheetPortal}
    </>
  );
}
