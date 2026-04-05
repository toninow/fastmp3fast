import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudOff, Download, PlayCircle, Trash2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { db } from '../lib/db/database';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';
import { cacheDownloadForOffline, removeOfflineCache } from '../lib/offline/mediaCache';
import { isDownloadReady } from '../lib/mediaAccess';
import { useUiStore } from '../store/uiStore';
import { formatBytes } from '../lib/format';

export function CollectionDetailPage() {
  const { localId } = useParams();
  const collection = useLiveQuery(() => db.collections.where('localId').equals(localId ?? '').first(), [localId]);
  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);
  const offlineMedia = useLiveQuery(() => db.offlineMedia.toArray(), []);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const pushToast = useUiStore((state) => state.pushNotification);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchRemoving, setBatchRemoving] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    failed: number;
    current: string;
  } | null>(null);

  const items = useMemo(() => {
    if (!collection || !downloads) {
      return [];
    }

    return collection.itemIds
      .map((id) => downloads.find((item) => item.localId === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [collection, downloads]);
  const readyItems = useMemo(() => items.filter((item) => isDownloadReady(item)), [items]);
  const itemSubtitleMap = useMemo(() => {
    const map = new Map<string, typeof subtitles>();
    for (const subtitle of subtitles ?? []) {
      const current = map.get(subtitle.downloadLocalId) ?? [];
      current.push(subtitle);
      map.set(subtitle.downloadLocalId, current);
    }
    return map;
  }, [subtitles]);
  const itemIdSet = useMemo(() => new Set(items.map((item) => item.localId)), [items]);
  const cachedRows = useMemo(
    () => (offlineMedia ?? []).filter((row) => itemIdSet.has(row.downloadLocalId)),
    [offlineMedia, itemIdSet]
  );
  const cachedIdSet = useMemo(() => new Set(cachedRows.map((row) => row.downloadLocalId)), [cachedRows]);
  const cachedBytes = useMemo(() => cachedRows.reduce((total, row) => total + (row.sizeBytes ?? 0), 0), [cachedRows]);
  const progressPercent = useMemo(() => {
    if (!batchProgress || batchProgress.total <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((batchProgress.done / batchProgress.total) * 100));
  }, [batchProgress]);

  const itemName = (title: string, customName: string | null | undefined): string => {
    const trimmed = customName?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : title;
  };

  const saveOneOffline = async (itemLocalId: string) => {
    const row = items.find((item) => item.localId === itemLocalId);
    if (!row || !isDownloadReady(row)) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Aún no descargado',
        body: 'Este elemento todavía no tiene archivo MP3/MP4 disponible para guardar en el dispositivo.',
        createdAt: new Date().toISOString(),
      });
      return;
    }
    try {
      await cacheDownloadForOffline(row, itemSubtitleMap.get(row.localId) ?? []);
      pushToast({
        id: crypto.randomUUID(),
        title: 'Guardado en este dispositivo',
        body: itemName(row.title, row.customName),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'No se pudo guardar offline',
        body: error instanceof Error ? error.message : 'Error de cache local.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const removeOneOffline = async (itemLocalId: string) => {
    await removeOfflineCache(itemLocalId);
    const row = items.find((item) => item.localId === itemLocalId);
    pushToast({
      id: crypto.randomUUID(),
      title: 'Cache offline eliminado',
      body: row ? itemName(row.title, row.customName) : 'Elemento actualizado.',
      createdAt: new Date().toISOString(),
    });
  };

  const saveCollectionOffline = async () => {
    if (readyItems.length === 0 || batchSaving) {
      return;
    }
    setBatchSaving(true);
    let done = 0;
    let failed = 0;
    setBatchProgress({
      total: readyItems.length,
      done: 0,
      failed: 0,
      current: itemName(readyItems[0].title, readyItems[0].customName),
    });

    for (const row of readyItems) {
      setBatchProgress({
        total: readyItems.length,
        done,
        failed,
        current: itemName(row.title, row.customName),
      });
      try {
        await cacheDownloadForOffline(row, itemSubtitleMap.get(row.localId) ?? []);
      } catch {
        failed += 1;
      }
      done += 1;
      setBatchProgress({
        total: readyItems.length,
        done,
        failed,
        current: itemName(row.title, row.customName),
      });
    }

    setBatchSaving(false);
    pushToast({
      id: crypto.randomUUID(),
      title: 'Descarga local completada',
      body:
        failed === 0
          ? `Se guardaron ${done} elementos en este dispositivo.`
          : `Se guardaron ${done - failed} de ${done}. Fallaron ${failed}.`,
      createdAt: new Date().toISOString(),
    });
  };

  const clearCollectionOffline = async () => {
    if (items.length === 0 || batchRemoving) {
      return;
    }
    setBatchRemoving(true);
    for (const row of items) {
      await removeOfflineCache(row.localId);
    }
    setBatchRemoving(false);
    pushToast({
      id: crypto.randomUUID(),
      title: 'Cache local limpiado',
      body: 'Se quitaron los archivos offline de esta lista en este dispositivo.',
      createdAt: new Date().toISOString(),
    });
  };

  if (!collection) {
    return <p className='text-sm text-[#95A0AC]'>Lista no encontrada.</p>;
  }

  return (
    <section className='space-y-4'>
      <div className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold text-[#EFF4FA]'>{collection.name}</h1>
            <p className='text-sm text-[#96A0AB]'>{collection.description}</p>
            <p className='mt-2 text-xs text-[#A9B3BE]'>
              En este dispositivo: <span className='text-[#A3FF12]'>{cachedRows.length}</span>/{readyItems.length} listos
              {' • '}
              {formatBytes(cachedBytes)}
            </p>
            <p className='mt-1 text-xs text-[#8D97A2]'>
              Guardar offline aquí usa el almacenamiento local del navegador en este móvil/PC.
            </p>
          </div>
          <div className='grid grid-cols-2 gap-2 sm:flex'>
            <button
              type='button'
              onClick={() =>
                setQueue(
                  items.map((item) => buildTrack(item, (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId)))
                )
              }
              className='inline-flex items-center justify-center gap-2 rounded-lg border border-[#2F5B2B] bg-[#182516] px-3 py-2 text-sm text-[#A3FF12]'
            >
              <PlayCircle size={15} /> Reproducir todo
            </button>
            <button
              type='button'
              onClick={() => void saveCollectionOffline()}
              disabled={readyItems.length === 0 || batchSaving}
              className='inline-flex items-center justify-center gap-2 rounded-lg border border-[#6B6420] bg-[#2B2B16] px-3 py-2 text-sm text-[#F7E733] disabled:opacity-50'
            >
              <Download size={15} />
              {batchSaving ? 'Guardando...' : 'Descargar álbum al dispositivo'}
            </button>
            <button
              type='button'
              onClick={() => void clearCollectionOffline()}
              disabled={batchRemoving || items.length === 0}
              className='inline-flex items-center justify-center gap-2 rounded-lg border border-[#5A2028] bg-[#2A1316] px-3 py-2 text-sm text-[#FFB7BD] disabled:opacity-50'
            >
              <Trash2 size={15} />
              {batchRemoving ? 'Limpiando...' : 'Quitar offline de este dispositivo'}
            </button>
          </div>
        </div>
        {batchProgress && (
          <div className='mt-4 rounded-lg border border-[#2A3036] bg-[#0F1418] p-3'>
            <div className='flex items-center justify-between text-xs text-[#BBC5D0]'>
              <span>
                {batchSaving ? 'Descargando en este dispositivo' : 'Última descarga local'}: {batchProgress.current}
              </span>
              <span className='text-[#A3FF12]'>
                {batchProgress.done}/{batchProgress.total}
              </span>
            </div>
            <div className='mt-2 h-2 overflow-hidden rounded-full bg-[#20272E]'>
              <div
                className='h-full rounded-full bg-[#A3FF12] transition-all duration-300'
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {batchProgress.failed > 0 && (
              <p className='mt-2 text-xs text-[#FFB7BD]'>Fallaron {batchProgress.failed} elementos al guardar localmente.</p>
            )}
          </div>
        )}
      </div>

      <div className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Elementos de la lista</h2>
        <div className='mt-3 space-y-2'>
          {items.map((item, index) => (
            <div key={item.localId} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className='text-sm text-[#D5DDE7]'>
                    {index + 1}. {itemName(item.title, item.customName)}
                  </p>
                  <div className='mt-1 flex flex-wrap items-center gap-2 text-xs'>
                    <span className='rounded border border-[#2A3036] bg-[#11161A] px-2 py-0.5 uppercase tracking-[0.08em] text-[#F7E733]'>
                      {item.mediaKind}
                    </span>
                    <span
                      className={`rounded border px-2 py-0.5 ${
                        cachedIdSet.has(item.localId)
                          ? 'border-[#2F5B2B] bg-[#162016] text-[#A3FF12]'
                          : 'border-[#3B4148] bg-[#1A1F24] text-[#A9B3BE]'
                      }`}
                    >
                      {cachedIdSet.has(item.localId) ? 'En este dispositivo' : 'Solo servidor'}
                    </span>
                    {!isDownloadReady(item) && (
                      <span className='inline-flex items-center gap-1 rounded border border-[#3B4148] bg-[#1A1F24] px-2 py-0.5 text-[#A9B3BE]'>
                        <CloudOff size={12} />
                        Aún no descargado
                      </span>
                    )}
                  </div>
                </div>
                <div className='flex flex-wrap justify-end gap-2'>
                  <button
                    type='button'
                    disabled={!isDownloadReady(item)}
                    onClick={() => void saveOneOffline(item.localId)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-xs text-[#F7E733] disabled:opacity-40'
                  >
                    <Download size={12} />
                    Guardar offline
                  </button>
                  <button
                    type='button'
                    disabled={!cachedIdSet.has(item.localId)}
                    onClick={() => void removeOneOffline(item.localId)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-xs text-[#FFB7BD] disabled:opacity-40'
                  >
                    <Trash2 size={12} />
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
