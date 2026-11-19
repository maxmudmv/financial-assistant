import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/i18n/I18nContext';
import type { ThemePreference } from '@/types/auth';
import { cn } from '@/lib/cn';

const OPTIONS: Array<{ value: ThemePreference; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

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
      className="liquid-glass-pill inline-flex items-center gap-1 rounded-full p-1"
    >
      {OPTIONS.map(({ value, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            title={t.theme[value]}
            aria-label={t.theme[value]}
            aria-pressed={active}
            onClick={() => {
              setTheme(value);
              onChange?.(value);
            }}
            className={cn(
              'rounded-full p-1.5 transition-all',
              active
                ? 'bg-gradient-to-tr from-blue-500 to-violet-500 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
