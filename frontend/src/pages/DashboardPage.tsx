import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { KpiCard } from '../components/common/KpiCard';
import { db } from '../lib/db/database';
import { formatDuration } from '../lib/format';
import { apiEndpoints } from '../lib/api/endpoints';
import { useAuthStore } from '../store/authStore';
import type { DownloadItem, RecommendationItem } from '../types/models';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useUiStore } from '../store/uiStore';
import { enqueueOperation, processPendingOperations, refreshDownloadsFromBackend } from '../lib/offline/syncQueue';
import { getYoutubeCoverFromUrl } from '../lib/covers';

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

function isDownloadInFlight(row: DownloadItem): boolean {
  return ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(row.status);
}

export function DashboardPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const pushToast = useUiStore((state) => state.pushNotification);
  const user = useAuthStore((state) => state.user);
  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const activity = useLiveQuery(() => db.recentActivity.orderBy('createdAt').reverse().limit(8).toArray(), []);
  const syncQueue = useLiveQuery(
    () => db.pendingOperations.where('status').anyOf('pending', 'error').reverse().sortBy('createdAt'),
    []
  );
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [recommendationVideoQuality, setRecommendationVideoQuality] = useState<string>('best');
  const [recommendationAudioQuality, setRecommendationAudioQuality] = useState<string>('best');
  const [recommendationActionMap, setRecommendationActionMap] = useState<Record<string, boolean>>({});
  const [hiddenRecommendationKeys, setHiddenRecommendationKeys] = useState<string[]>([]);
  const [adminGlobal, setAdminGlobal] = useState<Array<Record<string, unknown>>>([]);
  const [adminUsers, setAdminUsers] = useState<Array<{ id: number; username: string; downloads_count: number }>>([]);
  const hiddenRecommendationStorageKey = useMemo(
    () => `fastmp3fast.hiddenRecommendations.${user?.id ?? 'guest'}`,
    [user?.id]
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rec = await apiEndpoints.recommendations(8);
        if (active) {
          const rows = rec?.data?.results;
          setRecommendations(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (active) {
          setRecommendations([]);
        }
      }

      if (user?.is_admin) {
        try {
          const [globalDownloads, users] = await Promise.all([
            apiEndpoints.downloads({ scope: 'all', q: '', status: '' }),
            apiEndpoints.users(),
          ]);
          if (active) {
            const rows = globalDownloads?.data?.data;
            setAdminGlobal(Array.isArray(rows) ? rows : []);
            setAdminUsers(Array.isArray(users?.data) ? users.data : []);
          }
        } catch {
          if (active) {
            setAdminGlobal([]);
            setAdminUsers([]);
          }
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [user?.id, user?.is_admin]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(hiddenRecommendationStorageKey);
      if (!raw) {
        setHiddenRecommendationKeys([]);
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      setHiddenRecommendationKeys(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
    } catch {
      setHiddenRecommendationKeys([]);
    }
  }, [hiddenRecommendationStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(hiddenRecommendationStorageKey, JSON.stringify(hiddenRecommendationKeys));
    } catch {
      // ignore storage errors
    }
  }, [hiddenRecommendationKeys, hiddenRecommendationStorageKey]);

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
      const rowWeight = row.fileAvailable ? 3 : isDownloadInFlight(row) ? 2 : row.status === 'error' ? 0 : 1;
      const currentWeight = current.fileAvailable ? 3 : isDownloadInFlight(current) ? 2 : current.status === 'error' ? 0 : 1;
      if (rowWeight > currentWeight || (rowWeight === currentWeight && row.createdAt > current.createdAt)) {
        map.set(key, row);
      }
    }
    return map;
  }, [downloads]);

  const visibleRecommendations = useMemo(() => {
    return recommendations.filter((item) => {
      const key = normalizeSourceUrl(item.webpage_url) || `${item.id ?? ''}:${item.title}`;
      return !hiddenRecommendationKeys.includes(key);
    });
  }, [recommendations, hiddenRecommendationKeys]);

  const kpis = useMemo(() => {
    const rows = downloads ?? [];
    return [
      { label: 'Total descargas', value: rows.length, subtitle: 'Biblioteca acumulada', tone: 'primary' as const },
      {
        label: 'Videos',
        value: rows.filter((x) => x.mediaKind === 'video').length,
        subtitle: 'Contenido visual',
        tone: 'neutral' as const,
      },
      {
        label: 'Audios',
        value: rows.filter((x) => x.mediaKind === 'audio').length,
        subtitle: 'MP3 disponibles',
        tone: 'primary' as const,
      },
      {
        label: 'Playlists',
        value: rows.filter((x) => x.type.includes('playlist')).length,
        subtitle: 'Listas importadas',
        tone: 'secondary' as const,
      },
      {
        label: 'Errores',
        value: rows.filter((x) => x.status === 'error').length,
        subtitle: 'Requieren revisión',
        tone: 'danger' as const,
      },
      {
        label: 'Pendientes',
        value: rows.filter((x) => ['pending', 'queued', 'offline'].includes(x.status)).length,
        subtitle: 'Cola pendiente',
        tone: 'secondary' as const,
      },
      {
        label: 'Favoritos',
        value: rows.filter((x) => x.favorite).length,
        subtitle: 'Marcados por ti',
        tone: 'primary' as const,
      },
    ];
  }, [downloads]);

  const downloadingNow = useMemo(
    () =>
      (downloads ?? [])
        .filter((item) => !item.fileAvailable && ['queued', 'pending', 'processing', 'offline', 'syncing'].includes(item.status))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 8),
    [downloads]
  );

  const progressValue = (item: { status: string; fileAvailable: boolean; downloadedAt?: string | null; progressPercent?: number | null }) => {
    if (item.fileAvailable || item.downloadedAt || item.status === 'completed') {
      return 100;
    }
    if (typeof item.progressPercent === 'number' && Number.isFinite(item.progressPercent)) {
      return Math.max(0, Math.min(100, item.progressPercent));
    }
    return item.status === 'processing' ? 8 : 0;
  };

  const removeRecommendation = (item: RecommendationItem) => {
    const key = normalizeSourceUrl(item.webpage_url) || `${item.id ?? ''}:${item.title}`;
    setHiddenRecommendationKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    pushToast({
      id: crypto.randomUUID(),
      title: 'Recomendación quitada',
      body: 'No la volverás a ver en tu dashboard.',
      createdAt: new Date().toISOString(),
    });
  };

  const queueRecommendation = async (item: RecommendationItem, type: 'audio_mp3' | 'video_mp4') => {
    const sourceUrl = normalizeSourceUrl(item.webpage_url);
    if (!sourceUrl) {
      return;
    }

    const requestedVideoQuality = recommendationVideoQuality === 'best' ? null : recommendationVideoQuality;
    const requestedAudioQuality = recommendationAudioQuality === 'best' ? null : recommendationAudioQuality;
    const duplicate = (downloads ?? []).find((row) => {
      if (normalizeSourceUrl(row.sourceUrl) !== sourceUrl) {
        return false;
      }
      if (row.type !== type) {
        return false;
      }
      const readyOrInFlight = row.fileAvailable || isDownloadInFlight(row);
      if (!readyOrInFlight) {
        return false;
      }
      if (type === 'video_mp4' && requestedVideoQuality) {
        return normalizeSourceUrl(row.sourceUrl) === sourceUrl && normalizeSourceUrl(row.sourceUrl) !== '' && row.videoQuality === requestedVideoQuality;
      }
      if (type === 'audio_mp3' && requestedAudioQuality) {
        return normalizeSourceUrl(row.sourceUrl) === sourceUrl && normalizeSourceUrl(row.sourceUrl) !== '' && row.audioQuality === requestedAudioQuality;
      }
      return true;
    });

    if (duplicate) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Ya existe en tu biblioteca',
        body: `${duplicate.customName ?? duplicate.title} (${duplicate.fileAvailable ? 'descargado' : 'en cola'})`,
        createdAt: new Date().toISOString(),
      });
      navigate(`/downloads/${duplicate.localId}`);
      return;
    }

    const videoQuality = type === 'video_mp4' ? requestedVideoQuality : null;
    const audioQuality = type === 'audio_mp3' ? requestedAudioQuality : null;
    const actionKey = `${sourceUrl}:${type}`;
    const createdAt = new Date().toISOString();
    const localId = `dl-${crypto.randomUUID()}`;

    setRecommendationActionMap((prev) => ({ ...prev, [actionKey]: true }));
    try {
      await db.downloads.add({
        localId,
        title: item.title || 'Nueva descarga',
        customName: item.title || null,
        type,
        mediaKind: type === 'audio_mp3' ? 'audio' : 'video',
        status: online ? 'queued' : 'offline',
        sourceUrl,
        uploader: item.uploader ?? null,
        durationSeconds: item.duration_seconds ?? null,
        createdAt,
        downloadedAt: null,
        tags: ['recommendation'],
        collectionId: null,
        notes: `Recomendado: ${item.reason ?? 'Basado en tu historial'}`,
        subtitleLanguages: [],
        favorite: false,
        archived: false,
        playbackProgress: 0,
        lastPlaybackPosition: 0,
        syncStatus: online ? 'syncing' : 'local_only',
        error: null,
        fileAvailable: false,
        videoQuality: videoQuality,
        audioQuality: audioQuality,
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
          url: sourceUrl,
          download_type: type,
          video_quality: videoQuality,
          audio_quality: audioQuality,
          custom_name: item.title || null,
          collection_id: null,
          tags: ['recommendation', type === 'audio_mp3' ? `audio-${audioQuality ?? 'best'}` : `video-${videoQuality ?? 'best'}`],
          note: `Recomendado: ${item.reason ?? 'Basado en tu historial'}`,
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
          // queued locally for retry
        }
      }

      pushToast({
        id: crypto.randomUUID(),
        title: type === 'audio_mp3' ? 'MP3 en cola' : 'MP4 en cola',
        body: online ? 'Enviado al backend para descarga.' : 'Guardado en cola local offline.',
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Error al descargar',
        body: error instanceof Error ? error.message : 'No se pudo encolar la recomendación.',
        createdAt: new Date().toISOString(),
      });
    } finally {
      setRecommendationActionMap((prev) => ({ ...prev, [actionKey]: false }));
    }
  };

  return (
    <section className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#EFF4FA]'>Dashboard</h1>
        <p className='text-sm text-[#96A0AB]'>Estado general de FASTMP3FAST y actividad reciente.</p>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {kpis.map((item) => (
          <KpiCard key={item.label} item={item} />
        ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <article className='surface-card p-4 xl:col-span-3'>
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Descargando ahora</h2>
            <p className='text-xs text-[#8D96A1]'>{downloadingNow.length} activas</p>
          </div>
          <div className='mt-3 grid gap-2 md:grid-cols-2'>
            {downloadingNow.map((item) => {
              const pct = progressValue(item);
              return (
                <div key={item.localId} className='rounded-lg border border-[#22292F] bg-[#141A1F] px-3 py-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='line-clamp-3 text-xs text-[#E4EAF2]'>{item.customName ?? item.title}</p>
                    <p className='text-[11px] text-[#A3FF12]'>{pct.toFixed(0)}%</p>
                  </div>
                  <p className='mt-0.5 line-clamp-1 text-[11px] text-[#8D96A1]'>{item.progressLine || item.sourceUrl}</p>
                  <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                    <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${pct}%` }} />
                  </div>
                  <div className='mt-2 flex flex-wrap gap-2 text-[10px] text-[#8D96A1]'>
                    {item.progressSpeed && <span>{item.progressSpeed}</span>}
                    {item.progressEta && <span>ETA {item.progressEta}</span>}
                    <span>{item.status}</span>
                  </div>
                </div>
              );
            })}
            {downloadingNow.length === 0 && <p className='text-xs text-[#94A0AC]'>No hay descargas activas en este momento.</p>}
          </div>
        </article>

        <article className='surface-card p-4 xl:col-span-2'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Ultimas reproducciones</h2>
          <div className='mt-3 space-y-2'>
            {(downloads ?? []).slice(0, 5).map((item) => (
              <div key={item.localId} className='flex items-center justify-between rounded-lg border border-[#22292F] bg-[#141A1F] px-3 py-2'>
                <div>
                  <p className='text-sm text-[#E4EAF2]'>{item.customName ?? item.title}</p>
                  <p className='text-xs text-[#8D96A1]'>
                    {item.mediaKind} • {formatDuration(item.durationSeconds)}
                  </p>
                </div>
                <p className='text-xs text-[#A3FF12]'>{item.playbackProgress}%</p>
              </div>
            ))}
          </div>
        </article>

        <article className='surface-card p-4'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Cola de sincronización</h2>
          <div className='mt-3 space-y-2'>
            {(syncQueue ?? []).slice(0, 6).map((op) => (
              <div key={op.localId} className='rounded-lg border border-[#2C3322] bg-[#1C2015] px-3 py-2 text-xs text-[#F7E733]'>
                {op.operation} • {op.entityType}
              </div>
            ))}
            {(!syncQueue || syncQueue.length === 0) && <p className='text-xs text-[#94A0AC]'>No hay operaciones pendientes.</p>}
          </div>
        </article>
      </div>

      <article className='surface-card p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Actividad reciente</h2>
        <div className='mt-3 space-y-2'>
          {(activity ?? []).map((event) => (
            <div key={event.localId} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2 text-sm text-[#D4DBE4]'>
              <p>{event.description}</p>
              <p className='text-xs text-[#8D96A1]'>{new Date(event.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </article>

      <article className='surface-card p-4'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Recomendaciones para ti</h2>
          <div className='flex flex-wrap items-end gap-2'>
            <label className='block'>
              <span className='text-[10px] uppercase tracking-[0.08em] text-[#8E99A5]'>Calidad MP4</span>
              <select
                value={recommendationVideoQuality}
                onChange={(event) => setRecommendationVideoQuality(event.target.value)}
                className='mt-1 h-8 rounded-md border border-[#2A3036] bg-[#151A1F] px-2 text-xs text-[#E6ECF4]'
              >
                {['best', '4K', '1440p', '1080p', '720p', '480p'].map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'best' ? 'Mejor disponible' : opt}
                  </option>
                ))}
              </select>
            </label>
            <label className='block'>
              <span className='text-[10px] uppercase tracking-[0.08em] text-[#8E99A5]'>Calidad MP3</span>
              <select
                value={recommendationAudioQuality}
                onChange={(event) => setRecommendationAudioQuality(event.target.value)}
                className='mt-1 h-8 rounded-md border border-[#2A3036] bg-[#151A1F] px-2 text-xs text-[#E6ECF4]'
              >
                {['best', '320kbps', '256kbps', '192kbps', '128kbps'].map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'best' ? 'Mejor disponible' : opt}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className='mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {visibleRecommendations.map((item) => {
            const sourceUrl = normalizeSourceUrl(item.webpage_url);
            const existing = sourceUrl ? existingByRemoteUrl.get(sourceUrl) : undefined;
            const existingReady = Boolean(existing?.fileAvailable);
            const existingPending = Boolean(existing && !existing.fileAvailable && isDownloadInFlight(existing));
            const actionAudio = Boolean(recommendationActionMap[`${sourceUrl}:audio_mp3`]);
            const actionVideo = Boolean(recommendationActionMap[`${sourceUrl}:video_mp4`]);
            const cover = item.thumbnail || getYoutubeCoverFromUrl(item.webpage_url) || '';
            return (
              <div key={`${item.id ?? item.webpage_url}-${item.reason ?? ''}`} className='media-card media-card-hover'>
                <div className='media-card-cover h-44'>
                  {cover ? (
                    <img src={cover} alt={item.title} className='h-full w-full object-cover' />
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
                    <p className='line-clamp-3 min-h-[3.6rem] text-sm font-semibold text-[#E6EBF3]'>{item.title}</p>
                    <p className='text-xs text-[#8D96A1]'>
                      {item.uploader || 'Canal desconocido'} • {formatDuration(item.duration_seconds)} • {item.reason ?? 'Basado en tu historial'}
                    </p>
                  </div>
                </div>
                <div className='media-card-actions px-3 pb-3'>
                  <button
                    type='button'
                    onClick={() => void queueRecommendation(item, 'audio_mp3')}
                    disabled={existingPending || actionAudio || actionVideo}
                    className={`h-9 rounded-md border px-2 text-xs font-medium ${
                      existingPending || actionAudio || actionVideo
                        ? 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                        : 'border-[#2F5B2B] bg-[#162516] text-[#A3FF12]'
                    }`}
                  >
                    {actionAudio
                      ? 'Encolando...'
                      : `Descargar MP3 (${recommendationAudioQuality === 'best' ? 'Mejor disponible' : recommendationAudioQuality})`}
                  </button>
                  <button
                    type='button'
                    onClick={() => void queueRecommendation(item, 'video_mp4')}
                    disabled={existingPending || actionAudio || actionVideo}
                    className={`h-9 rounded-md border px-2 text-xs font-medium ${
                      existingPending || actionAudio || actionVideo
                        ? 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                        : 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                    }`}
                  >
                    {actionVideo
                      ? 'Encolando...'
                      : `Descargar MP4 (${recommendationVideoQuality === 'best' ? 'Mejor disponible' : recommendationVideoQuality})`}
                  </button>
                  {existing ? (
                    <button
                      type='button'
                      onClick={() => navigate(`/downloads/${existing.localId}`)}
                      className='h-9 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-xs font-medium text-[#D3DAE3]'
                    >
                      Ver estado
                    </button>
                  ) : (
                    <a
                      href={item.webpage_url}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-xs font-medium text-[#D3DAE3]'
                    >
                      <ExternalLink size={12} /> Abrir
                    </a>
                  )}
                  <button
                    type='button'
                    onClick={() => removeRecommendation(item)}
                    className='inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-xs font-medium text-[#FFB7BD]'
                  >
                    <Trash2 size={12} /> Quitar
                  </button>
                </div>
              </div>
            );
          })}
          {visibleRecommendations.length === 0 && <p className='text-xs text-[#94A0AC]'>Aún no hay recomendaciones disponibles.</p>}
        </div>
      </article>

      {user?.is_admin && (
        <article className='surface-card p-4'>
          <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Vista superadmin</h2>
          <p className='mt-1 text-xs text-[#96A0AB]'>Resumen global de actividad de usuarios.</p>
          <div className='mt-3 grid gap-2 sm:grid-cols-3'>
            {adminUsers.map((u) => (
              <div key={u.id} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2'>
                <p className='text-sm text-[#E4EAF2]'>{u.username}</p>
                <p className='text-xs text-[#8D96A1]'>Descargas: {u.downloads_count}</p>
              </div>
            ))}
          </div>
          <div className='mt-3 space-y-2'>
            {adminGlobal.slice(0, 8).map((item) => (
              <div key={`${String(item.local_uid ?? item.localId ?? item.id)}-${String(item.created_at ?? item.createdAt ?? '')}`} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2 text-sm text-[#D4DBE4]'>
                <p className='line-clamp-3'>{String(item.custom_name ?? item.customName ?? item.title ?? 'Sin título')}</p>
                <p className='text-xs text-[#8D96A1]'>Usuario: {String(item.owner_username ?? item.ownerUsername ?? item.owner_name ?? item.ownerName ?? 'N/A')} • Estado: {String(item.status ?? 'N/A')}</p>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
