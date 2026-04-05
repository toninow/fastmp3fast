import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Download, Play, RotateCcw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { StatusBadge } from '../components/common/StatusBadge';
import { db } from '../lib/db/database';
import { formatBytes, formatDuration } from '../lib/format';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';
import { apiEndpoints } from '../lib/api/endpoints';
import { useUiStore } from '../store/uiStore';
import { buildDownloadUrl } from '../lib/mediaAccess';
import { resolveDownloadCover } from '../lib/covers';
import { cacheDownloadForOffline, removeOfflineCache } from '../lib/offline/mediaCache';

export function DownloadDetailPage() {
  const navigate = useNavigate();
  const { localId: routeId } = useParams();
  const item = useLiveQuery(async () => {
    const id = (routeId ?? '').trim();
    if (!id) {
      return undefined;
    }

    const byLocal = await db.downloads.where('localId').equals(id).first();
    if (byLocal) {
      return byLocal;
    }

    // Fallback to support legacy links that may use remote id in the URL.
    return db.downloads.where('remoteId').equals(id).first();
  }, [routeId]);
  const resolvedLocalId = item?.localId ?? (routeId ?? '');
  const subtitles = useLiveQuery(
    () => db.subtitles.where('downloadLocalId').equals(resolvedLocalId).toArray(),
    [resolvedLocalId]
  );
  const offlineMedia = useLiveQuery(
    () => db.offlineMedia.where('downloadLocalId').equals(resolvedLocalId).first(),
    [resolvedLocalId]
  );
  const activity = useLiveQuery(async () => {
    if (!resolvedLocalId) {
      return [];
    }
    const rows = await db.recentActivity.toArray();
    return rows
      .filter((event) => event.entityLocalId === resolvedLocalId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [resolvedLocalId]);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const pushToast = useUiStore((state) => state.pushNotification);

  if (!item) {
    return <p className='text-sm text-[#94A0AC]'>Elemento no encontrado.</p>;
  }

  const rename = async () => {
    const value = window.prompt('Nuevo nombre:', item.customName ?? item.title)?.trim();
    if (!value) {
      return;
    }
    try {
      await apiEndpoints.updateDownloadByLocal(item.localId, { custom_name: value });
    } catch {
      // local-first fallback
    }
    await db.downloads.where('localId').equals(item.localId).modify({ customName: value, title: value });
  };

  const remove = async () => {
    if (!window.confirm('¿Eliminar esta descarga?')) {
      return;
    }
    try {
      await apiEndpoints.deleteDownloadByLocal(item.localId);
    } catch {
      // local fallback
    }
    await db.downloads.where('localId').equals(item.localId).delete();
    navigate('/library', { replace: true });
  };

  const playCurrent = () => {
    const track = buildTrack(item, subtitles ?? []);
    if (!track.src && !offlineMedia) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Archivo no disponible',
        body: 'No hay MP3/MP4 listo para reproducir todavía.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    playTrack(track);
  };

  const saveOffline = async () => {
    try {
      await cacheDownloadForOffline(item, subtitles ?? []);
      pushToast({
        id: crypto.randomUUID(),
        title: 'Disponible offline',
        body: 'Archivo y subtítulos guardados para reproducir sin internet.',
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'No se pudo guardar offline',
        body: error instanceof Error ? error.message : 'Error de cache offline.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const clearOffline = async () => {
    await removeOfflineCache(item.localId);
    pushToast({
      id: crypto.randomUUID(),
      title: 'Cache offline eliminado',
      body: 'Se eliminaron archivos locales de este elemento.',
      createdAt: new Date().toISOString(),
    });
  };

  const downloadUrl = buildDownloadUrl(item);
  const cover = resolveDownloadCover(item);
  const isReady = Boolean(item.fileAvailable || item.downloadedAt || item.mediaPath);
  const isBusy = !isReady && ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(item.status);
  const progress = Math.max(0, Math.min(100, Number(item.progressPercent ?? (isBusy ? 8 : 0))));
  const subtitleSummary = item.subtitleLanguages.length > 0 ? item.subtitleLanguages.join(', ') : 'Sin subtítulos';
  const createdAtLabel = item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A';
  const downloadedAtLabel = item.downloadedAt ? new Date(item.downloadedAt).toLocaleString() : 'Pendiente';
  const requestedVideoQuality = item.videoQuality ?? 'N/A';
  const requestedAudioQuality = item.audioQuality ?? 'N/A';
  const ownerLabel = item.ownerUsername ?? item.ownerName ?? 'actual';
  const noteLabel = item.notes?.trim() ? item.notes : 'Sin notas registradas.';

  return (
    <section className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <button type='button' onClick={() => navigate(-1)} className='inline-flex items-center gap-1 rounded-md border border-[#353C43] bg-[#161C22] px-3 py-1.5 text-sm text-[#C7CFD8]'>
          <ArrowLeft size={14} /> Volver
        </button>
        <div className='flex flex-wrap items-center gap-2'>
          <StatusBadge status={item.status} item={item} />
          <span className='rounded-md border border-[#303841] bg-[#171D23] px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-[#A5AFBB]'>
            {item.mediaKind}
          </span>
          <span className='rounded-md border border-[#303841] bg-[#171D23] px-2 py-1 text-[11px] text-[#A5AFBB]'>
            ID: {item.localId}
          </span>
        </div>
      </div>

      <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <div className='grid gap-4 xl:grid-cols-[360px_1fr]'>
          <div className='space-y-3'>
            {cover ? (
              <img src={cover} className='h-56 w-full rounded-lg border border-[#242A30] object-cover' alt={item.title} />
            ) : (
              <div className='grid h-56 w-full place-items-center rounded-lg border border-[#242A30] bg-[#0F1317] text-sm text-[#6F7782]'>
                Sin portada
              </div>
            )}

            {isBusy && (
              <div className='rounded-lg border border-[#2A323A] bg-[#141A1F] p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='line-clamp-1 text-xs text-[#9AA4AF]'>{item.progressLine || 'Procesando descarga...'}</p>
                  <span className='text-xs font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
                </div>
                <div className='mt-2 h-2 overflow-hidden rounded-full bg-[#222932]'>
                  <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-2'>
              <button
                type='button'
                onClick={playCurrent}
                className='inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#182516] px-2 text-xs font-semibold text-[#A3FF12]'
              >
                <Play size={12} /> Reproducir
              </button>
              <button
                type='button'
                onClick={playCurrent}
                className='inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-xs font-semibold text-[#F7E733]'
              >
                <RotateCcw size={12} /> Reanudar
              </button>
              {!offlineMedia ? (
                <button
                  type='button'
                  onClick={() => void saveOffline()}
                  className='h-9 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 text-xs font-semibold text-[#A3FF12]'
                >
                  Guardar offline
                </button>
              ) : (
                <button
                  type='button'
                  onClick={() => void clearOffline()}
                  className='h-9 rounded-md border border-[#353C43] bg-[#1A1F24] px-2 text-xs font-semibold text-[#D6DEE8]'
                >
                  Quitar offline
                </button>
              )}
              <button
                type='button'
                onClick={() => void rename()}
                className='h-9 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-xs font-semibold text-[#F7E733]'
              >
                Editar nombre
              </button>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className='col-span-2 inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 text-xs font-semibold text-[#A3FF12]'
                  download
                >
                  <Download size={12} /> Descargar archivo
                </a>
              )}
              <button
                type='button'
                onClick={() => void remove()}
                className='col-span-2 h-9 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-xs font-semibold text-[#FFB7BD]'
              >
                Eliminar
              </button>
            </div>
          </div>

          <div className='space-y-4'>
            <div className='rounded-lg border border-[#242A30] bg-[#151B20] p-3'>
              <h1 className='text-xl font-bold text-[#EFF4FA]'>{item.customName ?? item.title}</h1>
              <p className='mt-2 break-all text-xs text-[#9AA4AF]'>Origen: {item.sourceUrl}</p>
            </div>

            <div className='grid gap-2 md:grid-cols-2'>
              <Detail label='Tipo de descarga' value={item.type} />
              <Detail label='Formato final' value={item.format ?? 'N/A'} />
              <Detail label='Calidad video solicitada' value={requestedVideoQuality} />
              <Detail label='Calidad audio solicitada' value={requestedAudioQuality} />
              <Detail label='Tamaño' value={formatBytes(item.sizeBytes)} />
              <Detail label='Duración' value={formatDuration(item.durationSeconds)} />
              <Detail label='Subtítulos' value={subtitleSummary} />
              <Detail label='Offline' value={offlineMedia ? 'Disponible sin internet' : 'Solo online'} />
            </div>

            <div className='grid gap-2 md:grid-cols-2'>
              <Detail label='Estado sync' value={item.syncStatus} />
              <Detail label='Lista' value={item.collectionId ?? 'Sin lista'} />
              <Detail label='Creado' value={createdAtLabel} />
              <Detail label='Descargado' value={downloadedAtLabel} />
              <Detail label='Usuario' value={ownerLabel} />
              <Detail label='Local ID' value={item.localId} />
            </div>

            <div className='rounded-lg border border-[#242A30] bg-[#151B20] p-3'>
              <p className='text-[11px] uppercase tracking-[0.08em] text-[#8B95A0]'>Notas</p>
              <p className='mt-1 text-sm text-[#C7CFD8]'>{noteLabel}</p>
            </div>

            {item.error && (
              <div className='rounded-lg border border-[#5A2028] bg-[#2A1316] p-3'>
                <p className='text-[11px] uppercase tracking-[0.08em] text-[#FFB7BD]'>Error / log</p>
                <p className='mt-1 whitespace-pre-wrap break-words text-xs text-[#FFB7BD]'>{item.error}</p>
              </div>
            )}
          </div>
        </div>
      </article>

      <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Historial de eventos</h2>
        <div className='mt-3 space-y-2'>
          {(activity ?? []).map((event) => (
            <div key={event.localId} className='rounded-lg border border-[#242A30] bg-[#151B20] p-3'>
              <p className='text-sm text-[#D0D8E2]'>{event.description}</p>
              <p className='mt-1 text-xs text-[#8B95A0]'>{new Date(event.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {(!activity || activity.length === 0) && <p className='text-sm text-[#95A0AC]'>Sin eventos para este elemento.</p>}
        </div>
      </article>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2'>
      <p className='text-[11px] uppercase tracking-[0.08em] text-[#8B95A0]'>{label}</p>
      <p className='mt-1 break-all text-sm text-[#D8DEE7]'>{value}</p>
    </div>
  );
}
