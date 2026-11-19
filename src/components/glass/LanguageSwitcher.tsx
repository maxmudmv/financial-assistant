import { Globe } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import type { SupportedLanguage } from '@/types/auth';
import { cn } from '@/lib/cn';

const LANGUAGES: Array<{ code: SupportedLanguage; short: string }> = [
  { code: 'uz', short: 'UZ' },
  { code: 'ru', short: 'RU' },
  { code: 'en', short: 'EN' },
];

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
      className="liquid-glass-pill inline-flex items-center gap-1 rounded-full p-1"
    >
      <Globe className="ml-2 mr-0.5 h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
      {LANGUAGES.map((item) => {
        const active = language === item.code;
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => {
              setLanguage(item.code);
              onChange?.(item.code);
            }}
            aria-pressed={active}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold transition-all',
              active
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
            )}
          >
            {item.short}
          </button>
        );
      })}
    </div>
  );
}
