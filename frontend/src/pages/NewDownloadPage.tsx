import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CloudOff, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OfflineBanner } from '../components/common/OfflineBanner';
import { audioQualityOptions, downloadTypeOptions, qualityOptions } from '../data/downloadTypes';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { db } from '../lib/db/database';
import {
  enqueueOperation,
  processPendingOperations,
  refreshCollectionsFromBackend,
  refreshDownloadsFromBackend,
  refreshSubtitlesFromBackend,
} from '../lib/offline/syncQueue';
import { useUiStore } from '../store/uiStore';
import { resolveDownloadCover } from '../lib/covers';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';
import { StatusBadge } from '../components/common/StatusBadge';
import { Link, useNavigate } from 'react-router-dom';
import { buildDownloadUrl, isDownloadReady } from '../lib/mediaAccess';
import { apiEndpoints } from '../lib/api/endpoints';
import type { DownloadItem } from '../types/models';

interface DownloadDraft {
  url: string;
  downloadType: string;
  videoQuality: string;
  audioQuality: string;
  collectionId: string;
  tags: string;
  customName: string;
  note: string;
  subtitleEnabled: boolean;
  subtitleLanguage: string;
  saveThumbnail: boolean;
  saveMetadata: boolean;
}

function generateTagsFromName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);

  const unique = Array.from(new Set(tokens)).slice(0, 6);
  return unique.join(', ');
}

function normalizeSourceUrl(url: string): string {
  const value = url.trim();
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : value;
    }
    if (host.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : value;
    }
  } catch {
    return value.replace(/\/+$/, '');
  }

  return value.replace(/\/+$/, '');
}

function normalizeVideoQuality(value: string | null | undefined): string | null {
  const raw = String(value ?? '').toLowerCase();
  const match = raw.match(/(4320|2160|1440|1080|720|480|360|240)p?/);
  return match ? `${match[1]}p` : null;
}

function normalizeAudioQuality(value: string | null | undefined): string | null {
  const raw = String(value ?? '').toLowerCase();
  const match = raw.match(/(320|256|192|160|128)\s*kbps?/);
  return match ? `${match[1]}kbps` : null;
}

function canonicalDownloadType(value: string | null | undefined): 'audio_mp3' | 'video_mp4' {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('mp4') || raw.includes('video')) {
    return 'video_mp4';
  }
  return 'audio_mp3';
}

export function NewDownloadPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), []);
  const allDownloads = useLiveQuery(() => db.downloads.toArray(), []);
  const recentDownloads = useLiveQuery(() => db.downloads.orderBy('createdAt').reverse().limit(8).toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);
  const pushToast = useUiStore((state) => state.pushNotification);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const [form, setForm] = useState<DownloadDraft>({
    url: '',
    downloadType: 'audio_mp3',
    videoQuality: 'best',
    audioQuality: 'best',
    collectionId: '',
    tags: '',
    customName: '',
    note: '',
    subtitleEnabled: true,
    subtitleLanguage: 'es',
    saveThumbnail: true,
    saveMetadata: true,
  });
  const [mainTagsTouched, setMainTagsTouched] = useState(false);

  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedCollectionName =
    (collections ?? []).find((item) => item.localId === form.collectionId)?.name ?? 'Descargas (por defecto)';
  const visibleDownloadTypes = showAdvanced
    ? downloadTypeOptions
    : downloadTypeOptions.filter((opt) => opt.value === 'audio_mp3' || opt.value === 'video_mp4');

  const downloadingNow = (allDownloads ?? [])
    .filter(
      (item) =>
        !item.fileAvailable &&
        !item.downloadedAt &&
        ['queued', 'pending', 'processing', 'offline', 'syncing'].includes(item.status)
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 12);
  const hasActiveDownloads = downloadingNow.length > 0;

  const progressValue = (item: { status: string; fileAvailable: boolean; downloadedAt?: string | null; progressPercent?: number | null }) => {
    if (item.fileAvailable || item.downloadedAt) {
      return 100;
    }
    if (typeof item.progressPercent === 'number' && Number.isFinite(item.progressPercent)) {
      return Math.max(0, Math.min(100, item.progressPercent));
    }
    if (item.status === 'processing' || item.status === 'syncing') {
      return 8;
    }
    return 0;
  };

  const findDuplicate = async (url: string) => {
    const requestedType = canonicalDownloadType(form.downloadType);
    const requestedVideoQuality = normalizeVideoQuality(form.videoQuality);
    const requestedAudioQuality = normalizeAudioQuality(form.audioQuality);
    const normalized = normalizeSourceUrl(url);
    if (!normalized) {
      return null;
    }
    const rows = await db.downloads.toArray();
    return (
      rows.find((item) => {
        if (item.type !== requestedType) {
          return false;
        }
        if (requestedType.includes('video')) {
          const existingVideoQuality = normalizeVideoQuality(item.videoQuality);
          if (!existingVideoQuality || (requestedVideoQuality && existingVideoQuality !== requestedVideoQuality)) {
            return false;
          }
        }
        if (requestedType.includes('audio')) {
          const existingAudioQuality = normalizeAudioQuality(item.audioQuality);
          if (!existingAudioQuality || (requestedAudioQuality && existingAudioQuality !== requestedAudioQuality)) {
            return false;
          }
        }
        const isReady = isDownloadReady(item);
        const isInFlight = ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(item.status);
        if (item.status === 'error' || (!isReady && !isInFlight)) {
          return false;
        }
        return normalizeSourceUrl(item.sourceUrl) === normalized;
      }) ?? null
    );
  };

  const enqueueFromDraft = async (draft: DownloadDraft, successTitle: string, options?: { allowDuplicate?: boolean }) => {
    if (!options?.allowDuplicate) {
      const duplicate = await findDuplicate(draft.url);
      if (duplicate) {
        pushToast({
          id: crypto.randomUUID(),
          title: 'Ya lo tienes en la biblioteca',
          body: `${duplicate.customName ?? duplicate.title} (${describeState(duplicate)}).`,
          createdAt: new Date().toISOString(),
        });
        navigate(`/downloads/${duplicate.localId}`);
        return;
      }
    }

    const localId = `dl-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const selectedCollection = draft.collectionId
      ? await db.collections.where('localId').equals(draft.collectionId).first()
      : undefined;
    const selectedCollectionRemoteIdCandidate = selectedCollection?.remoteId ? Number(selectedCollection.remoteId) : null;
    const selectedCollectionRemoteId =
      selectedCollectionRemoteIdCandidate !== null && Number.isFinite(selectedCollectionRemoteIdCandidate)
        ? selectedCollectionRemoteIdCandidate
        : null;
    const normalizedName = draft.customName.trim();
    const normalizedTags = draft.tags.trim() || generateTagsFromName(normalizedName || draft.url || 'descarga');
    const normalizedType = canonicalDownloadType(draft.downloadType);
    const normalizedVideoQuality =
      normalizedType === 'video_mp4'
        ? draft.videoQuality === 'best'
          ? null
          : normalizeVideoQuality(draft.videoQuality) || '1080p'
        : null;
    const normalizedAudioQuality =
      normalizedType === 'audio_mp3'
        ? draft.audioQuality === 'best'
          ? null
          : normalizeAudioQuality(draft.audioQuality) || '320kbps'
        : null;

    await db.downloads.add({
      localId,
      title: normalizedName || 'Nueva descarga',
      customName: normalizedName || null,
      type: normalizedType,
      mediaKind: normalizedType === 'audio_mp3' ? 'audio' : 'video',
      status: online ? 'queued' : 'offline',
      sourceUrl: draft.url,
      createdAt,
      downloadedAt: null,
      tags: normalizedTags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      collectionId: draft.collectionId,
      notes: draft.note,
      subtitleLanguages: draft.subtitleEnabled ? [draft.subtitleLanguage] : [],
      favorite: false,
      archived: false,
      playbackProgress: 0,
      lastPlaybackPosition: 0,
      syncStatus: online ? 'syncing' : 'local_only',
      error: null,
      fileAvailable: false,
      videoQuality: normalizedVideoQuality,
      audioQuality: normalizedAudioQuality,
      progressPercent: 0,
      progressSpeed: null,
      progressEta: null,
      progressLine: online ? 'En cola remota' : 'En cola local',
      progressState: online ? 'queued' : 'offline',
    });

    await db.recentActivity.add({
      localId: crypto.randomUUID(),
      event: 'download_created',
      description: `Solicitud creada: ${draft.url}`,
      entityLocalId: localId,
      isOfflineEvent: !online,
      createdAt,
    });

    await enqueueOperation({
      localId: crypto.randomUUID(),
      operation: 'create',
      entityType: 'download',
      entityLocalId: localId,
      payload: {
        local_uid: localId,
        url: draft.url,
        download_type: normalizedType,
        video_quality: normalizedVideoQuality,
        audio_quality: normalizedAudioQuality,
        custom_name: normalizedName || null,
        collection_id: selectedCollectionRemoteId,
        tags: normalizedTags
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        note: draft.note || null,
        subtitle_enabled: draft.subtitleEnabled,
        subtitle_language: draft.subtitleLanguage,
        save_thumbnail: draft.saveThumbnail,
        save_metadata: draft.saveMetadata,
        is_offline_queued: !online,
      },
    });

    let syncFailed = false;
    if (online) {
      try {
        await processPendingOperations();
        await refreshDownloadsFromBackend();
        await refreshCollectionsFromBackend();
      } catch (error) {
        syncFailed = true;
        const message = error instanceof Error ? error.message : 'Error de sincronización inicial';
        pushToast({
          id: crypto.randomUUID(),
          title: 'Guardado local, sync pendiente',
          body: message,
          createdAt,
        });
      }
    }

    pushToast({
      id: crypto.randomUUID(),
      title: online ? (syncFailed ? 'Descarga en cola local' : successTitle) : 'Descarga en cola local',
      body: online
        ? syncFailed
          ? 'Se guardó en local y se reintentará la sincronización automáticamente.'
          : 'Se enviará al backend para procesamiento.'
        : 'Se sincronizará al volver conexión.',
      createdAt,
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await enqueueFromDraft(form, 'Descarga en cola remota');
      setSaved(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la descarga.';
      pushToast({
        id: crypto.randomUUID(),
        title: 'Error al descargar',
        body: message,
        createdAt: new Date().toISOString(),
      });
    }
  };

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(() => setSaved(false), 3200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        await refreshDownloadsFromBackend();
        if (hasActiveDownloads) {
          await refreshSubtitlesFromBackend();
        }
      } catch {
        // keep UI responsive even if refresh fails temporarily
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(refresh, hasActiveDownloads && online ? 1100 : online ? 3500 : 7000);
        }
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [hasActiveDownloads, online]);

  const playRecent = (localId: string, mode: 'audio' | 'video' | 'auto' = 'auto') => {
    const item = (recentDownloads ?? []).find((x) => x.localId === localId);
    if (!item) {
      return;
    }
    const appearsReady = isDownloadReady(item);
    if (!appearsReady) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Aún no descargado',
        body: 'Este elemento todavía está en proceso o en cola.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const subtitleRows = (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId);
    const track = buildTrack(item, subtitleRows);
    if (!track.src) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Archivo no disponible',
        body: 'No hay archivo reproducible para este elemento.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    playTrack({
      ...track,
      mediaKind: mode === 'auto' ? track.mediaKind : mode,
    });
  };

  const queueRecentAgain = async (localId: string) => {
    const item = (recentDownloads ?? []).find((x) => x.localId === localId);
    if (!item?.sourceUrl) {
      return;
    }
    const draft: DownloadDraft = {
      url: item.sourceUrl,
      downloadType: item.type === 'audio_mp3' || item.type === 'video_mp4' ? item.type : item.mediaKind === 'video' ? 'video_mp4' : 'audio_mp3',
      videoQuality: form.videoQuality,
      audioQuality: form.audioQuality,
      collectionId: item.collectionId ?? '',
      tags: item.tags.join(', '),
      customName: item.customName ?? item.title,
      note: item.notes ?? '',
      subtitleEnabled: item.subtitleLanguages.length > 0,
      subtitleLanguage: item.subtitleLanguages[0] ?? 'es',
      saveThumbnail: true,
      saveMetadata: true,
    };
    try {
      const draftType = canonicalDownloadType(draft.downloadType);
      await enqueueFromDraft(draft, draftType === 'audio_mp3' ? 'MP3 en cola remota' : 'MP4 en cola remota', {
        allowDuplicate: true,
      });
      setSaved(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo reintentar la descarga.';
      pushToast({
        id: crypto.randomUUID(),
        title: 'Error al descargar',
        body: message,
        createdAt: new Date().toISOString(),
      });
    }
  };

  const deleteRecentItem = async (item: DownloadItem) => {
    const label = item.customName ?? item.title;
    const confirmed = window.confirm(`¿Eliminar "${label}" de la biblioteca?`);
    if (!confirmed) {
      return;
    }

    try {
      await apiEndpoints.deleteDownloadByLocal(item.localId);
    } catch {
      // Keep local delete for offline-first UX.
    }
    try {
      await db.transaction(
        'rw',
        [db.downloads, db.subtitles, db.playbackProgress, db.recentActivity, db.offlineMedia, db.offlineSubtitles, db.collections],
        async () => {
          await db.downloads.where('localId').equals(item.localId).delete();
          await db.subtitles.where('downloadLocalId').equals(item.localId).delete();
          await db.playbackProgress.where('downloadLocalId').equals(item.localId).delete();
          const activityRows = await db.recentActivity.toArray();
          const activityIdsToDelete = activityRows
            .filter((row) => row.entityLocalId === item.localId && typeof row.id === 'number')
            .map((row) => row.id as number);
          if (activityIdsToDelete.length > 0) {
            await db.recentActivity.bulkDelete(activityIdsToDelete);
          }
          await db.offlineMedia.where('downloadLocalId').equals(item.localId).delete();
          await db.offlineSubtitles.where('downloadLocalId').equals(item.localId).delete();

          const collectionsRows = await db.collections.toArray();
          await Promise.all(
            collectionsRows
              .filter((collection) => Array.isArray(collection.itemIds) && collection.itemIds.includes(item.localId))
              .map((collection) =>
                db.collections.where('localId').equals(collection.localId).modify({
                  itemIds: (Array.isArray(collection.itemIds) ? collection.itemIds : []).filter((id) => id !== item.localId),
                })
              )
          );
        }
      );

      pushToast({
        id: crypto.randomUUID(),
        title: 'Elemento eliminado',
        body: `"${label}" se eliminó de la biblioteca.`,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'No se pudo eliminar',
        body: error instanceof Error ? error.message : 'Error local al eliminar el elemento.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const describeState = (
    item: Pick<DownloadItem, 'status' | 'fileAvailable' | 'downloadedAt' | 'mediaPath' | 'syncStatus' | 'error'>
  ) => {
    if (isDownloadReady(item)) {
      return 'Descargado';
    }
    if (item.status === 'error' || item.syncStatus === 'sync_error') {
      return 'Error';
    }
    if (item.status === 'offline' || item.syncStatus === 'local_only') {
      return 'En cola local';
    }
    if (item.status === 'queued' || item.status === 'processing' || item.status === 'pending' || item.status === 'syncing') {
      return 'Descargando';
    }
    return 'Pendiente';
  };

  return (
    <section className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#EFF4FA]'>Nueva descarga</h1>
        <p className='text-sm text-[#96A0AB]'>Flujo rápido: pega URL, elige MP3 o MP4 y descarga. Lo avanzado queda opcional.</p>
      </div>

      {!online && <OfflineBanner />}

      <article className='rounded-xl border border-[#2A3138] bg-[#10161A] p-4'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Descargando ahora</h2>
          <p className='text-xs text-[#8F99A4]'>{downloadingNow.length} activas</p>
        </div>
        <div className='mt-3 space-y-2'>
          {downloadingNow.map((item) => {
            const pct = progressValue(item);
            return (
              <button
                key={item.localId}
                type='button'
                onClick={() => navigate(`/downloads/${item.localId}`)}
                className='w-full rounded-lg border border-[#252D34] bg-[#151B20] px-3 py-2 text-left hover:border-[#33404A]'
              >
                <div className='flex items-center justify-between gap-2'>
                  <p className='line-clamp-3 text-xs font-semibold text-[#EAF0F7]'>{item.customName ?? item.title}</p>
                  <p className='text-[11px] text-[#A3FF12]'>{pct.toFixed(0)}%</p>
                </div>
                <p className='mt-0.5 line-clamp-1 text-[11px] text-[#8F99A4]'>{item.progressLine || item.sourceUrl}</p>
                <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                  <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${pct}%` }} />
                </div>
                <div className='mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[#9EA8B3]'>
                  <StatusBadge status={item.status} item={item} />
                  {item.progressSpeed && <span>Velocidad: {item.progressSpeed}</span>}
                  {item.progressEta && <span>ETA: {item.progressEta}</span>}
                </div>
              </button>
            );
          })}
          {downloadingNow.length === 0 && (
            <p className='text-xs text-[#8F99A4]'>No hay descargas activas. Cuando encoles una, aparecerá aquí con progreso.</p>
          )}
        </div>
      </article>

      <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Últimos descargados</h2>
        <p className='mt-1 text-xs text-[#95A0AC]'>Tus últimos elementos con portada grande, estado y acciones rápidas.</p>
        <div className='mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          {(recentDownloads ?? []).map((item) => {
            const cover = resolveDownloadCover(item);
            const title = item.customName ?? item.title;
            const tags = item.tags.slice(0, 4);
            const downloadUrl = isDownloadReady(item) ? buildDownloadUrl(item) : null;
            return (
              <article
                key={item.localId}
                className='overflow-hidden rounded-xl border border-[#252C33] bg-[#151B20] text-left hover:border-[#36404A]'
              >
                <div className='h-40 w-full overflow-hidden border-b border-[#232A31] bg-[#0F1317]'>
                  {cover ? (
                    <img src={cover} alt={title} className='h-full w-full object-cover' />
                  ) : (
                    <div className='grid h-full place-items-center text-xs text-[#6E7782]'>Sin portada</div>
                  )}
                </div>
                <div className='space-y-2 p-3'>
                  <p className='line-clamp-3 min-h-[3.4rem] text-sm font-semibold text-[#EAF0F7]'>{title}</p>
                  <p className='text-[11px] text-[#8F99A4]'>{item.mediaKind.toUpperCase()} • {describeState(item)}</p>
                  <div>
                    <StatusBadge status={item.status} item={item} />
                  </div>
                  {tags.length > 0 && (
                    <div className='flex flex-wrap gap-1'>
                      {tags.map((tag) => (
                        <span
                          key={`${item.localId}-${tag}`}
                          className='rounded-full border border-[#3A434C] bg-[#1B2127] px-2 py-0.5 text-[10px] text-[#C6CFDA]'
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.error && (
                    <p className='rounded-md border border-[#5A2028] bg-[#2A1316] p-2 text-[10px] leading-4 text-[#FF9EA6] line-clamp-3'>
                      {item.error}
                    </p>
                  )}
                  <div className='grid grid-cols-2 gap-2 border-t border-[#232A31] pt-2'>
                    <button
                      type='button'
                  onClick={() =>
                        setForm((s) => ({
                          ...s,
                          url: item.sourceUrl,
                          downloadType:
                            item.type === 'audio_mp3' || item.type === 'video_mp4'
                              ? item.type
                              : item.mediaKind === 'video'
                                ? 'video_mp4'
                                : 'audio_mp3',
                          videoQuality: item.mediaKind === 'video' ? (normalizeVideoQuality(item.videoQuality) || s.videoQuality) : s.videoQuality,
                          audioQuality: item.mediaKind === 'audio' ? (normalizeAudioQuality(item.audioQuality) || s.audioQuality) : s.audioQuality,
                          customName: item.customName ?? item.title,
                          tags: item.tags.join(', '),
                        }))
                      }
                      className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-[11px] font-medium text-[#F7E733]'
                    >
                      Usar
                    </button>
                    <button
                      type='button'
                      onClick={() => void playRecent(item.localId, item.mediaKind)}
                      className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 text-[11px] font-medium text-[#A3FF12]'
                    >
                      <Play size={10} />
                      Reproducir {item.mediaKind === 'audio' ? 'MP3' : 'MP4'}
                    </button>
                    {item.mediaKind === 'video' && (
                      <button
                        type='button'
                        onClick={() => void playRecent(item.localId, 'audio')}
                        className='col-span-2 h-8 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-[11px] font-medium text-[#F7E733]'
                      >
                        Reproducir solo audio
                      </button>
                    )}
                    <button
                      type='button'
                      onClick={() => void queueRecentAgain(item.localId)}
                      className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#3C444C] bg-[#1A2026] px-2 text-[11px] font-medium text-[#D4DCE6]'
                    >
                      <RotateCcw size={10} />
                      Descargar otra vez
                    </button>
                    <button
                      type='button'
                      onClick={() => void deleteRecentItem(item)}
                      className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-[11px] font-medium text-[#FFB7BD]'
                    >
                      <Trash2 size={10} />
                      Eliminar
                    </button>
                    {downloadUrl && (
                      <a
                        href={downloadUrl}
                        download
                        className='col-span-2 inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 text-[11px] font-medium text-[#A3FF12]'
                      >
                        Descargar a PC
                      </a>
                    )}
                    <button
                      type='button'
                      onClick={() => navigate(`/downloads/${item.localId}`)}
                      className='col-span-2 h-8 rounded-md border border-[#37404A] bg-[#161C22] px-2 text-[11px] font-medium text-[#D4DCE6]'
                    >
                      Abrir detalle
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {(recentDownloads ?? []).length === 0 && (
            <p className='text-xs text-[#8F99A4]'>Todavía no hay descargas registradas.</p>
          )}
        </div>
      </article>

      <form onSubmit={handleSubmit} className='grid gap-4 xl:grid-cols-[1fr_320px]'>
        <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
          <div className='mb-4 rounded-lg border border-[#2A3138] bg-[#151B20] p-3'>
            <p className='text-xs uppercase tracking-[0.08em] text-[#F7E733]'>Búsqueda centralizada</p>
            <p className='mt-1 text-sm text-[#C5CED9]'>
              Usa el buscador principal de arriba para buscar y filtrar entre tu biblioteca y YouTube.
            </p>
            <Link
              to='/search'
              className='mt-2 inline-flex rounded-md border border-[#2F5B2B] bg-[#182516] px-3 py-1 text-xs font-semibold text-[#A3FF12]'
            >
              Abrir resultados de búsqueda
            </Link>
          </div>

          <label className='text-xs uppercase tracking-[0.08em] text-[#8C97A2]'>URL origen</label>
          <input
            required
            value={form.url}
            onChange={(event) => setForm((s) => ({ ...s, url: event.target.value }))}
            placeholder='https://youtube.com/...'
            className='mt-2 h-12 w-full rounded-lg border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4] outline-none focus:border-[#2F5B2B] focus:shadow-[0_0_0_1px_rgba(163,255,18,.3)]'
          />

          <div className='mt-3 grid gap-2 sm:grid-cols-2'>
            <button
              type='button'
              onClick={() => setForm((s) => ({ ...s, downloadType: 'audio_mp3' }))}
              className={`h-10 rounded-lg border text-sm font-semibold transition ${
                form.downloadType === 'audio_mp3'
                  ? 'border-[#2F5B2B] bg-[#182516] text-[#A3FF12] shadow-[0_0_14px_rgba(163,255,18,.14)]'
                  : 'border-[#353C43] bg-[#1A2026] text-[#AEB7C2] hover:border-[#6B6420]'
              }`}
            >
              MP3 rápido
            </button>
            <button
              type='button'
              onClick={() => setForm((s) => ({ ...s, downloadType: 'video_mp4' }))}
              className={`h-10 rounded-lg border text-sm font-semibold transition ${
                form.downloadType === 'video_mp4'
                  ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                  : 'border-[#353C43] bg-[#1A2026] text-[#AEB7C2] hover:border-[#6B6420]'
              }`}
            >
              MP4 rápido
            </button>
          </div>

          <div className='mt-4 grid gap-3 md:grid-cols-2'>
            <FieldSelect
              label='Tipo de descarga'
              value={form.downloadType}
              options={visibleDownloadTypes.map((opt) => ({ value: opt.value, label: opt.label }))}
              onChange={(value) => setForm((s) => ({ ...s, downloadType: value }))}
            />
            <FieldSelect
              label='Calidad de video'
              value={form.videoQuality}
              options={qualityOptions.map((opt) => ({
                value: opt,
                label: opt === 'best' ? 'Mejor disponible' : opt,
              }))}
              onChange={(value) => setForm((s) => ({ ...s, videoQuality: value }))}
            />
            <FieldSelect
              label='Calidad de audio'
              value={form.audioQuality}
              options={audioQualityOptions.map((opt) => ({
                value: opt,
                label: opt === 'best' ? 'Mejor disponible' : opt,
              }))}
              onChange={(value) => setForm((s) => ({ ...s, audioQuality: value }))}
            />
            <FieldSelect
              label='Colección destino'
              value={form.collectionId}
              options={[
                { value: '', label: 'Descargas (por defecto)' },
                ...(collections ?? []).map((item) => ({ value: item.localId, label: item.name })),
              ]}
              onChange={(value) => setForm((s) => ({ ...s, collectionId: value }))}
            />
          </div>

          <button
            type='button'
            onClick={() =>
              setShowAdvanced((prev) => {
                const next = !prev;
                if (!next && form.downloadType !== 'audio_mp3' && form.downloadType !== 'video_mp4') {
                  setForm((s) => ({ ...s, downloadType: 'audio_mp3' }));
                }
                return next;
              })
            }
            className='mt-4 inline-flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-[#A3FF12]'
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Opciones avanzadas
          </button>

          {showAdvanced && (
            <>
              <div className='mt-4 grid gap-3 md:grid-cols-2'>
                <FieldInput
                  label='Etiquetas'
                  value={form.tags}
                  onChange={(value) => {
                    setMainTagsTouched(true);
                    setForm((s) => ({ ...s, tags: value }));
                  }}
                  placeholder='musica, chill, curso'
                />
                <FieldInput
                  label='Nombre personalizado'
                  value={form.customName}
                  onChange={(value) => {
                    setForm((s) => {
                      const next = { ...s, customName: value };
                      if (!mainTagsTouched) {
                        next.tags = generateTagsFromName(value);
                      }
                      return next;
                    });
                  }}
                  placeholder='Nombre interno'
                />
              </div>

              <div className='mt-4 grid gap-3 md:grid-cols-2'>
                <FieldInput
                  label='Nota opcional'
                  value={form.note}
                  onChange={(value) => setForm((s) => ({ ...s, note: value }))}
                  placeholder='Comentario técnico'
                />
                <FieldSelect
                  label='Idioma subtítulos'
                  value={form.subtitleLanguage}
                  options={[
                    { value: 'es', label: 'Español' },
                    { value: 'en', label: 'English' },
                    { value: 'fr', label: 'Français' },
                  ]}
                  onChange={(value) => setForm((s) => ({ ...s, subtitleLanguage: value }))}
                />
              </div>

              <div className='mt-4 grid gap-3 md:grid-cols-3'>
                <Toggle
                  label='Subtítulos'
                  checked={form.subtitleEnabled}
                  onToggle={() => setForm((s) => ({ ...s, subtitleEnabled: !s.subtitleEnabled }))}
                />
                <Toggle
                  label='Guardar miniatura'
                  checked={form.saveThumbnail}
                  onToggle={() => setForm((s) => ({ ...s, saveThumbnail: !s.saveThumbnail }))}
                />
                <Toggle
                  label='Guardar metadata'
                  checked={form.saveMetadata}
                  onToggle={() => setForm((s) => ({ ...s, saveMetadata: !s.saveMetadata }))}
                />
              </div>
            </>
          )}

          <button
            type='submit'
            className='mt-5 h-11 rounded-lg border border-[#2F5B2B] bg-[#182516] px-5 text-sm font-semibold text-[#A3FF12] shadow-[0_0_18px_rgba(163,255,18,.14)] transition hover:bg-[#1F2E1C]'
          >
            {online ? 'Descargar ahora' : 'Guardar en cola local'}
          </button>
        </article>

        <aside className='h-fit rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Resumen técnico</h2>
          <ul className='mt-3 space-y-2 text-sm text-[#BCC5D0]'>
            <li>Tipo: <span className='text-[#F2F6FB]'>{form.downloadType}</span></li>
            <li>Video: <span className='text-[#F2F6FB]'>{form.videoQuality}</span></li>
            <li>Audio: <span className='text-[#F2F6FB]'>{form.audioQuality}</span></li>
            <li>Subtítulos: <span className='text-[#F2F6FB]'>{form.subtitleEnabled ? form.subtitleLanguage : 'off'}</span></li>
            <li>Destino: <span className='text-[#F2F6FB]'>{selectedCollectionName}</span></li>
          </ul>

          {!online && (
            <div className='mt-4 rounded-lg border border-[#6B6420] bg-[#2B2B16] p-3 text-xs text-[#F7E733]'>
              <CloudOff size={14} className='mr-1 inline' />
              Se guardará en cola local pendiente de sincronización.
            </div>
          )}

          {saved && (
            <div className='mt-4 rounded-lg border border-[#2F5B2B] bg-[#132016] p-3 text-xs text-[#A3FF12]'>
              <CheckCircle2 size={14} className='mr-1 inline' />
              Solicitud registrada correctamente.
            </div>
          )}

          <div className='mt-4 rounded-lg border border-[#6B6420] bg-[#2B2B16] p-3 text-xs text-[#F7E733]'>
            <AlertTriangle size={14} className='mr-1 inline' />
            Solo gestiona contenido con derechos legítimos de descarga y reproducción.
          </div>
        </aside>
      </form>
    </section>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className='block'>
      <span className='text-xs uppercase tracking-[0.08em] text-[#8C97A2]'>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='mt-2 h-11 w-full rounded-lg border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4]'
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className='block'>
      <span className='text-xs uppercase tracking-[0.08em] text-[#8C97A2]'>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className='mt-2 h-11 w-full rounded-lg border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4]'
      />
    </label>
  );
}

function Toggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      onClick={onToggle}
      className={`rounded-lg border px-3 py-2 text-xs uppercase tracking-[0.08em] ${
        checked
          ? 'border-[#2F5B2B] bg-[#162016] text-[#A3FF12]'
          : 'border-[#353C43] bg-[#1A2026] text-[#AEB7C2]'
      }`}
    >
      {label}
    </button>
  );
}
