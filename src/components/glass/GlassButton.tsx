import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const VARIANT_CLASSES = {
  primary:
    'bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 text-white shadow-glow-blue hover:brightness-110 active:scale-[0.98]',
  secondary:
    'liquid-glass-pill text-slate-900 dark:text-slate-100 hover:border-blue-400/50 active:scale-[0.98]',
  ghost:
    'bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-900/5 dark:hover:bg-white/10 active:scale-[0.98]',
  danger:
    'bg-rose-500/15 border border-rose-500/35 text-rose-600 dark:text-rose-300 hover:bg-rose-500/25 active:scale-[0.98]',
};

const SIZE_CLASSES = {
  sm: 'px-3 py-1.5 text-xs rounded-xl',
  md: 'px-4 py-2.5 text-sm rounded-2xl',
  lg: 'px-5 py-3.5 text-sm font-semibold rounded-2xl',
};

export function GlassButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  ...props
}: GlassButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:opacity-50 disabled:pointer-events-none',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
