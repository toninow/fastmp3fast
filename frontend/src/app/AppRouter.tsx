import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { CollectionDetailPage } from '../pages/CollectionDetailPage';
import { CollectionsPage } from '../pages/CollectionsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DownloadDetailPage } from '../pages/DownloadDetailPage';
import { HistoryPage } from '../pages/HistoryPage';
import { LibraryPage } from '../pages/LibraryPage';
import { LoginPage } from '../pages/LoginPage';
import { NewDownloadPage } from '../pages/NewDownloadPage';
import { SearchResultsPage } from '../pages/SearchResultsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SyncPage } from '../pages/SyncPage';
import { useAuthStore } from '../store/authStore';
import { useSyncEngine } from '../hooks/useSyncEngine';

function ProtectedRoutes() {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to='/login' replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function AppRouter() {
  useSyncEngine();

  return (
    <Routes>
      <Route path='/login' element={<LoginPage />} />

      <Route element={<ProtectedRoutes />}>
        <Route path='/dashboard' element={<DashboardPage />} />
        <Route path='/downloads/new' element={<NewDownloadPage />} />
        <Route path='/search' element={<SearchResultsPage />} />
        <Route path='/library' element={<LibraryPage />} />
        <Route path='/downloads/:localId' element={<DownloadDetailPage />} />
        <Route path='/collections' element={<CollectionsPage />} />
        <Route path='/collections/:localId' element={<CollectionDetailPage />} />
        <Route path='/history' element={<HistoryPage />} />
        <Route path='/sync' element={<SyncPage />} />
        <Route path='/settings' element={<SettingsPage />} />
      </Route>

      <Route path='/' element={<Navigate to='/dashboard' replace />} />
      <Route path='*' element={<Navigate to='/dashboard' replace />} />
    </Routes>
  );
}
