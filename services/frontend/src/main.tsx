import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { AuthGate } from './components/layout/AuthGate';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { SystemDetailPage } from './pages/SystemDetailPage';
import { AlertsPage } from './pages/AlertsPage';
import { AlertRulesPage } from './pages/AlertRulesPage';
import { DeviceProfilesPage } from './pages/DeviceProfilesPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth/callback" element={<AuthGate><div /></AuthGate>} />
            <Route element={<AuthGate><AppLayout /></AuthGate>}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/system/:systemId" element={<SystemDetailPage />} />
              <Route path="/alerts" element={<AlertsPage />}>
                <Route path="rules" element={<AlertRulesPage />} />
              </Route>
              <Route path="/profiles" element={<DeviceProfilesPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
