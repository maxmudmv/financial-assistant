import type { ButtonHTMLAttributes, PointerEvent, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

type SafeButtonAttributes = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'
>;

interface GlassButtonProps extends SafeButtonAttributes {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const VARIANT_CLASSES = {
  primary: 'liquid-glass-btn-primary hover:brightness-110',
  secondary:
    'liquid-glass-pill text-slate-900 dark:text-slate-100 hover:border-white/70 dark:hover:border-white/40',
  ghost:
    'bg-transparent text-slate-700 dark:text-slate-200 hover:bg-white/25 dark:hover:bg-white/10',
  danger:
    'bg-rose-500/18 border border-rose-400/45 text-rose-600 dark:text-rose-200 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)] hover:bg-rose-500/28',
};

const SIZE_CLASSES = {
  sm: 'px-3.5 py-1.5 text-xs rounded-full',
  md: 'px-4 py-2.5 text-sm rounded-2xl',
  lg: 'px-5 py-3.5 text-sm font-semibold rounded-2xl',
};

const LIQUID_SPRING = {
  type: 'spring' as const,
  stiffness: 460,
  damping: 17,
  mass: 0.68,
};

export function GlassButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  type = 'button',
  onPointerMove,
  onPointerDown,
  ...props
}: GlassButtonProps) {
  function updateGlarePosition(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    event.currentTarget.style.setProperty('--gx', `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty('--gy', `${y.toFixed(1)}%`);
  }

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.025, y: -1 }}
      whileTap={disabled ? undefined : { scaleX: 1.055, scaleY: 0.91, y: 0.5 }}
      transition={LIQUID_SPRING}
      onPointerMove={(event) => {
        updateGlarePosition(event);
        onPointerMove?.(event);
      }}
      onPointerDown={(event) => {
        updateGlarePosition(event);
        if (!disabled) {
          triggerHaptic('light');
        }
        onPointerDown?.(event);
      }}
      className={cn(
        'liquid-btn-glare inline-flex select-none items-center justify-center gap-2 font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
}
