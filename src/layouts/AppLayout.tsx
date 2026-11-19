import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  FileBarChart2,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  Settings,
  ShieldCheck,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/glass/LanguageSwitcher';
import { ThemeToggle } from '@/components/glass/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

const DOCK_LENS_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 26,
  mass: 0.82,
};

const LIQUID_TAP_SPRING = {
  type: 'spring' as const,
  stiffness: 480,
  damping: 17,
  mass: 0.65,
};

const SECONDARY_ROUTES = ['/accounts', '/transfers', '/planning', '/reports', '/ledger', '/settings'];

export function AppLayout({ children }: { children: ReactNode }) {
  const { status, activeWorkspace } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu sheet whenever navigation changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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

  // Exactly 4 clean primary tabs in the floating Apple Liquid Glass mobile dock
  const primaryMobileTabs = [
    { id: 'dashboard', to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'transactions', to: '/transactions', label: t.nav.transactions, icon: ListOrdered },
    { id: 'analytics', to: '/analytics', label: t.nav.analytics, icon: BarChart3 },
  ] as const;

  const secondaryMenuItems = [
    {
      to: '/accounts',
      label: t.nav.accounts,
      icon: Wallet,
      iconTone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    },
    {
      to: '/transfers',
      label: t.nav.transfers,
      icon: ArrowLeftRight,
      iconTone: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    },
    {
      to: '/planning',
      label: t.nav.planning,
      icon: Target,
      iconTone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    },
    {
      to: '/reports',
      label: t.nav.reports,
      icon: FileBarChart2,
      iconTone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    {
      to: '/ledger',
      label: t.nav.ledger,
      icon: BookOpenCheck,
      iconTone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    },
    {
      to: '/settings',
      label: t.nav.settings,
      icon: Settings,
      iconTone: 'bg-slate-500/15 text-slate-600 dark:text-zinc-300',
    },
  ];

  const isSecondaryRoute = SECONDARY_ROUTES.some((route) =>
    location.pathname.startsWith(route),
  );
  const activeMobileTabId =
    menuOpen || isSecondaryRoute
      ? 'more'
      : location.pathname.startsWith('/transactions')
        ? 'transactions'
        : location.pathname.startsWith('/analytics')
          ? 'analytics'
          : 'dashboard';

  return (
    <div className="finora-canvas flex min-h-[100dvh] flex-col">
      {/* Subtle restrained ambient depth orbs */}
      <div className="finora-ambient-orbs" aria-hidden="true">
        <span className="finora-orb finora-orb-1" />
        <span className="finora-orb finora-orb-2" />
      </div>

      {/* Compact Single-Row Liquid Glass Top Header */}
      <header className="sticky top-0 z-30 mx-auto w-full max-w-6xl px-3 pt-2.5 sm:px-4 sm:pt-3.5">
        <div className="liquid-glass-pill flex items-center justify-between gap-2 rounded-full px-2.5 py-1.5 sm:px-3.5 sm:py-2">
          <div className="flex min-w-0 items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={LIQUID_TAP_SPRING}
              onClick={() => {
                triggerHaptic('selection');
                navigate('/');
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-950"
              aria-label={t.app.name}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </motion.button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-extrabold tracking-wide text-slate-900 dark:text-white sm:text-sm">
                  {t.app.name}
                </span>
                {activeWorkspace && (
                  <span className="hidden truncate rounded-full bg-slate-900/10 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-white/10 dark:text-zinc-200 md:inline">
                    {activeWorkspace.name}
                  </span>
                )}
              </div>
              <p className="hidden text-[11px] text-slate-500 dark:text-zinc-400 xl:block">
                {t.app.tagline}
              </p>
            </div>
          </div>

          {status === 'authenticated' && (
            <nav className="hidden items-center gap-1 lg:flex">
              {desktopNav.map(({ to, label, icon: Icon }) => {
                const isActive =
                  to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => triggerHaptic('selection')}
                    className={cn(
                      'relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors',
                      isActive
                        ? 'text-white dark:text-slate-950'
                        : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="finora-desktop-lens"
                        transition={DOCK_LENS_SPRING}
                        className="liquid-glass-lens absolute inset-0 rounded-full"
                      />
                    )}
                    <Icon className="relative z-10 h-3.5 w-3.5" />
                    <span className="relative z-10">{label}</span>
                  </NavLink>
                );
              })}
            </nav>
          )}

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content with bottom clearance for the floating 4-tab Liquid Glass dock */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-28 pt-3.5 sm:px-4 sm:py-6 lg:pb-10">
        {children}
      </main>

      {/* Perfectly Centered Liquid Glass Floating "Menyu" Drawer Sheet (Mobile) */}
      <AnimatePresence>
        {status === 'authenticated' && menuOpen && (
          <>
            <motion.div
              key="finora-menu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:hidden"
            />

            <motion.div
              key="finora-menu-sheet"
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={DOCK_LENS_SPRING}
              className="fixed inset-x-3 bottom-[5.25rem] z-40 mx-auto max-w-md lg:hidden"
            >
              <div className="liquid-glass-dock rounded-[26px] p-3">
                <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-slate-400/45 dark:bg-white/20" />
                <div className="mb-2.5 flex items-center justify-between px-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300">
                      {t.nav.more}
                    </span>
                    {activeWorkspace && (
                      <span className="truncate rounded-full bg-slate-900/10 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-white/10 dark:text-zinc-200">
                        {activeWorkspace.name}
                      </span>
                    )}
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.86 }}
                    transition={LIQUID_TAP_SPRING}
                    onClick={() => {
                      triggerHaptic('light');
                      setMenuOpen(false);
                    }}
                    className="liquid-glass-pill flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-700 dark:text-zinc-200"
                    aria-label={t.common.close}
                  >
                    <X className="h-3.5 w-3.5" />
                  </motion.button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {secondaryMenuItems.map(({ to, label, icon: Icon, iconTone }) => {
                    const isCurrent = location.pathname.startsWith(to);
                    return (
                      <motion.button
                        key={to}
                        type="button"
                        whileTap={{ scaleX: 1.04, scaleY: 0.93 }}
                        transition={LIQUID_TAP_SPRING}
                        onClick={() => {
                          triggerHaptic('selection');
                          setMenuOpen(false);
                          navigate(to);
                        }}
                        className={cn(
                          'liquid-btn-glare relative flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-all',
                          isCurrent
                            ? 'liquid-glass-lens text-white dark:text-slate-950'
                            : 'liquid-glass-pill text-slate-800 hover:brightness-105 dark:text-zinc-100',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                            isCurrent
                              ? 'bg-white/20 text-white dark:bg-slate-950/15 dark:text-slate-950'
                              : iconTone,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="truncate text-xs font-bold">{label}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Floating 4-Tab Apple Liquid Glass Mobile Dock */}
      {status === 'authenticated' && (
        <nav
          aria-label="Primary mobile navigation"
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md lg:hidden"
        >
          <div className="liquid-glass-dock grid grid-cols-4 items-center gap-1 rounded-full p-1.5">
            {primaryMobileTabs.map(({ id, to, label, icon: Icon }) => {
              const isActive = activeMobileTabId === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileTap={{ scaleX: 1.08, scaleY: 0.88 }}
                  transition={LIQUID_TAP_SPRING}
                  onClick={() => {
                    triggerHaptic('selection');
                    setMenuOpen(false);
                    navigate(to);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-1.5 text-[11px] font-bold transition-colors',
                    isActive
                      ? 'text-white dark:text-slate-950'
                      : 'text-slate-600 dark:text-zinc-400',
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="finora-dock-lens"
                      transition={DOCK_LENS_SPRING}
                      className="liquid-glass-lens absolute inset-0 rounded-full"
                    />
                  )}
                  <motion.span
                    animate={{ scale: isActive ? 1.08 : 1, y: isActive ? -0.5 : 0 }}
                    transition={LIQUID_TAP_SPRING}
                    className="relative z-10"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </motion.span>
                  <span className="relative z-10 max-w-full truncate leading-tight">
                    {label}
                  </span>
                </motion.button>
              );
            })}

            {/* 4th Tab: Menyu */}
            <motion.button
              type="button"
              whileTap={{ scaleX: 1.08, scaleY: 0.88 }}
              transition={LIQUID_TAP_SPRING}
              onClick={() => {
                triggerHaptic('light');
                setMenuOpen((prev) => !prev);
              }}
              aria-expanded={menuOpen}
              className={cn(
                'relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-1.5 text-[11px] font-bold transition-colors',
                activeMobileTabId === 'more'
                  ? 'text-white dark:text-slate-950'
                  : 'text-slate-600 dark:text-zinc-400',
              )}
            >
              {activeMobileTabId === 'more' && (
                <motion.span
                  layoutId="finora-dock-lens"
                  transition={DOCK_LENS_SPRING}
                  className="liquid-glass-lens absolute inset-0 rounded-full"
                />
              )}
              <motion.span
                animate={{
                  scale: activeMobileTabId === 'more' ? 1.08 : 1,
                  rotate: menuOpen ? 90 : 0,
                  y: activeMobileTabId === 'more' ? -0.5 : 0,
                }}
                transition={LIQUID_TAP_SPRING}
                className="relative z-10"
              >
                {menuOpen ? (
                  <X className="h-[18px] w-[18px]" />
                ) : (
                  <LayoutGrid className="h-[18px] w-[18px]" />
                )}
              </motion.span>
              <span className="relative z-10 max-w-full truncate leading-tight">
                {t.nav.more}
              </span>
            </motion.button>
          </div>
        </nav>
      )}
    </div>
  );
}
