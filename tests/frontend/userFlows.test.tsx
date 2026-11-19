// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { LanguageSwitcher } from '../../src/components/glass/LanguageSwitcher';
import { ThemeToggle } from '../../src/components/glass/ThemeToggle';

describe('Interactive UI regression tests (LanguageSwitcher & ThemeToggle)', () => {
  it('invokes onChange with the exact newly selected language (no stale closure)', () => {
    window.localStorage.clear();
    const onLanguageChange = vi.fn();

    render(
      <I18nProvider>
        <LanguageSwitcher onChange={onLanguageChange} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('EN'));
    expect(onLanguageChange).toHaveBeenCalledWith('en');

    fireEvent.click(screen.getByText('RU'));
    expect(onLanguageChange).toHaveBeenCalledWith('ru');
  });

  it('invokes onChange with the exact newly selected Liquid Glass theme', () => {
    window.localStorage.clear();
    const onThemeChange = vi.fn();

    render(
      <I18nProvider>
        <ThemeProvider>
          <ThemeToggle onChange={onThemeChange} />
        </ThemeProvider>
      </I18nProvider>,
    );

    // Click light button (uz label: "Kunduzgi")
    fireEvent.click(screen.getByRole('button', { name: 'Kunduzgi' }));
    expect(onThemeChange).toHaveBeenCalledWith('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Click dark button (uz label: "Tungi")
    fireEvent.click(screen.getByRole('button', { name: 'Tungi' }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
