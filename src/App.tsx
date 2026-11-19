import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { I18nProvider, useI18n } from '@/i18n/I18nContext';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthGatePage } from '@/pages/AuthGatePage';
import { GlassCard } from '@/components/glass/GlassCard';

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const AccountsPage = lazy(() =>
  import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
const TransactionsPage = lazy(() =>
  import('@/pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const AnalyticsPage = lazy(() =>
  import('@/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const PlanningPage = lazy(() =>
  import('@/pages/PlanningPage').then((m) => ({ default: m.PlanningPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const TransfersPage = lazy(() =>
  import('@/pages/TransfersPage').then((m) => ({ default: m.TransfersPage })),
);
const LedgerPage = lazy(() =>
  import('@/pages/LedgerPage').then((m) => ({ default: m.LedgerPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteFallback() {
  const { t } = useI18n();
  return (
    <GlassCard>
      <p className="text-sm text-slate-500">{t.common.loading}</p>
    </GlassCard>
  );
}

function RootRouter() {
  const { status } = useAuth();

  if (status !== 'authenticated') {
    return (
      <AppLayout>
        <Routes>
          <Route path="*" element={<AuthGatePage />} />
        </Routes>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <RootRouter />
            </BrowserRouter>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
