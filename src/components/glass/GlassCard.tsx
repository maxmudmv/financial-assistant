import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export function GlassCard({
  children,
  className,
  padding = 'md',
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'liquid-glass rounded-glass overflow-hidden',
        PADDING_MAP[padding],
        className,
      )}
      {...props}
    >
      <div className="relative z-10">{children}</div>
    </div>
  );
}
