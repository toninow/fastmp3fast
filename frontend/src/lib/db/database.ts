import Dexie, { type EntityTable } from 'dexie';
import type {
  ActivityItem,
  CollectionItem,
  DownloadItem,
  NotificationItem,
  PlaybackProgressItem,
  SettingItem,
  SubtitleItem,
  SyncOperationItem,
  UserProfile,
} from '../../types/models';

export interface CachedSession {
  id: string;
  user: UserProfile;
  token: string;
  lastValidatedAt: string;
}

export interface OfflineMediaItem {
  downloadLocalId: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  updatedAt: string;
}

export interface OfflineSubtitleItem {
  id?: number;
  cacheKey: string;
  downloadLocalId: string;
  subtitleLocalId: string;
  language: string;
  format: 'srt' | 'vtt';
  blob: Blob;
  updatedAt: string;
}

class FastMp3FastDB extends Dexie {
  downloads!: EntityTable<DownloadItem, 'id'>;
  collections!: EntityTable<CollectionItem, 'id'>;
  subtitles!: EntityTable<SubtitleItem, 'id'>;
  playbackProgress!: EntityTable<PlaybackProgressItem, 'id'>;
  pendingOperations!: EntityTable<SyncOperationItem, 'id'>;
  syncState!: EntityTable<{ id: string; status: string; updatedAt: string }, 'id'>;
  cachedUser!: EntityTable<CachedSession, 'id'>;
  settings!: EntityTable<SettingItem, 'id'>;
  recentActivity!: EntityTable<ActivityItem, 'id'>;
  notifications!: EntityTable<NotificationItem, 'id'>;
  offlineMedia!: EntityTable<OfflineMediaItem, 'downloadLocalId'>;
  offlineSubtitles!: EntityTable<OfflineSubtitleItem, 'id'>;

  constructor() {
    super('fastmp3fast-db');

    this.version(1).stores({
      downloads:
        '++id, localId, remoteId, title, status, mediaKind, collectionId, syncStatus, createdAt, favorite, archived',
      collections: '++id, localId, remoteId, name, updatedAt',
      subtitles: '++id, localId, downloadLocalId, language, format',
      playbackProgress: '++id, downloadLocalId, updatedAt',
      pendingOperations: '++id, localId, status, createdAt, entityType, entityLocalId',
      syncState: 'id, status, updatedAt',
      cachedUser: 'id, lastValidatedAt',
      settings: '++id, key, updatedAt',
      recentActivity: '++id, localId, event, createdAt',
      notifications: 'id, createdAt',
    });

    this.version(2).stores({
      downloads:
        '++id, localId, remoteId, title, status, mediaKind, collectionId, syncStatus, createdAt, favorite, archived',
      collections: '++id, localId, remoteId, name, order, updatedAt',
      subtitles: '++id, localId, downloadLocalId, language, format',
      playbackProgress: '++id, downloadLocalId, updatedAt',
      pendingOperations: '++id, localId, status, createdAt, entityType, entityLocalId',
      syncState: 'id, status, updatedAt',
      cachedUser: 'id, lastValidatedAt',
      settings: '++id, key, updatedAt',
      recentActivity: '++id, localId, event, createdAt',
      notifications: 'id, createdAt',
    });

    this.version(3).stores({
      downloads:
        '++id, localId, remoteId, title, status, mediaKind, collectionId, syncStatus, createdAt, favorite, archived',
      collections: '++id, localId, remoteId, name, order, updatedAt',
      subtitles: '++id, localId, downloadLocalId, language, format',
      playbackProgress: '++id, downloadLocalId, updatedAt',
      pendingOperations: '++id, localId, status, createdAt, entityType, entityLocalId',
      syncState: 'id, status, updatedAt',
      cachedUser: 'id, lastValidatedAt',
      settings: '++id, key, updatedAt',
      recentActivity: '++id, localId, event, createdAt',
      notifications: 'id, createdAt',
      offlineMedia: 'downloadLocalId, updatedAt',
      offlineSubtitles: '++id, cacheKey, downloadLocalId, subtitleLocalId, language, updatedAt',
    });
  }
}

export const db = new FastMp3FastDB();

export async function clearUserScopedData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.downloads,
      db.collections,
      db.subtitles,
      db.playbackProgress,
      db.pendingOperations,
      db.syncState,
      db.settings,
      db.recentActivity,
      db.notifications,
      db.offlineMedia,
      db.offlineSubtitles,
    ],
    async () => {
      await Promise.all([
        db.downloads.clear(),
        db.collections.clear(),
        db.subtitles.clear(),
        db.playbackProgress.clear(),
        db.pendingOperations.clear(),
        db.syncState.clear(),
        db.settings.clear(),
        db.recentActivity.clear(),
        db.notifications.clear(),
        db.offlineMedia.clear(),
        db.offlineSubtitles.clear(),
      ]);
    }
  );
}
