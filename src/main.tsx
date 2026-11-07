import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import './app.css';
import { StudioLayout } from './pages/StudioLayout';
import { HomePage } from './pages/HomePage';
import { ServicesPage } from './pages/ServicesPage';
import { MyBookingPage } from './pages/MyBookingPage';
import { RootPage } from './pages/RootPage';
import { registerSW } from 'virtual:pwa-register';

const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Routes>
          <Route path="/" element={<RootPage />} />
          <Route path="/s/:slug" element={<StudioLayout />}>
            <Route index element={<HomePage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="my" element={<MyBookingPage />} />
            <Route path="admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
          </Route>
          <Route path="*" element={<RootPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
