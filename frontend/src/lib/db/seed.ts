import { db } from './database';
import type { CollectionItem, DownloadItem, SettingItem, SubtitleItem } from '../../types/models';

const now = () => new Date().toISOString();

const demoCollections: CollectionItem[] = [
  {
    localId: 'col-music',
    name: 'Musica',
    description: 'Sesiones y pistas favoritas',
    color: '#A3FF12',
    icon: 'music',
    order: 1,
    itemIds: ['dl-audio-001', 'dl-audio-002'],
    updatedAt: now(),
  },
  {
    localId: 'col-videos',
    name: 'Videos',
    description: 'Material en formato video',
    color: '#F7E733',
    icon: 'film',
    order: 2,
    itemIds: ['dl-video-001'],
    updatedAt: now(),
  },
  {
    localId: 'col-work',
    name: 'Trabajo',
    description: 'Contenido de estudio y procesos',
    color: '#7EE8A6',
    icon: 'briefcase',
    order: 3,
    itemIds: [],
    updatedAt: now(),
  },
];

const demoDownloads: DownloadItem[] = [
  {
    localId: 'dl-audio-001',
    title: 'FAST Session 01',
    customName: 'Set Intro Premium',
    type: 'audio_mp3',
    mediaKind: 'audio',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/watch?v=dummy1',
    uploader: 'FAST Channel',
    durationSeconds: 220,
    format: 'mp3',
    sizeBytes: 8560000,
    createdAt: now(),
    downloadedAt: now(),
    mediaPath: '/media/demo/fast-session-01.mp3',
    thumbnailUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=640&q=80',
    tags: ['set', 'neon'],
    collectionId: 'col-music',
    notes: 'Audio principal de arranque',
    subtitleLanguages: [],
    favorite: true,
    archived: false,
    playbackProgress: 42,
    lastPlaybackPosition: 92,
    syncStatus: 'synced',
    error: null,
    fileAvailable: true,
  },
  {
    localId: 'dl-audio-002',
    title: 'Deep Focus Track',
    type: 'audio_mp3',
    mediaKind: 'audio',
    status: 'queued',
    sourceUrl: 'https://www.youtube.com/watch?v=dummy2',
    uploader: 'Focus Lab',
    durationSeconds: 335,
    format: 'mp3',
    sizeBytes: 9920000,
    createdAt: now(),
    downloadedAt: null,
    mediaPath: null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1461784121038-f088ca1e7714?w=640&q=80',
    tags: ['pending'],
    collectionId: 'col-music',
    notes: 'Pendiente por cola',
    subtitleLanguages: [],
    favorite: false,
    archived: false,
    playbackProgress: 0,
    lastPlaybackPosition: 0,
    syncStatus: 'syncing',
    error: null,
    fileAvailable: false,
  },
  {
    localId: 'dl-video-001',
    title: 'Curso FASTMP3FAST Arquitectura',
    type: 'video_mp4',
    mediaKind: 'video',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/watch?v=dummy3',
    uploader: 'Tech Studio',
    durationSeconds: 1410,
    format: 'mp4',
    sizeBytes: 204800000,
    createdAt: now(),
    downloadedAt: now(),
    mediaPath: '/media/demo/curso-fast.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=640&q=80',
    tags: ['curso', 'backend'],
    collectionId: 'col-videos',
    notes: 'Incluye subtitulos ES/EN',
    subtitleLanguages: ['es', 'en'],
    favorite: true,
    archived: false,
    playbackProgress: 12,
    lastPlaybackPosition: 170,
    syncStatus: 'synced',
    error: null,
    fileAvailable: true,
  },
  {
    localId: 'dl-video-002',
    title: 'Video Offline Pendiente',
    type: 'video_mp4',
    mediaKind: 'video',
    status: 'offline',
    sourceUrl: 'https://www.youtube.com/watch?v=dummy4',
    uploader: 'Field Upload',
    durationSeconds: null,
    format: null,
    sizeBytes: null,
    createdAt: now(),
    downloadedAt: null,
    mediaPath: null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=640&q=80',
    tags: ['offline', 'queue'],
    collectionId: 'col-work',
    notes: 'Guardado localmente sin red',
    subtitleLanguages: ['es'],
    favorite: false,
    archived: false,
    playbackProgress: 0,
    lastPlaybackPosition: 0,
    syncStatus: 'local_only',
    error: null,
    fileAvailable: false,
  },
];

const demoSubtitles: SubtitleItem[] = [
  {
    localId: 'sub-001',
    downloadLocalId: 'dl-video-001',
    language: 'es',
    format: 'vtt',
    path: '/media/demo/curso-fast-es.vtt',
    isDefault: true,
  },
  {
    localId: 'sub-002',
    downloadLocalId: 'dl-video-001',
    language: 'en',
    format: 'vtt',
    path: '/media/demo/curso-fast-en.vtt',
    isDefault: false,
  },
];

const defaultSettings: SettingItem[] = [
  {
    key: 'appearance',
    value: {
      theme: 'fastmp3fast-dark-neon',
      compactSidebar: false,
    },
    updatedAt: now(),
  },
  {
    key: 'download_defaults',
    value: {
      videoQuality: '1080p',
      audioQuality: '320kbps',
      subtitleLanguage: 'es',
      saveThumbnail: true,
      saveMetadata: true,
    },
    updatedAt: now(),
  },
  {
    key: 'player',
    value: {
      autoplay: false,
      rememberVolume: true,
      rememberProgress: true,
      defaultSpeed: 1,
    },
    updatedAt: now(),
  },
  {
    key: 'sync',
    value: {
      mode: 'auto',
      retryLimit: 5,
      backgroundIntervalSeconds: 25,
    },
    updatedAt: now(),
  },
];

export async function seedLocalDatabase(): Promise<void> {
  const [downloadsCount, collectionsCount] = await Promise.all([db.downloads.count(), db.collections.count()]);

  if (downloadsCount > 0 || collectionsCount > 0) {
    return;
  }

  await db.collections.bulkAdd(demoCollections);
  await db.downloads.bulkAdd(demoDownloads);
  await db.subtitles.bulkAdd(demoSubtitles);
  await db.settings.bulkAdd(defaultSettings);
  await db.recentActivity.bulkAdd([
    {
      localId: crypto.randomUUID(),
      event: 'download_completed',
      description: 'FAST Session 01 descargado correctamente',
      entityLocalId: 'dl-audio-001',
      isOfflineEvent: false,
      createdAt: now(),
    },
    {
      localId: crypto.randomUUID(),
      event: 'playback_resumed',
      description: 'Reanudaste Curso FASTMP3FAST Arquitectura',
      entityLocalId: 'dl-video-001',
      isOfflineEvent: false,
      createdAt: now(),
    },
    {
      localId: crypto.randomUUID(),
      event: 'sync_queued',
      description: 'Video Offline Pendiente en cola local',
      entityLocalId: 'dl-video-002',
      isOfflineEvent: true,
      createdAt: now(),
    },
  ]);

  await db.syncState.put({
    id: 'global',
    status: 'idle',
    updatedAt: now(),
  });

  await db.notifications.bulkAdd([
    {
      id: crypto.randomUUID(),
      title: 'Sincronizacion parcial',
      body: '2 operaciones pendientes por modo offline.',
      createdAt: now(),
    },
  ]);
}
