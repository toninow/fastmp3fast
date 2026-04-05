import { useEffect } from 'react';
import { useOnlineStatus } from './useOnlineStatus';
import {
  processPendingOperations,
  refreshCollectionsFromBackend,
  refreshDownloadsFromBackend,
  refreshSubtitlesFromBackend,
} from '../lib/offline/syncQueue';
import { db } from '../lib/db/database';
import { useAuthStore } from '../store/authStore';

export function useSyncEngine(): void {
  const online = useOnlineStatus();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    const syncNow = async () => {
      if (!token || !user) {
        return;
      }

      if (!online) {
        await db.syncState.put({
          id: 'global',
          status: 'offline',
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      try {
        await db.syncState.put({
          id: 'global',
          status: 'syncing',
          updatedAt: new Date().toISOString(),
        });

        await refreshDownloadsFromBackend();
        await refreshCollectionsFromBackend();
        await refreshSubtitlesFromBackend();
        const result = await processPendingOperations();

        if (result.synced === 0 && result.failed === 0) {
          await db.syncState.put({
            id: 'global',
            status: 'idle',
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        await db.syncState.put({
          id: 'global',
          status: 'sync_error',
          updatedAt: new Date().toISOString(),
        });
      }
    };

    void syncNow();
    const interval = window.setInterval(() => {
      void syncNow();
    }, 20000);

    return () => {
      window.clearInterval(interval);
    };
  }, [online, token, user]);
}
