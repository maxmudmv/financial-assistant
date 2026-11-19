import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  FileBarChart2,
  LayoutDashboard,
  ListOrdered,
  Settings,
  ShieldCheck,
  Target,
  Wallet,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/glass/LanguageSwitcher';
import { ThemeToggle } from '@/components/glass/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { cn } from '@/lib/cn';

export function AppLayout({ children }: { children: ReactNode }) {
  const { status, activeWorkspace } = useAuth();
  const { t } = useI18n();

  const desktopNav = [
    { to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
    { to: '/accounts', label: t.nav.accounts, icon: Wallet },
    { to: '/transactions', label: t.nav.transactions, icon: ListOrdered },
    { to: '/analytics', label: t.nav.analytics, icon: BarChart3 },
    { to: '/planning', label: t.nav.planning, icon: Target },
    { to: '/reports', label: t.nav.reports, icon: FileBarChart2 },
    { to: '/transfers', label: t.nav.transfers, icon: ArrowLeftRight },
    { to: '/settings', label: t.nav.settings, icon: Settings },
  ];

  // Primary floating Apple Liquid Glass tab bar on mobile
  const mobileNav = [
    { to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
    { to: '/accounts', label: t.nav.accounts, icon: Wallet },
    { to: '/transactions', label: t.nav.transactions, icon: ListOrdered },
    { to: '/analytics', label: t.nav.analytics, icon: BarChart3 },
    { to: '/planning', label: t.nav.planning, icon: Target },
    { to: '/reports', label: t.nav.reports, icon: FileBarChart2 },
    { to: '/settings', label: t.nav.settings, icon: Settings },
  ];

  return (
    <div className="finora-canvas flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="liquid-glass-pill flex flex-wrap items-center justify-between gap-2 rounded-full px-3.5 py-2 sm:px-4 sm:py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-violet-500 to-emerald-400 text-white shadow-glow-blue">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                  {t.app.name}
                </span>
                {activeWorkspace && (
                  <span className="hidden rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-300 sm:inline">
                    {activeWorkspace.name}
                  </span>
                )}
              </div>
              <p className="hidden text-[11px] text-slate-500 dark:text-slate-400 xl:block">
                {t.app.tagline}
              </p>
            </div>
          </div>

          {status === 'authenticated' && (
            <nav className="hidden items-center gap-1 lg:flex">
              {desktopNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all',
                      isActive
                        ? 'bg-gradient-to-r from-blue-500 to-violet-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white/10 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 py-5 sm:px-4 sm:py-8">
        {children}
      </main>

      {/* Floating Mobile Liquid Glass Tab Bar */}
      {status === 'authenticated' && (
        <nav className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 lg:hidden">
          <div className="liquid-glass flex items-center justify-around rounded-full px-1.5 py-1.5">
            {mobileNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative z-10 flex flex-col items-center gap-0.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold transition-all',
                    isActive
                      ? 'bg-gradient-to-tr from-blue-500 to-violet-600 text-white shadow-glow-blue'
                      : 'text-slate-600 dark:text-slate-300',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
