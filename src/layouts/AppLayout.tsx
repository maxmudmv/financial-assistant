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
  stiffness: 380,
  damping: 24,
  mass: 0.85,
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

  // Exactly 4 primary tabs in the floating Apple Liquid Glass mobile dock
  const primaryMobileTabs = [
    { id: 'dashboard', to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'transactions', to: '/transactions', label: t.nav.transactions, icon: ListOrdered },
    { id: 'analytics', to: '/analytics', label: t.nav.analytics, icon: BarChart3 },
  ] as const;

  const secondaryMenuItems = [
    { to: '/accounts', label: t.nav.accounts, icon: Wallet, accent: 'from-sky-400 to-blue-600' },
    {
      to: '/transfers',
      label: t.nav.transfers,
      icon: ArrowLeftRight,
      accent: 'from-cyan-400 to-teal-500',
    },
    { to: '/planning', label: t.nav.planning, icon: Target, accent: 'from-violet-400 to-indigo-600' },
    {
      to: '/reports',
      label: t.nav.reports,
      icon: FileBarChart2,
      accent: 'from-emerald-400 to-teal-600',
    },
    { to: '/ledger', label: t.nav.ledger, icon: BookOpenCheck, accent: 'from-amber-400 to-orange-500' },
    {
      to: '/settings',
      label: t.nav.settings,
      icon: Settings,
      accent: 'from-slate-400 to-slate-600',
    },
  ];

  const isSecondaryRoute = SECONDARY_ROUTES.some((route) =>
    location.pathname.startsWith(route),
  );
  const activeMobileTabId = menuOpen || isSecondaryRoute
    ? 'more'
    : location.pathname.startsWith('/transactions')
      ? 'transactions'
      : location.pathname.startsWith('/analytics')
        ? 'analytics'
        : 'dashboard';

  return (
    <div className="finora-canvas flex min-h-[100dvh] flex-col">
      {/* Ambient floating light orbs for real optical glass refraction */}
      <div className="finora-ambient-orbs" aria-hidden="true">
        <span className="finora-orb finora-orb-1" />
        <span className="finora-orb finora-orb-2" />
        <span className="finora-orb finora-orb-3" />
      </div>

      {/* Sleek Single-Row Liquid Glass Top Header */}
      <header className="sticky top-0 z-30 mx-auto w-full max-w-6xl px-3 pt-2.5 sm:px-4 sm:pt-4">
        <div className="liquid-glass-pill flex items-center justify-between gap-2 rounded-full px-3 py-1.5 sm:px-4 sm:py-2">
          <div className="flex min-w-0 items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={LIQUID_TAP_SPRING}
              onClick={() => {
                triggerHaptic('selection');
                navigate('/');
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-violet-600 text-white shadow-[0_6px_16px_-4px_rgba(59,130,246,0.65),inset_0_1.5px_1px_rgba(255,255,255,0.65)]"
              aria-label={t.app.name}
            >
              <ShieldCheck className="h-4 w-4" />
            </motion.button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                  {t.app.name}
                </span>
                {activeWorkspace && (
                  <span className="hidden truncate rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-sky-300 md:inline">
                    {activeWorkspace.name}
                  </span>
                )}
              </div>
              <p className="hidden text-[11px] text-slate-600 dark:text-slate-300 xl:block">
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
                        ? 'text-blue-700 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
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
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-28 pt-4 sm:px-4 sm:py-7 lg:pb-10">
        {children}
      </main>

      {/* Liquid Glass Floating "Menyu" Drawer Sheet (Mobile) */}
      <AnimatePresence>
        {status === 'authenticated' && menuOpen && (
          <>
            <motion.div
              key="finora-menu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-sm lg:hidden"
            />

            <motion.div
              key="finora-menu-sheet"
              initial={{ opacity: 0, y: 28, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.94 }}
              transition={DOCK_LENS_SPRING}
              className="fixed bottom-[5.4rem] left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 lg:hidden"
            >
              <div className="liquid-glass-dock rounded-[30px] p-3.5">
                <div className="mb-2.5 flex items-center justify-between px-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      {t.nav.more}
                    </span>
                    {activeWorkspace && (
                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-sky-300">
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
                    className="liquid-glass-pill flex h-7 w-7 items-center justify-center rounded-full text-slate-700 dark:text-slate-200"
                    aria-label={t.common.close}
                  >
                    <X className="h-3.5 w-3.5" />
                  </motion.button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {secondaryMenuItems.map(({ to, label, icon: Icon, accent }) => {
                    const isCurrent = location.pathname.startsWith(to);
                    return (
                      <motion.button
                        key={to}
                        type="button"
                        whileTap={{ scaleX: 1.045, scaleY: 0.92 }}
                        transition={LIQUID_TAP_SPRING}
                        onClick={() => {
                          triggerHaptic('selection');
                          setMenuOpen(false);
                          navigate(to);
                        }}
                        className={cn(
                          'liquid-btn-glare relative flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left transition-all',
                          isCurrent
                            ? 'liquid-glass-lens text-blue-800 dark:text-white'
                            : 'liquid-glass-pill text-slate-800 hover:brightness-105 dark:text-slate-100',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-[0_6px_14px_-4px_rgba(15,23,42,0.35),inset_0_1px_1px_rgba(255,255,255,0.55)]',
                            accent,
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
          className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 lg:hidden"
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
                    'relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-2 text-[11px] font-bold transition-colors',
                    isActive
                      ? 'text-blue-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-300',
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
                    animate={{ scale: isActive ? 1.12 : 1, y: isActive ? -1 : 0 }}
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

            {/* 4th Tab: Menyu (opens Liquid Glass Sheet with remaining sections) */}
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
                'relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-2 text-[11px] font-bold transition-colors',
                activeMobileTabId === 'more'
                  ? 'text-blue-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300',
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
                  scale: activeMobileTabId === 'more' ? 1.12 : 1,
                  rotate: menuOpen ? 90 : 0,
                  y: activeMobileTabId === 'more' ? -1 : 0,
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
