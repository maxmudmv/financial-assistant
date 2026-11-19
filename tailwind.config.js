/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        finora: {
          obsidian: '#05070E',
          navy: '#0A1022',
          electric: '#3B82F6',
          violet: '#7C3AED',
          emerald: '#10B981',
          frost: '#F5F7FC',
        },
      },
      borderRadius: {
        glass: '1.5rem',
        'glass-sm': '1rem',
      },
      boxShadow: {
        'glass-dark':
          '0 12px 40px -12px rgba(2, 6, 23, 0.72), inset 0 1px 0 0 rgba(255, 255, 255, 0.14)',
        'glass-light':
          '0 14px 36px -14px rgba(30, 41, 59, 0.14), inset 0 1px 0 0 rgba(255, 255, 255, 0.85)',
        'glow-blue': '0 0 28px -6px rgba(59, 130, 246, 0.45)',
        'glow-emerald': '0 0 28px -6px rgba(16, 185, 129, 0.4)',
      },
      backdropBlur: {
        xs: '4px',
        glass: '22px',
      },
    },
  },
  plugins: [],
};
