// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, TRANSLATIONS, useI18n } from '../../src/i18n/I18nContext';
import { ThemeProvider, useTheme } from '../../src/contexts/ThemeContext';
import { formatMoney } from '../../src/i18n/formatters';

function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return collectLeafKeys(value as Record<string, unknown>, next);
    }
    return [next];
  });
}

function ProbeComponent() {
  const { language, setLanguage, t } = useI18n();
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="tagline">{t.app.tagline}</span>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button type="button" onClick={() => setLanguage('ru')}>
        switch-ru
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        switch-light
      </button>
    </div>
  );
}

describe('Multilingual (uz/ru/en) & Liquid Glass Theme Foundation', () => {
  it('maintains 100% translation key parity across Uzbek, Russian, and English', () => {
    const uzKeys = collectLeafKeys(TRANSLATIONS.uz as unknown as Record<string, unknown>).sort();
    const ruKeys = collectLeafKeys(TRANSLATIONS.ru as unknown as Record<string, unknown>).sort();
    const enKeys = collectLeafKeys(TRANSLATIONS.en as unknown as Record<string, unknown>).sort();

    expect(ruKeys).toEqual(uzKeys);
    expect(enKeys).toEqual(uzKeys);
    expect(uzKeys.length).toBeGreaterThan(25);
  });

  it('defaults to Uzbek and switches language & theme cleanly', () => {
    window.localStorage.clear();
    render(
      <I18nProvider>
        <ThemeProvider>
          <ProbeComponent />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId('lang').textContent).toBe('uz');
    expect(screen.getByTestId('tagline').textContent).toBe(TRANSLATIONS.uz.app.tagline);

    fireEvent.click(screen.getByText('switch-ru'));
    expect(screen.getByTestId('lang').textContent).toBe('ru');
    expect(screen.getByTestId('tagline').textContent).toBe(TRANSLATIONS.ru.app.tagline);

    fireEvent.click(screen.getByText('switch-light'));
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('resolved-theme').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('formats multi-currency amounts safely without floating-point errors', () => {
    const usd = formatMoney('1234.50', 'USD', 'en');
    expect(usd).toContain('1,234.50');
    const uzs = formatMoney('1500000', 'UZS', 'uz');
    expect(uzs).toMatch(/1[\s,.]500[\s,.]000/);
  });
});
