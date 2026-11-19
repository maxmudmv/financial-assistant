import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const PADDING_MAP = {
  none: '',
  sm: 'p-3.5',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

export function GlassCard({
  children,
  className,
  padding = 'md',
  interactive = false,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'liquid-glass overflow-hidden rounded-[22px]',
        interactive && 'cursor-pointer hover:-translate-y-0.5 active:scale-[0.985]',
        PADDING_MAP[padding],
        className,
      )}
      {...props}
    >
      <div className="relative z-10">{children}</div>
    </div>
  );
}
