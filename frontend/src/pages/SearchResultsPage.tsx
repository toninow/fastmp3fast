import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Play, Search, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db/database';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { apiEndpoints } from '../lib/api/endpoints';
import type { DownloadItem, YoutubeSearchItem } from '../types/models';
import { audioQualityOptions, qualityOptions } from '../data/downloadTypes';
import { buildTrack } from '../lib/playerTrack';
import { usePlayerStore } from '../store/playerStore';
import { buildDownloadUrl, isDownloadReady } from '../lib/mediaAccess';
import { useUiStore } from '../store/uiStore';
import { enqueueOperation, processPendingOperations, refreshDownloadsFromBackend } from '../lib/offline/syncQueue';
import { formatDuration } from '../lib/format';
import { getYoutubeCoverFromUrl, resolveDownloadCover } from '../lib/covers';

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

interface RemoteQualityProbe {
  loading: boolean;
  error: string | null;
  videoQualities: string[];
  maxVideoHeight: number | null;
  has2k: boolean;
  has4k: boolean;
}

export function SearchResultsPage() {
  const REMOTE_LIMIT_STEP = 10;
  const REMOTE_LIMIT_MAX = 25;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const pushToast = useUiStore((state) => state.pushNotification);
  const setGlobalSearch = useUiStore((state) => state.setSearch);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const initialQuery = (searchParams.get('q') ?? '').trim();
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [scope, setScope] = useState<'all' | 'local' | 'remote'>('all');
  const [localFilter, setLocalFilter] = useState<'all' | 'downloaded' | 'pending'>('all');
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteResults, setRemoteResults] = useState<YoutubeSearchItem[]>([]);
  const [remoteLimit, setRemoteLimit] = useState<number>(REMOTE_LIMIT_STEP);
  const remoteLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [remoteVideoQuality, setRemoteVideoQuality] = useState<string>('best');
  const [remoteAudioQuality, setRemoteAudioQuality] = useState<string>('best');
  const [remoteQualityByUrl, setRemoteQualityByUrl] = useState<Record<string, RemoteQualityProbe>>({});

  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const recentDownloads = useLiveQuery(() => db.downloads.orderBy('createdAt').reverse().limit(8).toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);
  const isDownloadInFlight = (row: DownloadItem) => ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(row.status);
  const getProgress = (row: DownloadItem) => Math.max(0, Math.min(100, Number(row.progressPercent ?? (isDownloadInFlight(row) ? 8 : 0))));
  const statusTone = (item: DownloadItem) => {
    if (item.status === 'error') {
      return 'border-[#5A2028] bg-[#2A1316] text-[#FFB7BD]';
    }
    if (isDownloadReady(item)) {
      return 'border-[#2F5B2B] bg-[#162516] text-[#A3FF12]';
    }
    if (isDownloadInFlight(item)) {
      return 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]';
    }
    return 'border-[#3B424A] bg-[#171D22] text-[#AAB3BE]';
  };

  useEffect(() => {
    setQueryInput(initialQuery);
    setGlobalSearch(initialQuery);
  }, [initialQuery, setGlobalSearch]);

  useEffect(() => {
    setRemoteLimit(REMOTE_LIMIT_STEP);
    setRemoteQualityByUrl({});
  }, [initialQuery]);

  const localResults = useMemo(() => {
    const q = initialQuery.toLowerCase();
    const rows = downloads ?? [];
    if (!q) {
      return [];
    }

    return rows.filter((item) => {
      const haystack = [
        item.title,
        item.customName ?? '',
        item.uploader ?? '',
        item.sourceUrl,
        item.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [downloads, initialQuery]);

  const filteredLocalResults = useMemo(() => {
    if (localFilter === 'downloaded') {
      return localResults.filter((item) => isDownloadReady(item));
    }
    if (localFilter === 'pending') {
      return localResults.filter((item) => !isDownloadReady(item) && isDownloadInFlight(item));
    }
    return localResults;
  }, [localResults, localFilter]);

  const existingByRemoteUrl = useMemo(() => {
    const map = new Map<string, DownloadItem>();
    for (const row of downloads ?? []) {
      const key = normalizeSourceUrl(row.sourceUrl);
      if (!key) {
        continue;
      }
      const current = map.get(key);
      if (!current) {
        map.set(key, row);
        continue;
      }
      const rowWeight = isDownloadReady(row) ? 3 : isDownloadInFlight(row) ? 2 : row.status === 'error' ? 0 : 1;
      const currentWeight = isDownloadReady(current) ? 3 : isDownloadInFlight(current) ? 2 : current.status === 'error' ? 0 : 1;
      if (rowWeight > currentWeight || (rowWeight === currentWeight && row.createdAt > current.createdAt)) {
        map.set(key, row);
      }
    }
    return map;
  }, [downloads]);

  useEffect(() => {
    const q = initialQuery.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteError(null);
      setLoadingRemote(false);
      return;
    }

    if (!online) {
      setRemoteResults([]);
      setRemoteError('Sin conexión: se muestran solo resultados locales.');
      setLoadingRemote(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoadingRemote(true);
      setRemoteError(null);
      try {
        const response = await apiEndpoints.youtubeSearch(q, remoteLimit);
        if (cancelled) {
          return;
        }

        const payload = (response?.data ?? response) as { success?: boolean; results?: YoutubeSearchItem[]; error?: string };
        const success = Boolean(payload?.success);
        const rows = payload?.results;
        if (!success) {
          const detail = payload?.error;
          setRemoteResults([]);
          setRemoteError(detail ? String(detail) : 'No se pudo consultar YouTube.');
          return;
        }

        setRemoteResults(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Error de búsqueda remota.';
        setRemoteResults([]);
        setRemoteError(message);
      } finally {
        if (!cancelled) {
          setLoadingRemote(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [initialQuery, online, remoteLimit]);

  useEffect(() => {
    if (!online || !initialQuery.trim()) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshDownloadsFromBackend();
    }, 7000);
    return () => window.clearInterval(timer);
  }, [online, initialQuery]);

  const canLoadMoreRemote =
    Boolean(initialQuery.trim()) &&
    online &&
    !loadingRemote &&
    !remoteError &&
    remoteLimit < REMOTE_LIMIT_MAX &&
    remoteResults.length >= remoteLimit;

  useEffect(() => {
    if (!canLoadMoreRemote || !remoteLoadMoreRef.current || (scope !== 'all' && scope !== 'remote')) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setRemoteLimit((current) => Math.min(current + REMOTE_LIMIT_STEP, REMOTE_LIMIT_MAX));
        }
      },
      { root: null, threshold: 0.05, rootMargin: '240px 0px 240px 0px' }
    );

    observer.observe(remoteLoadMoreRef.current);
    return () => observer.disconnect();
  }, [canLoadMoreRemote, scope]);

  const submitQuery = (event: React.FormEvent) => {
    event.preventDefault();
    const value = queryInput.trim();
    setGlobalSearch(value);
    setSearchParams(value ? { q: value } : {});
  };

  const playLocalItem = (item: DownloadItem) => {
    const subtitleRows = (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId);
    const track = buildTrack(item, subtitleRows);
    const appearsReady = isDownloadReady(item);
    if (!appearsReady) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Archivo no disponible',
        body: 'Este elemento no tiene MP3/MP4 listo todavía.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    playTrack(track);
  };

  const deleteLocalItem = async (item: DownloadItem) => {
    const label = item.customName ?? item.title;
    const confirmed = window.confirm(`¿Eliminar "${label}" de la biblioteca?`);
    if (!confirmed) {
      return;
    }

    try {
      await apiEndpoints.deleteDownloadByLocal(item.localId);
    } catch {
      // local-first fallback
    }

    try {
      await db.transaction(
        'rw',
        [db.downloads, db.subtitles, db.playbackProgress, db.recentActivity, db.offlineMedia, db.offlineSubtitles, db.collections],
        async () => {
          await db.downloads.where('localId').equals(item.localId).delete();
          await db.subtitles.where('downloadLocalId').equals(item.localId).delete();
          await db.playbackProgress.where('downloadLocalId').equals(item.localId).delete();
          await db.offlineMedia.where('downloadLocalId').equals(item.localId).delete();
          await db.offlineSubtitles.where('downloadLocalId').equals(item.localId).delete();

          const activityRows = await db.recentActivity.toArray();
          const activityIdsToDelete = activityRows
            .filter((row) => row.entityLocalId === item.localId && typeof row.id === 'number')
            .map((row) => row.id as number);
          if (activityIdsToDelete.length > 0) {
            await db.recentActivity.bulkDelete(activityIdsToDelete);
          }

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
        body: `"${label}" se eliminó de tu biblioteca local.`,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'No se pudo eliminar',
        body: error instanceof Error ? error.message : 'Error local al eliminar.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const loadRemoteQualities = async (item: YoutubeSearchItem) => {
    if (!online) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Sin conexión',
        body: 'Conéctate a internet para detectar versiones (2K/4K).',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const key = normalizeSourceUrl(item.webpage_url);
    if (!key) {
      return;
    }

    const current = remoteQualityByUrl[key];
    if (current?.loading) {
      return;
    }

    setRemoteQualityByUrl((prev) => ({
      ...prev,
      [key]: {
        loading: true,
        error: null,
        videoQualities: prev[key]?.videoQualities ?? [],
        maxVideoHeight: prev[key]?.maxVideoHeight ?? null,
        has2k: prev[key]?.has2k ?? false,
        has4k: prev[key]?.has4k ?? false,
      },
    }));

    try {
      const response = await apiEndpoints.downloadFormats(item.webpage_url);
      const payload = (response?.data ?? response) as {
        success?: boolean;
        stderr?: string;
        video_qualities?: string[];
        max_video_height?: number | null;
        has_2k?: boolean;
        has_4k?: boolean;
      };

      const isSuccess = Boolean(payload?.success);
      if (!isSuccess) {
        const error = payload?.stderr ? String(payload.stderr).slice(0, 280) : 'No se pudieron detectar formatos.';
        setRemoteQualityByUrl((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error,
            videoQualities: [],
            maxVideoHeight: null,
            has2k: false,
            has4k: false,
          },
        }));
        return;
      }

      const qualities = Array.isArray(payload?.video_qualities)
        ? payload.video_qualities
            .map((entry) => String(entry))
            .filter((entry) => /^\d{3,4}p$/i.test(entry))
            .sort((a, b) => Number(b.replace('p', '')) - Number(a.replace('p', '')))
        : [];
      const maxVideoHeight = typeof payload?.max_video_height === 'number' ? payload.max_video_height : null;
      const has2k = Boolean(payload?.has_2k || qualities.includes('1440p'));
      const has4k = Boolean(payload?.has_4k || qualities.some((entry) => Number(entry.replace('p', '')) >= 2160));

      setRemoteQualityByUrl((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          error: null,
          videoQualities: qualities,
          maxVideoHeight,
          has2k,
          has4k,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron detectar formatos.';
      setRemoteQualityByUrl((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          error: message,
          videoQualities: [],
          maxVideoHeight: null,
          has2k: false,
          has4k: false,
        },
      }));
    }
  };

  useEffect(() => {
    if (!online || remoteResults.length === 0) {
      return;
    }

    const targets = remoteResults
      .slice(0, 6)
      .filter((item) => {
        const key = normalizeSourceUrl(item.webpage_url);
        if (!key) {
          return false;
        }
        const known = remoteQualityByUrl[key];
        return !known || (!known.loading && known.videoQualities.length === 0 && !known.error);
      })
      .slice(0, 2);

    if (targets.length === 0) {
      return;
    }

    targets.forEach((item) => {
      void loadRemoteQualities(item);
    });
  }, [online, remoteResults, remoteQualityByUrl]);

  const queueYoutubeResult = async (item: YoutubeSearchItem, type: 'audio_mp3' | 'video_mp4') => {
    const duplicate = (downloads ?? []).find((row) => {
      if (row.type !== type) {
        return false;
      }
      if (!isDownloadInFlight(row)) {
        return false;
      }
      if (type === 'video_mp4') {
        const existing = normalizeVideoQuality(row.videoQuality);
        const requested = normalizeVideoQuality(remoteVideoQuality);
        if (!existing || (requested && existing !== requested)) {
          return false;
        }
      }
      if (type === 'audio_mp3') {
        const existing = normalizeAudioQuality(row.audioQuality);
        const requested = normalizeAudioQuality(remoteAudioQuality);
        if (!existing || (requested && existing !== requested)) {
          return false;
        }
      }
      return normalizeSourceUrl(row.sourceUrl) === normalizeSourceUrl(item.webpage_url);
    });

    if (duplicate) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Ya existe en tu biblioteca',
        body: `${duplicate.customName ?? duplicate.title} (${isDownloadReady(duplicate) ? 'descargado' : 'en cola'})`,
        createdAt: new Date().toISOString(),
      });
      navigate(`/downloads/${duplicate.localId}`);
      return;
    }

    const localId = `dl-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    try {
      const normalizedVideoQuality = type === 'video_mp4' ? (remoteVideoQuality === 'best' ? null : remoteVideoQuality) : null;
      const normalizedAudioQuality = type === 'audio_mp3' ? (remoteAudioQuality === 'best' ? null : remoteAudioQuality) : null;

      await db.downloads.add({
        localId,
        title: item.title || 'Nueva descarga',
        customName: item.title || null,
        type,
        mediaKind: type.includes('audio') ? 'audio' : 'video',
        status: online ? 'queued' : 'offline',
        sourceUrl: item.webpage_url,
        uploader: item.uploader ?? null,
        durationSeconds: item.duration_seconds ?? null,
        createdAt,
        downloadedAt: null,
        tags: ['search'],
        collectionId: null,
        notes: `Creado desde búsqueda global: ${initialQuery}`,
        subtitleLanguages: [],
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

      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'create',
        entityType: 'download',
        entityLocalId: localId,
        payload: {
          local_uid: localId,
          url: item.webpage_url,
          download_type: type,
          video_quality: normalizedVideoQuality,
          audio_quality: normalizedAudioQuality,
          custom_name: item.title || null,
          collection_id: null,
          tags: ['search', type.includes('video') ? `video-${normalizedVideoQuality}` : `audio-${normalizedAudioQuality}`],
          note: `Creado desde búsqueda global: ${initialQuery} • video=${normalizedVideoQuality ?? 'n/a'} • audio=${normalizedAudioQuality ?? 'n/a'}`,
          subtitle_enabled: false,
          subtitle_language: 'es',
          save_thumbnail: true,
          save_metadata: true,
          is_offline_queued: !online,
        },
      });

      if (online) {
        try {
          await processPendingOperations();
          await refreshDownloadsFromBackend();
        } catch {
          // sync engine will retry
        }
      }

      pushToast({
        id: crypto.randomUUID(),
        title: type === 'audio_mp3' ? 'MP3 en cola' : 'MP4 en cola',
        body: online ? 'Enviado al backend para descarga.' : 'Guardado en cola local offline.',
        createdAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo encolar la descarga.';
      pushToast({
        id: crypto.randomUUID(),
        title: 'Error al descargar',
        body: message,
        createdAt: new Date().toISOString(),
      });
    }
  };

  return (
    <section className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#EFF4FA]'>Resultados de búsqueda</h1>
        <p className='text-sm text-[#96A0AB]'>Busca en tu biblioteca y en YouTube para descargar o reproducir al instante.</p>
      </div>

      <form onSubmit={submitQuery} className='flex flex-col gap-2 sm:flex-row'>
        <div className='flex h-11 flex-1 items-center rounded-lg border border-[#2A3036] bg-[#14191E] px-3'>
          <Search size={16} className='text-[#8D96A1]' />
          <input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder='Escribe artista, canción o video...'
            className='ml-2 w-full bg-transparent text-sm text-[#E5E9EF] outline-none placeholder:text-[#6C7580]'
          />
        </div>
        <button
          type='submit'
          className='h-11 rounded-lg border border-[#2F5B2B] bg-[#182516] px-4 text-sm font-semibold text-[#A3FF12]'
        >
          Buscar
        </button>
      </form>

      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          onClick={() => setScope('all')}
          className={`rounded-md border px-3 py-1 text-xs uppercase tracking-[0.08em] ${
            scope === 'all' ? 'border-[#2F5B2B] bg-[#182516] text-[#A3FF12]' : 'border-[#353C43] bg-[#161C21] text-[#AFB8C3]'
          }`}
        >
          Todo
        </button>
        <button
          type='button'
          onClick={() => setScope('local')}
          className={`rounded-md border px-3 py-1 text-xs uppercase tracking-[0.08em] ${
            scope === 'local' ? 'border-[#2F5B2B] bg-[#182516] text-[#A3FF12]' : 'border-[#353C43] bg-[#161C21] text-[#AFB8C3]'
          }`}
        >
          Ya descargadas
        </button>
        <button
          type='button'
          onClick={() => setScope('remote')}
          className={`rounded-md border px-3 py-1 text-xs uppercase tracking-[0.08em] ${
            scope === 'remote' ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]' : 'border-[#353C43] bg-[#161C21] text-[#AFB8C3]'
          }`}
        >
          Buscar en YouTube
        </button>
      </div>

      {!initialQuery && (
        <article className='surface-card p-4'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Últimos descargados</h2>
          <p className='mt-1 text-xs text-[#96A0AB]'>Acceso rápido por defecto sin tener que buscar.</p>
          <div className='mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
            {(recentDownloads ?? []).map((item) => {
              const cover = resolveDownloadCover(item);
              return (
                <button
                  key={item.localId}
                  type='button'
                  onClick={() => navigate(`/downloads/${item.localId}`)}
                  className='flex items-center gap-2 rounded-lg border border-[#252C33] bg-[#151B20] p-2 text-left hover:border-[#37404A]'
                >
                  <div className='h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[#2A3138] bg-[#0F1317]'>
                    {cover ? (
                      <img src={cover} alt={item.title} className='h-full w-full object-cover' />
                    ) : (
                      <div className='grid h-full place-items-center text-[10px] text-[#6E7782]'>Sin portada</div>
                    )}
                  </div>
                  <div className='min-w-0'>
                    <p className='line-clamp-3 text-xs font-semibold text-[#E6EBF3]'>{item.customName ?? item.title}</p>
                    <p className='text-[11px] text-[#8D96A1]'>{item.mediaKind.toUpperCase()} • {item.status}</p>
                  </div>
                </button>
              );
            })}
            {(recentDownloads ?? []).length === 0 && (
              <p className='text-xs text-[#94A0AC]'>Aún no hay descargas registradas.</p>
            )}
          </div>
        </article>
      )}

      {initialQuery && (
        <div className='grid gap-4 xl:grid-cols-2'>
          {(scope === 'all' || scope === 'local') && (
          <article className='surface-card p-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Biblioteca local ({filteredLocalResults.length})</h2>
              <div className='flex flex-wrap gap-1'>
                <button
                  type='button'
                  onClick={() => setLocalFilter('all')}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    localFilter === 'all'
                      ? 'border-[#2F5B2B] bg-[#182516] text-[#A3FF12]'
                      : 'border-[#3B424A] bg-[#171D22] text-[#AAB3BE]'
                  }`}
                >
                  Todas
                </button>
                <button
                  type='button'
                  onClick={() => setLocalFilter('downloaded')}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    localFilter === 'downloaded'
                      ? 'border-[#2F5B2B] bg-[#182516] text-[#A3FF12]'
                      : 'border-[#3B424A] bg-[#171D22] text-[#AAB3BE]'
                  }`}
                >
                  Descargadas
                </button>
                <button
                  type='button'
                  onClick={() => setLocalFilter('pending')}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    localFilter === 'pending'
                      ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                      : 'border-[#3B424A] bg-[#171D22] text-[#AAB3BE]'
                  }`}
                >
                  En cola
                </button>
              </div>
            </div>
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {filteredLocalResults.map((item) => {
                const downloadUrl = buildDownloadUrl(item);
                const cover = resolveDownloadCover(item);
                const canPlay = isDownloadReady(item);
                const isPending = isDownloadInFlight(item) && !canPlay;
                const progress = getProgress(item);
                const title = item.customName ?? item.title;
                const tags = item.tags.slice(0, 4);
                return (
                  <div
                    key={item.localId}
                    className='overflow-hidden rounded-xl border border-[#252C33] bg-[linear-gradient(180deg,#151B20_0%,#12171C_100%)] shadow-[0_12px_28px_rgba(0,0,0,0.28)]'
                  >
                    <div className='h-40 w-full overflow-hidden border-b border-[#242B32] bg-[#0F1317]'>
                      {cover ? (
                        <img src={cover} alt={title} className='h-full w-full object-cover' />
                      ) : (
                        <div className='grid h-full place-items-center text-xs text-[#6E7782]'>Sin portada</div>
                      )}
                    </div>

                    <div className='space-y-2 p-3'>
                      <div className='flex flex-wrap items-start justify-between gap-2'>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${statusTone(item)}`}>
                          {item.status}
                        </span>
                        <span className='rounded-full border border-[#343C45] bg-[#191F25] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#D2DBE5]'>
                          {item.mediaKind}
                        </span>
                      </div>

                      <div className='min-w-0 space-y-1'>
                        <p className='line-clamp-3 min-h-[3.4rem] text-sm font-semibold text-[#E6EBF3]'>{title}</p>
                        <p className='text-xs text-[#8D96A1]'>
                          {item.uploader ?? 'Canal desconocido'}
                          {item.durationSeconds ? ` • ${formatDuration(item.durationSeconds)}` : ''}
                        </p>
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

                      {isPending && (
                        <div className='rounded border border-[#2A323A] bg-[#141A1F] p-2'>
                          <div className='flex items-center justify-between gap-2'>
                            <span className='line-clamp-1 text-[11px] text-[#9AA4AF]'>{item.progressLine || 'Descargando...'}</span>
                            <span className='text-[11px] font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
                          </div>
                          <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                            <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      )}

                      <div className='grid grid-cols-1 gap-2 border-t border-[#242B32] pt-2 sm:grid-cols-2'>
                        <button
                          type='button'
                          onClick={() => canPlay && playLocalItem(item)}
                          disabled={!canPlay}
                          className={`inline-flex h-8 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-medium ${
                            canPlay
                              ? 'border-[#2F5B2B] bg-[#162516] text-[#A3FF12]'
                              : 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                          }`}
                          title={canPlay ? 'Reproducir' : item.error ? 'Descarga con error' : 'Aún descargando'}
                        >
                          <Play size={12} /> Reproducir
                        </button>
                        <button
                          type='button'
                          onClick={() => navigate(`/downloads/${item.localId}`)}
                          className='h-8 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-[11px] font-medium text-[#D3DAE3]'
                        >
                          Abrir detalle
                        </button>
                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            download
                            className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 text-[11px] font-medium text-[#A3FF12] sm:col-span-2'
                          >
                            <Download size={12} /> Descargar a PC
                          </a>
                        )}
                        <button
                          type='button'
                          onClick={() => void deleteLocalItem(item)}
                          className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-[11px] font-medium text-[#FFB7BD] sm:col-span-2'
                        >
                          <Trash2 size={12} /> Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredLocalResults.length === 0 && <p className='text-xs text-[#94A0AC]'>Sin coincidencias en tu biblioteca.</p>}
            </div>
          </article>
          )}

          {(scope === 'all' || scope === 'remote') && (
          <article className='surface-card p-4'>
            <div className='flex flex-wrap items-end justify-between gap-3'>
              <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>YouTube ({remoteResults.length})</h2>
              <div className='flex flex-wrap items-end gap-2'>
                <label className='block'>
                  <span className='text-[10px] uppercase tracking-[0.08em] text-[#8E99A5]'>Calidad MP4</span>
                  <select
                    value={remoteVideoQuality}
                    onChange={(event) => setRemoteVideoQuality(event.target.value)}
                    className='mt-1 h-8 rounded-md border border-[#2A3036] bg-[#151A1F] px-2 text-xs text-[#E6ECF4]'
                  >
                    {qualityOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'best' ? 'Mejor disponible' : opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='block'>
                  <span className='text-[10px] uppercase tracking-[0.08em] text-[#8E99A5]'>Calidad MP3</span>
                  <select
                    value={remoteAudioQuality}
                    onChange={(event) => setRemoteAudioQuality(event.target.value)}
                    className='mt-1 h-8 rounded-md border border-[#2A3036] bg-[#151A1F] px-2 text-xs text-[#E6ECF4]'
                  >
                    {audioQualityOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'best' ? 'Mejor disponible' : opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {loadingRemote && <p className='mt-3 text-xs text-[#A3FF12]'>Buscando en YouTube...</p>}
            {remoteError && <p className='mt-3 text-xs text-[#FFB7BD]'>{remoteError}</p>}
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {remoteResults.map((item) => {
                const existing = existingByRemoteUrl.get(normalizeSourceUrl(item.webpage_url));
                const existingReady = Boolean(existing && isDownloadReady(existing));
                const existingPending = Boolean(existing && !existingReady && isDownloadInFlight(existing));
                const progress = existing ? getProgress(existing) : 0;
                const title = item.title || 'Resultado sin título';
                const cover = item.thumbnail || getYoutubeCoverFromUrl(item.webpage_url) || '';
                const qualityKey = normalizeSourceUrl(item.webpage_url);
                const qualityProbe = remoteQualityByUrl[qualityKey];
                const mp4Label =
                  remoteVideoQuality === 'best'
                    ? qualityProbe?.maxVideoHeight
                      ? `Mejor (${qualityProbe.maxVideoHeight}p)`
                      : 'Mejor disponible'
                    : remoteVideoQuality;
                return (
                <div key={`${item.id ?? item.webpage_url}`} className='media-card media-card-hover'>
                  <div className='media-card-cover h-44'>
                    {cover ? (
                      <img src={cover} alt={title} className='h-full w-full object-cover' />
                    ) : (
                      <div className='grid h-full place-items-center text-xs text-[#6E7782]'>Sin portada</div>
                    )}
                  </div>

                  <div className='media-card-body'>
                    <div className='flex flex-wrap items-center gap-2'>
                      {existingReady ? (
                        <span className='rounded-full border border-[#2F5B2B] bg-[#162516] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#A3FF12]'>
                          Ya descargado
                        </span>
                      ) : existingPending ? (
                        <span className='rounded-full border border-[#6B6420] bg-[#2B2B16] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#F7E733]'>
                          En descarga
                        </span>
                      ) : null}
                    </div>

                    <div className='min-w-0'>
                      <p className='line-clamp-3 min-h-[3.6rem] text-sm font-semibold text-[#E6EBF3]'>{title}</p>
                      <p className='text-xs text-[#8D96A1]'>
                        {item.uploader || 'Canal desconocido'} • {formatDuration(item.duration_seconds)}
                      </p>
                    </div>
                  </div>

                  <div className='space-y-2 px-3 pb-3'>
                    <div className='rounded border border-[#2A323A] bg-[#141A1F] p-2'>
                      <div className='flex flex-wrap items-center gap-1'>
                        {qualityProbe?.has4k && (
                          <span className='rounded-full border border-[#2F5B2B] bg-[#162516] px-2 py-0.5 text-[10px] font-medium text-[#A3FF12]'>
                            4K disponible
                          </span>
                        )}
                        {qualityProbe?.has2k && (
                          <span className='rounded-full border border-[#6B6420] bg-[#2B2B16] px-2 py-0.5 text-[10px] font-medium text-[#F7E733]'>
                            2K disponible
                          </span>
                        )}
                        {!qualityProbe && (
                          <span className='text-[11px] text-[#91A0AE]'>Pulsa “Ver versiones” para detectar 2K/4K.</span>
                        )}
                      </div>
                      {qualityProbe?.loading && <p className='mt-1 text-[11px] text-[#A3FF12]'>Detectando versiones…</p>}
                      {qualityProbe?.error && <p className='mt-1 text-[11px] text-[#FFB7BD]'>{qualityProbe.error}</p>}
                      {qualityProbe && !qualityProbe.loading && !qualityProbe.error && (
                        <div className='mt-1'>
                          <p className='text-[10px] uppercase tracking-[0.08em] text-[#8E99A5]'>
                            Versiones: {qualityProbe.videoQualities.length > 0 ? qualityProbe.videoQualities.join(' · ') : 'sin datos'}
                          </p>
                          {qualityProbe.videoQualities.length > 0 && (
                            <div className='mt-1 flex flex-wrap gap-1'>
                              {qualityProbe.videoQualities.slice(0, 7).map((quality) => (
                                <button
                                  key={`${qualityKey}-${quality}`}
                                  type='button'
                                  onClick={() => setRemoteVideoQuality(quality)}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                    remoteVideoQuality === quality
                                      ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                                      : 'border-[#3B4148] bg-[#1A1F24] text-[#C7D1DB]'
                                  }`}
                                >
                                  {quality}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {existingPending && (
                      <div className='rounded border border-[#2A323A] bg-[#141A1F] p-2'>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='line-clamp-1 text-[11px] text-[#9AA4AF]'>{existing?.progressLine || 'Descargando...'}</span>
                          <span className='text-[11px] font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
                        </div>
                        <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                          <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
                        </div>
                        <div className='mt-1 flex flex-wrap gap-2 text-[10px] text-[#8E98A3]'>
                          {existing?.progressSpeed && <span>{existing.progressSpeed}</span>}
                          {existing?.progressEta && <span>ETA {existing.progressEta}</span>}
                        </div>
                      </div>
                    )}
                    <div className='media-card-actions'>
                      <button
                        type='button'
                        onClick={() => void loadRemoteQualities(item)}
                        disabled={Boolean(qualityProbe?.loading)}
                        className={`h-9 rounded-md border px-2 text-xs font-medium ${
                          qualityProbe?.loading
                            ? 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                            : 'border-[#3B4148] bg-[#1A1F24] text-[#D3DAE3] hover:border-[#6B6420] hover:text-[#F7E733]'
                        }`}
                      >
                        {qualityProbe?.loading ? 'Detectando...' : qualityProbe ? 'Actualizar versiones' : 'Ver versiones'}
                      </button>
                      <button
                        type='button'
                        onClick={() => void queueYoutubeResult(item, 'audio_mp3')}
                        disabled={existingPending}
                        className={`h-9 rounded-md border px-2 text-xs font-medium ${
                          existingPending
                            ? 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                            : 'border-[#2F5B2B] bg-[#162516] text-[#A3FF12]'
                        }`}
                      >
                        {existingPending ? 'Descargando...' : `Descargar MP3 (${remoteAudioQuality === 'best' ? 'Mejor disponible' : remoteAudioQuality})`}
                      </button>
                      <button
                        type='button'
                        onClick={() => void queueYoutubeResult(item, 'video_mp4')}
                        disabled={existingPending}
                        className={`h-9 rounded-md border px-2 text-xs font-medium ${
                          existingPending
                            ? 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                            : 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                        }`}
                      >
                        {existingPending ? 'Descargando...' : `Descargar MP4 (${mp4Label})`}
                      </button>
                      {existing && (
                        <button
                          type='button'
                          onClick={() => navigate(`/downloads/${existing.localId}`)}
                          className='h-9 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-xs font-medium text-[#D3DAE3]'
                        >
                          Ver estado
                        </button>
                      )}
                      <a
                        href={item.webpage_url}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-xs font-medium text-[#D3DAE3]'
                      >
                        <ExternalLink size={12} /> Abrir
                      </a>
                    </div>
                  </div>
                </div>
              )})}
              {!loadingRemote && remoteResults.length === 0 && !remoteError && (
                <p className='text-xs text-[#94A0AC]'>Sin resultados remotos para este término.</p>
              )}
            </div>
            {canLoadMoreRemote && (
              <div className='mt-4 flex justify-center'>
                <button
                  type='button'
                  onClick={() => setRemoteLimit((current) => Math.min(current + REMOTE_LIMIT_STEP, REMOTE_LIMIT_MAX))}
                  className='h-10 rounded-md border border-[#3B4148] bg-[#1A1F24] px-4 text-sm font-medium text-[#D3DAE3] hover:border-[#6B6420] hover:text-[#F7E733]'
                >
                  Cargar más resultados
                </button>
              </div>
            )}
            <div ref={remoteLoadMoreRef} className='h-1 w-full' />
          </article>
          )}
        </div>
      )}
    </section>
  );
}
