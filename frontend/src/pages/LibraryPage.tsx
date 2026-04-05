import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Grid2x2, List } from 'lucide-react';
import { DownloadCard } from '../components/library/DownloadCard';
import { DownloadsTable } from '../components/library/DownloadsTable';
import { db } from '../lib/db/database';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';
import { useUiStore } from '../store/uiStore';
import { apiEndpoints } from '../lib/api/endpoints';
import { enqueueOperation, processPendingOperations, refreshCollectionsFromBackend, refreshDownloadsFromBackend, refreshSubtitlesFromBackend } from '../lib/offline/syncQueue';
import { isDownloadReady } from '../lib/mediaAccess';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { CollectionItem } from '../types/models';

const playlistColorOptions = ['#A3FF12', '#F7E733', '#6EE7B7', '#67E8F9', '#F97316'];

export function LibraryPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const searchRaw = useUiStore((state) => state.search);
  const setSearch = useUiStore((state) => state.setSearch);
  const search = searchRaw.trim().toLowerCase();
  const pushToast = useUiStore((state) => state.pushNotification);
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [playlistTargetLocalId, setPlaylistTargetLocalId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [newPlaylistColor, setNewPlaylistColor] = useState('#A3FF12');

  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const collections = useLiveQuery(() => db.collections.orderBy('order').toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);
  const playTrack = usePlayerStore((state) => state.playTrack);

  useEffect(() => {
    void refreshDownloadsFromBackend();
    void refreshSubtitlesFromBackend();
    void refreshCollectionsFromBackend();
    const timer = window.setInterval(() => {
      void refreshDownloadsFromBackend();
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const activeDownloads = useMemo(
    () =>
      (downloads ?? [])
        .filter((item) => !isDownloadReady(item) && ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(item.status))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [downloads]
  );

  const rows = useMemo(() => {
    const source = downloads ?? [];

    return source
      .filter((item) => {
      const q = !search
        || item.title.toLowerCase().includes(search)
        || (item.customName ?? '').toLowerCase().includes(search)
        || (item.uploader ?? '').toLowerCase().includes(search)
        || item.sourceUrl.toLowerCase().includes(search)
        || item.tags.some((tag) => tag.toLowerCase().includes(search));
      const isDownloaded = isDownloadReady(item);
      const isDownloading = !isDownloaded && ['pending', 'queued', 'processing', 'syncing'].includes(item.status);
      const isFailed = item.status === 'error' || item.syncStatus === 'sync_error' || Boolean(item.error);
      const s =
        filterStatus === 'all' ||
        (filterStatus === 'downloaded' && isDownloaded) ||
        (filterStatus === 'downloading' && isDownloading) ||
        (filterStatus === 'failed' && isFailed) ||
        item.status === filterStatus;
      return q && s;
      })
      .sort((a, b) => {
        const aReady = Number(isDownloadReady(a));
        const bReady = Number(isDownloadReady(b));
        if (aReady !== bReady) {
          return bReady - aReady;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [downloads, search, filterStatus]);

  const onPlay = (localId: string) => {
    const item = rows.find((x) => x.localId === localId);
    if (!item) {
      return;
    }

    const subtitleRows = (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId);
    const track = buildTrack(item, subtitleRows);
    const appearsReady = isDownloadReady(item);
    if (!appearsReady) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Archivo no disponible',
        body: item.error
          ? `Descarga fallida: ${item.error}`
          : 'Este elemento aún no tiene archivo MP3/MP4 reproducible.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    playTrack(track);
  };

  const renameItem = async (localId: string) => {
    const current = rows.find((x) => x.localId === localId);
    if (!current) {
      return;
    }
    const value = window.prompt('Nuevo nombre:', current.customName ?? current.title)?.trim();
    if (!value) {
      return;
    }
    try {
      await apiEndpoints.updateDownloadByLocal(localId, { custom_name: value });
    } catch {
      // keep local update for offline-first UX
    }
    await db.downloads.where('localId').equals(localId).modify({ customName: value, title: value, syncStatus: 'syncing' });
  };

  const deleteItem = async (localId: string) => {
    const ok = window.confirm('¿Eliminar esta descarga?');
    if (!ok) {
      return;
    }
    try {
      await apiEndpoints.deleteDownloadByLocal(localId);
    } catch {
      // local delete anyway
    }
    await db.downloads.where('localId').equals(localId).delete();
  };

  const retryItem = async (localId: string) => {
    const current = rows.find((x) => x.localId === localId);
    if (!current) {
      return;
    }

    if (!online) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Sin conexión',
        body: 'Conéctate para reintentar la descarga en el backend.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    try {
      if (current.remoteId) {
        await apiEndpoints.retryDownload(Number(current.remoteId));
      } else {
        await processPendingOperations();
      }

      await db.downloads.where('localId').equals(localId).modify({
        status: 'queued',
        syncStatus: 'syncing',
        error: null,
        progressPercent: 0,
        progressLine: 'Reintento en cola',
        progressState: 'queued',
      });

      await refreshDownloadsFromBackend();
      pushToast({
        id: crypto.randomUUID(),
        title: 'Reintento enviado',
        body: `${current.customName ?? current.title} volvió a la cola de descarga.`,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'No se pudo reintentar',
        body: error instanceof Error ? error.message : 'Error inesperado al reintentar.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const playlistTargetItem = useMemo(
    () => (downloads ?? []).find((item) => item.localId === playlistTargetLocalId) ?? null,
    [downloads, playlistTargetLocalId]
  );

  const buildCollectionPayload = (collection: CollectionItem, itemIds: string[] = collection.itemIds) => ({
    name: collection.name,
    description: collection.description?.trim() || null,
    color: collection.color || '#A3FF12',
    icon: collection.icon || 'folder',
    sort_order: collection.order ?? 0,
    item_ids: itemIds,
  });

  const queueCollectionUpsert = async (collection: CollectionItem, itemIds: string[]) => {
    await enqueueOperation({
      localId: crypto.randomUUID(),
      operation: 'upsert',
      entityType: 'collection',
      entityLocalId: collection.localId,
      payload: {
        local_id: collection.localId,
        ...buildCollectionPayload(collection, itemIds),
      },
    });
    if (online) {
      await processPendingOperations().catch(() => undefined);
      await refreshCollectionsFromBackend().catch(() => undefined);
    }
  };

  const syncCollectionUpdate = async (collection: CollectionItem, itemIds: string[]) => {
    const payload = buildCollectionPayload(collection, itemIds);
    if (online && collection.remoteId) {
      try {
        await apiEndpoints.updateCollection(collection.remoteId, payload);
        await refreshCollectionsFromBackend();
        return;
      } catch {
        // fallback to sync queue
      }
    }
    await queueCollectionUpsert(collection, itemIds);
  };

  const toggleItemInCollection = async (collection: CollectionItem, downloadLocalId: string) => {
    const exists = collection.itemIds.includes(downloadLocalId);
    const nextItemIds = exists
      ? collection.itemIds.filter((id) => id !== downloadLocalId)
      : [...collection.itemIds, downloadLocalId];

    await db.collections.where('localId').equals(collection.localId).modify({
      itemIds: nextItemIds,
      updatedAt: new Date().toISOString(),
    });

    await syncCollectionUpdate({ ...collection, itemIds: nextItemIds }, nextItemIds);
    pushToast({
      id: crypto.randomUUID(),
      title: exists ? 'Quitado de la lista' : 'Añadido a la lista',
      body: `${playlistTargetItem?.customName ?? playlistTargetItem?.title ?? 'Elemento'} ${exists ? 'se quitó de' : 'se añadió a'} ${collection.name}.`,
      createdAt: new Date().toISOString(),
    });
  };

  const createPlaylist = async () => {
    const trimmedName = newPlaylistName.trim();
    if (!trimmedName) {
      return;
    }
    const now = new Date().toISOString();
    const localId = `col-${crypto.randomUUID()}`;
    const payload = {
      local_id: localId,
      name: trimmedName,
      description: newPlaylistDescription.trim() || null,
      color: newPlaylistColor,
      icon: 'folder',
      sort_order: collections?.length ?? 0,
      item_ids: playlistTargetItem ? [playlistTargetItem.localId] : [],
    };

    await db.collections.put({
      localId,
      remoteId: null,
      name: trimmedName,
      description: newPlaylistDescription.trim(),
      color: newPlaylistColor,
      icon: 'folder',
      order: collections?.length ?? 0,
      itemIds: payload.item_ids,
      updatedAt: now,
    });

    if (online) {
      try {
        await apiEndpoints.createCollection(payload);
        await refreshCollectionsFromBackend();
      } catch {
        await enqueueOperation({
          localId: crypto.randomUUID(),
          operation: 'create',
          entityType: 'collection',
          entityLocalId: localId,
          payload,
        });
        await processPendingOperations().catch(() => undefined);
      }
    } else {
      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'create',
        entityType: 'collection',
        entityLocalId: localId,
        payload,
      });
    }

    pushToast({
      id: crypto.randomUUID(),
      title: 'Lista creada',
      body: `Se creó "${trimmedName}" sin borrar ningún archivo de la biblioteca.`,
      createdAt: now,
    });
    setNewPlaylistName('');
    setNewPlaylistDescription('');
    setNewPlaylistColor('#A3FF12');
  };

  const editPlaylist = async (collection: CollectionItem) => {
    const name = window.prompt('Nuevo nombre de la lista:', collection.name)?.trim();
    if (!name) {
      return;
    }
    const description = window.prompt('Descripción de la lista:', collection.description ?? '') ?? collection.description ?? '';
    const updated: CollectionItem = {
      ...collection,
      name,
      description,
      updatedAt: new Date().toISOString(),
    };

    await db.collections.where('localId').equals(collection.localId).modify({
      name,
      description,
      updatedAt: updated.updatedAt,
    });

    await syncCollectionUpdate(updated, updated.itemIds);
    pushToast({
      id: crypto.randomUUID(),
      title: 'Lista actualizada',
      body: `Cambios guardados en "${name}".`,
      createdAt: new Date().toISOString(),
    });
  };

  const deletePlaylist = async (collection: CollectionItem) => {
    const ok = window.confirm(`¿Eliminar la lista "${collection.name}"? Esto NO borra MP3/MP4.`);
    if (!ok) {
      return;
    }

    if (online && collection.remoteId) {
      try {
        await apiEndpoints.deleteCollection(collection.remoteId);
      } catch {
        await enqueueOperation({
          localId: crypto.randomUUID(),
          operation: 'delete',
          entityType: 'collection',
          entityLocalId: collection.localId,
          payload: { local_id: collection.localId, remote_id: Number(collection.remoteId) },
        });
      }
    } else {
      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'delete',
        entityType: 'collection',
        entityLocalId: collection.localId,
        payload: { local_id: collection.localId, remote_id: collection.remoteId ? Number(collection.remoteId) : null },
      });
    }

    await db.collections.where('localId').equals(collection.localId).delete();
    await db.downloads.where('collectionId').equals(collection.localId).modify({ collectionId: null });
    if (collection.remoteId) {
      await db.downloads.where('collectionId').equals(collection.remoteId).modify({ collectionId: null });
    }

    if (online) {
      await processPendingOperations().catch(() => undefined);
      await refreshCollectionsFromBackend().catch(() => undefined);
    }

    pushToast({
      id: crypto.randomUUID(),
      title: 'Lista eliminada',
      body: 'Se eliminó la lista. Tus archivos MP3/MP4 siguen intactos.',
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#EFF4FA]'>Biblioteca</h1>
          <p className='text-sm text-[#96A0AB]'>Vista principal de archivos con filtros, orden y acciones rápidas.</p>
        </div>

        <div className='flex items-center gap-2'>
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
            className='h-10 rounded-lg border border-[#2A3036] bg-[#14191E] px-3 text-sm text-[#D7DEE7]'
          >
            {[
              { value: 'all', label: 'Todos' },
              { value: 'downloaded', label: 'Descargados' },
              { value: 'downloading', label: 'Descargando' },
              { value: 'failed', label: 'Fallidos' },
              { value: 'offline', label: 'Cola local' },
            ].map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>

          <button type='button' className='icon-toggle' onClick={() => setView('grid')}>
            <Grid2x2 size={16} className={view === 'grid' ? 'text-[#A3FF12]' : 'text-[#8C97A2]'} />
          </button>
          <button type='button' className='icon-toggle' onClick={() => setView('table')}>
            <List size={16} className={view === 'table' ? 'text-[#A3FF12]' : 'text-[#8C97A2]'} />
          </button>
        </div>
      </div>

      {activeDownloads.length > 0 && (
        <article className='surface-card p-4'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Descargando ahora</h2>
            <span className='text-xs text-[#8E98A3]'>{activeDownloads.length} activas</span>
          </div>
          <div className='space-y-2'>
            {activeDownloads.slice(0, 8).map((item) => {
              const progress = Math.max(0, Math.min(100, Number(item.progressPercent ?? 8)));
              return (
                <button
                  type='button'
                  key={item.localId}
                  onClick={() => navigate(`/downloads/${item.localId}`)}
                  className='w-full rounded-lg border border-[#252D34] bg-[#151B20] px-3 py-2 text-left hover:border-[#33404A]'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <p className='line-clamp-3 text-xs font-semibold text-[#EAF0F7]'>{item.customName ?? item.title}</p>
                    <span className='text-[11px] font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
                  </div>
                  <p className='mt-0.5 line-clamp-1 text-[11px] text-[#9AA4AF]'>{item.progressLine || 'Procesando descarga...'}</p>
                  <div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                    <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </article>
      )}

      {view === 'grid' ? (
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          {rows.map((item) => (
            <DownloadCard
              key={item.localId}
              item={item}
              onPlay={() => onPlay(item.localId)}
              onOpen={() => navigate(`/downloads/${item.localId}`)}
              onPlaylist={() => setPlaylistTargetLocalId(item.localId)}
              onRetry={() => void retryItem(item.localId)}
              onRename={() => void renameItem(item.localId)}
              onDelete={() => void deleteItem(item.localId)}
            />
          ))}
        </div>
      ) : (
        <DownloadsTable
          rows={rows}
          onPlay={(item) => onPlay(item.localId)}
          onOpen={(item) => navigate(`/downloads/${item.localId}`)}
          onPlaylist={(item) => setPlaylistTargetLocalId(item.localId)}
          onRetry={(item) => void retryItem(item.localId)}
          onRename={(item) => void renameItem(item.localId)}
          onDelete={(item) => void deleteItem(item.localId)}
        />
      )}

      {rows.length === 0 && (
        <article className='surface-card p-4'>
          <p className='text-sm text-[#D2D9E2]'>No hay elementos visibles con los filtros actuales.</p>
          <p className='mt-1 text-xs text-[#8F99A4]'>
            Filtro: <span className='text-[#E7EDF5]'>{filterStatus}</span>
            {search ? (
              <>
                {' '}• búsqueda activa: <span className='text-[#F7E733]'>"{searchRaw}"</span>
              </>
            ) : null}
          </p>
          {search && (
            <button
              type='button'
              onClick={() => setSearch('')}
              className='mt-3 rounded-md border border-[#6B6420] bg-[#2B2B16] px-3 py-1 text-xs text-[#F7E733]'
            >
              Limpiar búsqueda global
            </button>
          )}
        </article>
      )}

      {playlistTargetItem && (
        <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center'>
          <article className='max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-[#2A3138] bg-[#10161B] p-4'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <h2 className='text-lg font-semibold text-[#EAF0F7]'>Listas de reproducción</h2>
                <p className='mt-1 line-clamp-2 text-sm text-[#9AA4AF]'>{playlistTargetItem.customName ?? playlistTargetItem.title}</p>
              </div>
              <button
                type='button'
                onClick={() => setPlaylistTargetLocalId(null)}
                className='rounded-md border border-[#3B4148] bg-[#1A1F24] px-3 py-1 text-xs text-[#D3DAE3]'
              >
                Cerrar
              </button>
            </div>

            <div className='mt-4 rounded-lg border border-[#252D34] bg-[#141A1F] p-3'>
              <p className='text-xs uppercase tracking-[0.08em] text-[#8E99A5]'>Crear nueva lista</p>
              <div className='mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]'>
                <input
                  value={newPlaylistName}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  placeholder='Nombre de la lista'
                  className='h-10 rounded-md border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4] outline-none'
                />
                <input
                  value={newPlaylistDescription}
                  onChange={(event) => setNewPlaylistDescription(event.target.value)}
                  placeholder='Descripción (opcional)'
                  className='h-10 rounded-md border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4] outline-none'
                />
                <div className='flex items-center gap-2 rounded-md border border-[#2A3036] bg-[#151A1F] px-2'>
                  {playlistColorOptions.map((value) => (
                    <button
                      key={value}
                      type='button'
                      onClick={() => setNewPlaylistColor(value)}
                      className={`h-5 w-5 rounded-full border ${newPlaylistColor === value ? 'border-[#E6ECF4]' : 'border-transparent'}`}
                      style={{ backgroundColor: value }}
                    />
                  ))}
                </div>
              </div>
              <button
                type='button'
                onClick={() => void createPlaylist()}
                disabled={!newPlaylistName.trim()}
                className='mt-2 h-9 rounded-md border border-[#2F5B2B] bg-[#162516] px-3 text-xs font-semibold text-[#A3FF12] disabled:opacity-50'
              >
                Crear y añadir
              </button>
            </div>

            <div className='mt-4 space-y-2'>
              {(collections ?? []).map((collection) => {
                const included = collection.itemIds.includes(playlistTargetItem.localId);
                return (
                  <div key={collection.localId} className='rounded-lg border border-[#252D34] bg-[#141A1F] p-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div className='min-w-0'>
                        <p className='truncate text-sm font-semibold text-[#E6ECF4]'>{collection.name}</p>
                        <p className='text-xs text-[#93A0AD]'>{collection.description || 'Sin descripción'}</p>
                      </div>
                      <div className='flex flex-wrap items-center gap-1'>
                        <button
                          type='button'
                          onClick={() => void toggleItemInCollection(collection, playlistTargetItem.localId)}
                          className={`rounded-md border px-2 py-1 text-xs ${
                            included
                              ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
                              : 'border-[#2F5B2B] bg-[#162516] text-[#A3FF12]'
                          }`}
                        >
                          {included ? 'Quitar' : 'Añadir'}
                        </button>
                        <button
                          type='button'
                          onClick={() => void editPlaylist(collection)}
                          className='rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 py-1 text-xs text-[#D3DAE3]'
                        >
                          Editar
                        </button>
                        <button
                          type='button'
                          onClick={() => void deletePlaylist(collection)}
                          className='rounded-md border border-[#5A2028] bg-[#2A1316] px-2 py-1 text-xs text-[#FFB7BD]'
                        >
                          Eliminar lista
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(collections ?? []).length === 0 && (
                <p className='text-xs text-[#8F99A4]'>No hay listas aún. Crea la primera arriba.</p>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
