import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { seedLocalDatabase } from './lib/db/seed';
import { registerServiceWorker } from './pwa/registerSW';
import { AppRouter } from './app/AppRouter';
import './index.css';

const queryClient = new QueryClient();
const runtimeBase = window.location.pathname.startsWith('/mp3fastmp3') ? '/mp3fastmp3' : '/fastmp3fast';

if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_SEED === 'true') {
  void seedLocalDatabase();
}
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={runtimeBase}>
        <AppRouter />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
