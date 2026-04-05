import { db } from '../db/database';
import { apiEndpoints } from '../api/endpoints';
import type { CollectionItem, DownloadItem, SyncOperationItem } from '../../types/models';
import { buildSubtitleUrl } from '../mediaAccess';

function normalizeDownloadStatus(value: unknown): DownloadItem['status'] {
  const allowed: DownloadItem['status'][] = [
    'pending',
    'queued',
    'processing',
    'completed',
    'error',
    'offline',
    'syncing',
    'playing',
    'paused',
  ];
  const status = String(value ?? '').toLowerCase() as DownloadItem['status'];
  return allowed.includes(status) ? status : 'queued';
}

function toDownloadItem(raw: Record<string, unknown>, previous?: DownloadItem): DownloadItem {
  const metadataRaw = raw.metadata;
  let metadata: Record<string, unknown> = {};
  if (metadataRaw && typeof metadataRaw === 'object') {
    metadata = metadataRaw as Record<string, unknown>;
  } else if (typeof metadataRaw === 'string') {
    try {
      const parsed = JSON.parse(metadataRaw) as unknown;
      if (parsed && typeof parsed === 'object') {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
  }
  const localId = String(raw.local_uid ?? previous?.localId ?? `remote-${String(raw.id ?? crypto.randomUUID())}`);
  const type = String(raw.type ?? previous?.type ?? 'audio_mp3');
  const normalizedFormat = String(raw.format ?? previous?.format ?? '').toLowerCase().trim();
  const mediaKindByFormat = ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(normalizedFormat)
    ? 'video'
    : ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'].includes(normalizedFormat)
      ? 'audio'
      : null;
  const subtitleLanguages = Array.isArray(raw.subtitle_languages)
    ? (raw.subtitle_languages as string[])
    : previous?.subtitleLanguages ?? [];
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : previous?.tags ?? [];
  const normalizedStatus = normalizeDownloadStatus(raw.status ?? previous?.status ?? 'queued');
  const downloadedAt =
    raw.downloaded_at ? String(raw.downloaded_at) : raw.completed_at ? String(raw.completed_at) : previous?.downloadedAt ?? null;
  const mediaPath = raw.media_path
    ? String(raw.media_path)
    : raw.path
      ? String(raw.path)
      : previous?.mediaPath ?? null;
  const fileExistsRaw =
    raw.file_exists ??
    raw.file_available ??
    raw.fileAvailable ??
    previous?.fileAvailable ??
    false;
  const inferredAvailable = Boolean(fileExistsRaw || mediaPath || downloadedAt || normalizedStatus === 'completed');
  const progressPercentRaw =
    raw.progress_percent ??
    metadata.progress_percent ??
    metadata.download_progress_percent ??
    previous?.progressPercent ??
    null;
  const progressPercent = progressPercentRaw === null || progressPercentRaw === undefined
    ? null
    : Number(progressPercentRaw);
  const videoQualityRaw = raw.video_quality ?? metadata.video_quality ?? previous?.videoQuality ?? null;
  const audioQualityRaw = raw.audio_quality ?? metadata.audio_quality ?? previous?.audioQuality ?? null;

  return {
    id: previous?.id,
    localId,
    remoteId: raw.id ? String(raw.id) : raw.remote_id ? String(raw.remote_id) : previous?.remoteId ?? null,
    title: String(raw.title ?? previous?.title ?? 'Nueva descarga'),
    customName: raw.custom_name ? String(raw.custom_name) : previous?.customName ?? null,
    type,
    mediaKind: mediaKindByFormat ?? (type.includes('audio') ? 'audio' : 'video'),
    status: normalizedStatus,
    sourceUrl: String(raw.source_url ?? previous?.sourceUrl ?? ''),
    uploader: raw.uploader ? String(raw.uploader) : previous?.uploader ?? null,
    durationSeconds: Number(raw.duration_seconds ?? previous?.durationSeconds ?? 0) || null,
    format: raw.format ? String(raw.format) : previous?.format ?? null,
    videoQuality: videoQualityRaw === null || videoQualityRaw === undefined ? null : String(videoQualityRaw),
    audioQuality: audioQualityRaw === null || audioQualityRaw === undefined ? null : String(audioQualityRaw),
    sizeBytes: Number(raw.size_bytes ?? previous?.sizeBytes ?? 0) || null,
    createdAt: String(raw.created_at ?? previous?.createdAt ?? new Date().toISOString()),
    downloadedAt,
    mediaPath,
    thumbnailUrl: raw.thumbnail_path ? String(raw.thumbnail_path) : previous?.thumbnailUrl ?? null,
    tags,
    collectionId: raw.collection_id ? String(raw.collection_id) : previous?.collectionId ?? null,
    notes: raw.notes ? String(raw.notes) : previous?.notes ?? null,
    subtitleLanguages,
    favorite: Boolean(raw.favorite ?? previous?.favorite ?? false),
    archived: Boolean(raw.archived ?? previous?.archived ?? false),
    playbackProgress: previous?.playbackProgress ?? 0,
    lastPlaybackPosition: Number(raw.last_playback_position_seconds ?? previous?.lastPlaybackPosition ?? 0),
    lastPlayedAt: raw.last_played_at ? String(raw.last_played_at) : previous?.lastPlayedAt ?? null,
    syncStatus: (String(raw.sync_status ?? previous?.syncStatus ?? 'synced') as DownloadItem['syncStatus']),
    error: raw.error_message ? String(raw.error_message) : previous?.error ?? null,
    fileAvailable: inferredAvailable,
    ownerUsername: raw.owner_username ? String(raw.owner_username) : previous?.ownerUsername ?? null,
    ownerName: raw.owner_name ? String(raw.owner_name) : previous?.ownerName ?? null,
    progressPercent: Number.isFinite(progressPercent) ? Math.max(0, Math.min(100, Number(progressPercent))) : null,
    progressSpeed:
      raw.progress_speed
        ? String(raw.progress_speed)
        : metadata.progress_speed
          ? String(metadata.progress_speed)
          : previous?.progressSpeed ?? null,
    progressEta:
      raw.progress_eta
        ? String(raw.progress_eta)
        : metadata.progress_eta
          ? String(metadata.progress_eta)
          : previous?.progressEta ?? null,
    progressLine:
      raw.progress_line
        ? String(raw.progress_line)
        : metadata.progress_line
          ? String(metadata.progress_line)
          : previous?.progressLine ?? null,
    progressState:
      raw.progress_state
        ? String(raw.progress_state)
        : metadata.progress_state
          ? String(metadata.progress_state)
          : previous?.progressState ?? null,
  };
}

function toCollectionItem(raw: Record<string, unknown>, previous?: CollectionItem): CollectionItem {
  const localId = String(raw.local_id ?? previous?.localId ?? `col-${String(raw.id ?? crypto.randomUUID())}`);
  const rawItemIds = Array.isArray(raw.item_ids) ? (raw.item_ids as unknown[]) : [];
  const itemIds = rawItemIds
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);

  return {
    id: previous?.id,
    localId,
    remoteId: raw.id ? String(raw.id) : previous?.remoteId ?? null,
    name: String(raw.name ?? previous?.name ?? 'Lista'),
    description: String(raw.description ?? previous?.description ?? ''),
    color: String(raw.color ?? previous?.color ?? '#A3FF12'),
    icon: String(raw.icon ?? previous?.icon ?? 'folder'),
    order: Number(raw.sort_order ?? previous?.order ?? 0),
    itemIds,
    updatedAt: String(raw.updated_at ?? previous?.updatedAt ?? new Date().toISOString()),
  };
}

export async function refreshDownloadsFromBackend(): Promise<void> {
  const response = await apiEndpoints.downloads();
  const candidate = response?.data?.data;
  const rows = Array.isArray(candidate) ? candidate : candidate?.data;
  if (!Array.isArray(rows)) {
    return;
  }

  const remoteLocalIds = new Set<string>();
  for (const row of rows as Record<string, unknown>[]) {
    const localId = String(row.local_uid ?? '');
    if (localId) {
      remoteLocalIds.add(localId);
    }
    const previous = localId ? await db.downloads.where('localId').equals(localId).first() : undefined;
    const mapped = toDownloadItem(row, previous);
    await db.downloads.put({ ...mapped, id: previous?.id });
  }

  const localRows = await db.downloads.toArray();
  const staleLocalIds = localRows
    .filter((item) => item.syncStatus !== 'local_only' && !remoteLocalIds.has(item.localId))
    .map((item) => item.localId);

  if (staleLocalIds.length > 0) {
    for (const localId of staleLocalIds) {
      await db.downloads.where('localId').equals(localId).delete();
      await db.subtitles.where('downloadLocalId').equals(localId).delete();
      await db.playbackProgress.where('downloadLocalId').equals(localId).delete();
      await db.offlineMedia.where('downloadLocalId').equals(localId).delete();
      await db.offlineSubtitles.where('downloadLocalId').equals(localId).delete();
    }
  }
}

export async function refreshCollectionsFromBackend(): Promise<void> {
  const response = await apiEndpoints.collections();
  const rows = response?.data;
  if (!Array.isArray(rows)) {
    return;
  }
  const remoteLocalIds = new Set<string>();

  const resolveItemIds = async (raw: Record<string, unknown>): Promise<string[]> => {
    let refs: unknown[] = Array.isArray(raw.item_ids) ? raw.item_ids : [];

    if (refs.length === 0 && raw.id) {
      try {
        const detail = await apiEndpoints.collectionById(String(raw.id));
        const detailItems = detail?.data?.items;
        if (Array.isArray(detailItems)) {
          refs = detailItems
            .map((item) => {
              const row = item as Record<string, unknown>;
              return row.local_uid ?? row.download_local_uid ?? row.localId ?? row.download_id ?? null;
            })
            .filter((value) => value !== null);
        }
      } catch {
        refs = [];
      }
    }

    const localIds: string[] = [];
    for (const ref of refs) {
      const value = String(ref ?? '').trim();
      if (!value) {
        continue;
      }
      if (value.startsWith('dl-')) {
        localIds.push(value);
        continue;
      }
      const byRemote = await db.downloads.where('remoteId').equals(value).first();
      if (byRemote?.localId) {
        localIds.push(byRemote.localId);
      }
    }

    return Array.from(new Set(localIds));
  };

  for (const row of rows as Record<string, unknown>[]) {
    const resolvedItemIds = await resolveItemIds(row);
    const localId = String(row.local_id ?? '');
    if (localId) {
      remoteLocalIds.add(localId);
    }
    const previous = localId ? await db.collections.where('localId').equals(localId).first() : undefined;
    const mapped = toCollectionItem({ ...row, item_ids: resolvedItemIds }, previous);
    await db.collections.put({ ...mapped, id: previous?.id });
  }

  const localRows = await db.collections.toArray();
  const staleLocalIds = localRows
    .filter((item) => Boolean(item.remoteId) && !remoteLocalIds.has(item.localId))
    .map((item) => item.localId);

  if (staleLocalIds.length > 0) {
    await Promise.all(staleLocalIds.map((localId) => db.collections.where('localId').equals(localId).delete()));
  }
}

export async function refreshSubtitlesFromBackend(): Promise<void> {
  const response = await apiEndpoints.subtitles();
  const rows = response?.data;
  if (!Array.isArray(rows)) {
    return;
  }

  for (const row of rows as Record<string, unknown>[]) {
    const subtitleId = Number(row.id ?? 0);
    const subtitleLocalId = String(row.local_id ?? `sub-${subtitleId || crypto.randomUUID()}`);
    let downloadLocalId = String(row.download_local_uid ?? row.downloadLocalId ?? '').trim();

    if (!downloadLocalId && row.download_id) {
      const byRemote = await db.downloads.where('remoteId').equals(String(row.download_id)).first();
      if (byRemote?.localId) {
        downloadLocalId = byRemote.localId;
      }
    }

    if (!downloadLocalId) {
      continue;
    }

    const rawPath = String(row.path ?? '').trim();
    const hasRemotePath = /^https?:\/\//i.test(rawPath);
    const streamPath = hasRemotePath
      ? rawPath
      : subtitleId > 0
        ? buildSubtitleUrl(subtitleId)
        : rawPath;

    const existing = await db.subtitles.where('localId').equals(subtitleLocalId).first();
    await db.subtitles.put({
      id: existing?.id,
      localId: subtitleLocalId,
      downloadLocalId,
      language: String(row.language ?? 'es'),
      format: String(row.format ?? 'vtt').toLowerCase() === 'srt' ? 'srt' : 'vtt',
      path: streamPath,
      isDefault: Boolean(row.is_default ?? existing?.isDefault ?? false),
    });
  }
}

export async function enqueueOperation(payload: Omit<SyncOperationItem, 'createdAt' | 'attempts' | 'status'>): Promise<void> {
  await db.pendingOperations.add({
    ...payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  });
}

export async function processPendingOperations(): Promise<{ synced: number; failed: number }> {
  const pending = await db.pendingOperations.where('status').anyOf('pending', 'error').toArray();

  if (pending.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  const operationsPayload = pending.map((op) => ({
    operation: op.operation,
    entity_type: op.entityType,
    entity_local_id: op.entityLocalId,
    payload: op.payload,
  }));

  try {
    await apiEndpoints.enqueueSync({ operations: operationsPayload });
    await refreshDownloadsFromBackend();

    await Promise.all(
      pending.map((op) =>
        db.pendingOperations.where('localId').equals(op.localId).modify({
          status: 'synced',
        })
      )
    );

    synced = pending.length;
  } catch (error) {
    failed = pending.length;

    await Promise.all(
      pending.map((op) =>
        db.pendingOperations.where('localId').equals(op.localId).modify({
          status: 'error',
          attempts: op.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Sync failed',
        })
      )
    );
  }

  await db.syncState.put({
    id: 'global',
    status: failed > 0 ? 'sync_error' : 'synced',
    updatedAt: new Date().toISOString(),
  });

  return { synced, failed };
}
