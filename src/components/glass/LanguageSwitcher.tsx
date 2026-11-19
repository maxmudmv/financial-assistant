import { motion } from 'framer-motion';
import { Globe } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import type { SupportedLanguage } from '@/types/auth';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

const LANGUAGES: Array<{ code: SupportedLanguage; short: string }> = [
  { code: 'uz', short: 'UZ' },
  { code: 'ru', short: 'RU' },
  { code: 'en', short: 'EN' },
];

const LENS_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 26,
  mass: 0.75,
};

export function LanguageSwitcher({
  onChange,
}: {
  onChange?: (lang: SupportedLanguage) => void;
} = {}) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t.language.label}
      className="liquid-glass-pill inline-flex items-center gap-0.5 rounded-full p-1"
    >
      <Globe className="ml-1.5 mr-0.5 hidden h-3.5 w-3.5 text-slate-600 dark:text-slate-300 sm:block" />
      {LANGUAGES.map((item) => {
        const active = language === item.code;
        return (
          <motion.button
            key={item.code}
            type="button"
            whileTap={{ scaleX: 1.09, scaleY: 0.88 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            onClick={() => {
              triggerHaptic('selection');
              setLanguage(item.code);
              onChange?.(item.code);
            }}
            aria-pressed={active}
            className={cn(
              'relative rounded-full px-2 py-1 text-[11px] font-bold transition-colors sm:px-2.5 sm:text-xs',
              active
                ? 'text-blue-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
            )}
          >
            {active && (
              <motion.span
                layoutId="finora-lang-lens"
                transition={LENS_SPRING}
                className="liquid-glass-lens absolute inset-0 rounded-full"
              />
            )}
            <span className="relative z-10">{item.short}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
