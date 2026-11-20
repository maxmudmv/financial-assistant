import { motion } from 'framer-motion';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/i18n/I18nContext';
import type { ThemePreference } from '@/types/auth';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

const OPTIONS: Array<{ value: ThemePreference; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

const LENS_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 26,
  mass: 0.75,
};

export function ThemeToggle({
  onChange,
}: {
  onChange?: (theme: ThemePreference) => void;
} = {}) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t.theme.label}
      className="liquid-glass-pill inline-flex items-center gap-0.5 rounded-full p-1"
    >
      {OPTIONS.map(({ value, icon: Icon }) => {
        const active = theme === value;
        return (
          <motion.button
            key={value}
            type="button"
            title={t.theme[value]}
            aria-label={t.theme[value]}
            aria-pressed={active}
            whileTap={{ scaleX: 1.12, scaleY: 0.86 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            onClick={() => {
              triggerHaptic('selection');
              setTheme(value);
              onChange?.(value);
            }}
            className={cn(
              'relative rounded-full p-1.5 transition-colors',
              active
                ? 'text-slate-950 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
            )}
          >
            {active && (
              <motion.span
                layoutId="finora-theme-lens"
                transition={LENS_SPRING}
                className="liquid-glass-lens absolute inset-0 rounded-full"
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5" />
          </motion.button>
        );
      })}
    </div>
  );
}
