import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GlassBadgeProps {
  children: ReactNode;
  tone?: 'blue' | 'emerald' | 'violet' | 'amber' | 'neutral';
  className?: string;
}

const TONE_CLASSES = {
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  neutral: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-400/25',
};

export function GlassBadge({ children, tone = 'neutral', className }: GlassBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
