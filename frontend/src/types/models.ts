export type DownloadStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'error'
  | 'offline'
  | 'syncing'
  | 'playing'
  | 'paused';

export type MediaKind = 'audio' | 'video';

export interface UserProfile {
  id: number;
  name: string;
  email: string | null;
  username?: string;
  is_admin?: boolean;
}

export interface DownloadItem {
  id?: number;
  localId: string;
  remoteId?: string | null;
  title: string;
  customName?: string | null;
  type: string;
  mediaKind: MediaKind;
  status: DownloadStatus;
  sourceUrl: string;
  uploader?: string | null;
  durationSeconds?: number | null;
  format?: string | null;
  videoQuality?: string | null;
  audioQuality?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
  downloadedAt?: string | null;
  mediaPath?: string | null;
  thumbnailUrl?: string | null;
  tags: string[];
  collectionId?: string | null;
  notes?: string | null;
  subtitleLanguages: string[];
  favorite: boolean;
  archived: boolean;
  playbackProgress: number;
  lastPlaybackPosition: number;
  lastPlayedAt?: string | null;
  syncStatus: 'synced' | 'local_only' | 'syncing' | 'sync_error';
  error?: string | null;
  fileAvailable: boolean;
  ownerUsername?: string | null;
  ownerName?: string | null;
  progressPercent?: number | null;
  progressSpeed?: string | null;
  progressEta?: string | null;
  progressLine?: string | null;
  progressState?: string | null;
}

export interface CollectionItem {
  id?: number;
  localId: string;
  remoteId?: string | null;
  name: string;
  description?: string;
  color: string;
  icon: string;
  order: number;
  itemIds: string[];
  updatedAt: string;
}

export interface SubtitleItem {
  id?: number;
  localId: string;
  downloadLocalId: string;
  language: string;
  format: 'srt' | 'vtt';
  path: string;
  isDefault?: boolean;
}

export interface PlaybackProgressItem {
  id?: number;
  downloadLocalId: string;
  positionSeconds: number;
  durationSeconds: number;
  percent: number;
  volume: number;
  speed: number;
  isCompleted: boolean;
  updatedAt: string;
}

export interface SyncOperationItem {
  id?: number;
  localId: string;
  operation: string;
  entityType: string;
  entityLocalId?: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'synced' | 'conflict' | 'error';
  attempts: number;
  lastError?: string;
  createdAt: string;
}

export interface ActivityItem {
  id?: number;
  localId: string;
  event: string;
  description: string;
  entityLocalId?: string;
  isOfflineEvent: boolean;
  createdAt: string;
}

export interface SettingItem {
  id?: number;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface DashboardKpi {
  label: string;
  value: number;
  subtitle: string;
  tone: 'primary' | 'secondary' | 'neutral' | 'danger';
}

export interface DashboardData {
  kpis: DashboardKpi[];
  recentDownloads: DownloadItem[];
  recentActivity: ActivityItem[];
  syncQueue: SyncOperationItem[];
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface PlayerTrack {
  localId: string;
  title: string;
  mediaKind: MediaKind;
  src: string;
  poster?: string | null;
  subtitles: SubtitleItem[];
  durationSeconds?: number | null;
}

export interface YoutubeSearchItem {
  id?: string | null;
  title: string;
  uploader?: string;
  duration_seconds?: number | null;
  webpage_url: string;
  thumbnail?: string | null;
}

export interface RecommendationItem extends YoutubeSearchItem {
  reason?: string;
}
