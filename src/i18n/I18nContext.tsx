import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { uz } from './locales/uz';
import { ru } from './locales/ru';
import { en } from './locales/en';
import type { SupportedLanguage, TranslationDictionary } from './types';

const LANGUAGE_STORAGE_KEY = 'finora.language';

export const TRANSLATIONS: Record<SupportedLanguage, TranslationDictionary> = {
  uz,
  ru,
  en,
};

interface I18nContextValue {
  language: SupportedLanguage;
  t: TranslationDictionary;
  setLanguage: (lang: SupportedLanguage) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLanguage(): SupportedLanguage {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'uz' || saved === 'ru' || saved === 'en') {
      return saved;
    }
  } catch {
    // Storage unavailable in strict privacy contexts
  }
  return 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() =>
    typeof window !== 'undefined' ? readStoredLanguage() : 'uz',
  );

  const setLanguage = useCallback((nextLang: SupportedLanguage) => {
    setLanguageState(nextLang);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLang);
    } catch {
      // Ignore storage write errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: TRANSLATIONS[language],
      setLanguage,
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
