import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FolderOpen, FolderPlus, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db/database';
import { apiEndpoints } from '../lib/api/endpoints';
import { enqueueOperation, processPendingOperations, refreshCollectionsFromBackend } from '../lib/offline/syncQueue';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useUiStore } from '../store/uiStore';
import { resolveDownloadCover } from '../lib/covers';
import type { CollectionItem, DownloadItem } from '../types/models';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';
import { isDownloadReady } from '../lib/mediaAccess';

const colorOptions = ['#A3FF12', '#F7E733', '#6EE7B7', '#67E8F9', '#F97316'];

export function CollectionsPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const pushToast = useUiStore((state) => state.pushNotification);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const collections = useLiveQuery(() => db.collections.orderBy('order').toArray(), []);
  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);

  const [creating, setCreating] = useState(false);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#A3FF12');

  const editingCollection =
    editingLocalId && collections ? collections.find((item) => item.localId === editingLocalId) ?? null : null;
  const downloadByLocalId = useMemo(() => {
    const map = new Map<string, DownloadItem>();
    for (const row of downloads ?? []) {
      map.set(row.localId, row);
    }
    return map;
  }, [downloads]);

  useEffect(() => {
    if (!online) {
      return;
    }

    void refreshCollectionsFromBackend();
  }, [online]);

  const createList = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const localId = `col-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const payload = {
      local_id: localId,
      name: trimmedName,
      description: description.trim() || null,
      color,
      icon: 'folder',
      sort_order: collections?.length ?? 0,
      item_ids: [],
    };

    await db.collections.put({
      localId,
      remoteId: null,
      name: trimmedName,
      description: description.trim(),
      color,
      icon: 'folder',
      order: collections?.length ?? 0,
      itemIds: [],
      updatedAt: createdAt,
    });

    if (!online) {
      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'create',
        entityType: 'collection',
        entityLocalId: localId,
        payload,
      });
      pushToast({
        id: crypto.randomUUID(),
        title: 'Lista creada en local',
        body: 'Se sincronizará cuando vuelva la conexión.',
        createdAt,
      });
    } else {
      try {
        await apiEndpoints.createCollection(payload);
        await refreshCollectionsFromBackend();
        pushToast({
          id: crypto.randomUUID(),
          title: 'Lista creada',
          body: 'La lista ya está disponible en backend y local.',
          createdAt,
        });
      } catch {
        await enqueueOperation({
          localId: crypto.randomUUID(),
          operation: 'create',
          entityType: 'collection',
          entityLocalId: localId,
          payload,
        });
        await processPendingOperations().catch(() => undefined);
        await refreshCollectionsFromBackend().catch(() => undefined);
        pushToast({
          id: crypto.randomUUID(),
          title: 'Lista creada con cola local',
          body: 'No se pudo confirmar con backend ahora; reintentaremos sync automático.',
          createdAt,
        });
      }
    }

    setName('');
    setDescription('');
    setColor('#A3FF12');
    setCreating(false);
  };

  const openEdit = (collection: CollectionItem) => {
    setCreating(false);
    setEditingLocalId(collection.localId);
    setName(collection.name);
    setDescription(collection.description ?? '');
    setColor(collection.color || '#A3FF12');
  };

  const cancelEditor = () => {
    setCreating(false);
    setEditingLocalId(null);
    setName('');
    setDescription('');
    setColor('#A3FF12');
  };

  const updateList = async () => {
    if (!editingCollection) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const payload = {
      local_id: editingCollection.localId,
      name: trimmedName,
      description: description.trim() || null,
      color,
      icon: editingCollection.icon || 'folder',
      sort_order: editingCollection.order ?? 0,
      item_ids: editingCollection.itemIds ?? [],
    };

    await db.collections.where('localId').equals(editingCollection.localId).modify({
      name: trimmedName,
      description: description.trim(),
      color,
      updatedAt,
    });

    if (online && editingCollection.remoteId) {
      try {
        await apiEndpoints.updateCollection(editingCollection.remoteId, payload);
        await refreshCollectionsFromBackend();
      } catch {
        await enqueueOperation({
          localId: crypto.randomUUID(),
          operation: 'upsert',
          entityType: 'collection',
          entityLocalId: editingCollection.localId,
          payload,
        });
        await processPendingOperations().catch(() => undefined);
        await refreshCollectionsFromBackend().catch(() => undefined);
      }
    } else {
      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'upsert',
        entityType: 'collection',
        entityLocalId: editingCollection.localId,
        payload,
      });
      if (online) {
        await processPendingOperations().catch(() => undefined);
        await refreshCollectionsFromBackend().catch(() => undefined);
      }
    }

    pushToast({
      id: crypto.randomUUID(),
      title: 'Lista actualizada',
      body: `"${trimmedName}" se actualizó correctamente.`,
      createdAt: updatedAt,
    });
    cancelEditor();
  };

  const deleteList = async (collection: CollectionItem) => {
    const confirmed = window.confirm(`¿Eliminar la lista "${collection.name}"? Esto NO elimina archivos MP3/MP4.`);
    if (!confirmed) {
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
          payload: {
            local_id: collection.localId,
            remote_id: Number(collection.remoteId),
          },
        });
      }
    } else {
      await enqueueOperation({
        localId: crypto.randomUUID(),
        operation: 'delete',
        entityType: 'collection',
        entityLocalId: collection.localId,
        payload: {
          local_id: collection.localId,
          remote_id: collection.remoteId ? Number(collection.remoteId) : null,
        },
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
      body: `Se eliminó "${collection.name}" sin borrar tus descargas.`,
      createdAt: new Date().toISOString(),
    });
    if (editingLocalId === collection.localId) {
      cancelEditor();
    }
  };

  const getCollectionCovers = (collection: CollectionItem): string[] => {
    const ids = Array.isArray(collection.itemIds) ? collection.itemIds : [];
    const covers: string[] = [];
    for (const itemId of ids) {
      const row = downloadByLocalId.get(itemId);
      if (!row) {
        continue;
      }
      const cover = resolveDownloadCover(row);
      if (!cover) {
        continue;
      }
      covers.push(cover);
      if (covers.length >= 4) {
        break;
      }
    }
    return covers;
  };

  const playCollection = (collection: CollectionItem) => {
    const ids = Array.isArray(collection.itemIds) ? collection.itemIds : [];
    const orderedItems = ids
      .map((itemId) => downloadByLocalId.get(itemId))
      .filter((item): item is DownloadItem => Boolean(item));

    const playableItems = orderedItems.filter((item) => isDownloadReady(item));
    if (playableItems.length === 0) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Lista sin medios descargados',
        body: 'Descarga al menos un MP3 o MP4 de esta lista para poder reproducirla.',
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const tracks = playableItems.map((item) =>
      buildTrack(item, (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId))
    );
    setQueue(tracks, tracks[0]?.localId);

    if (playableItems.length < orderedItems.length) {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Reproducción iniciada',
        body: `Se omitieron ${orderedItems.length - playableItems.length} elementos no descargados.`,
        createdAt: new Date().toISOString(),
      });
    }
  };

  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-[#EFF4FA]'>Listas / Colecciones</h1>
          <p className='text-sm text-[#96A0AB]'>Organiza contenido por áreas, contexto o flujo de reproducción.</p>
        </div>
        <button
          type='button'
          onClick={() => {
            if (creating) {
              cancelEditor();
              return;
            }
            setEditingLocalId(null);
            setCreating(true);
            setName('');
            setDescription('');
            setColor('#A3FF12');
          }}
          className='inline-flex items-center gap-2 rounded-lg border border-[#2F5B2B] bg-[#182516] px-3 py-2 text-sm text-[#A3FF12]'
        >
          <FolderPlus size={15} /> Nueva lista
        </button>
      </div>

      {(creating || Boolean(editingCollection)) && (
        <article className='surface-card p-4'>
          <p className='text-xs uppercase tracking-[0.08em] text-[#8C97A2]'>{editingCollection ? 'Editar lista' : 'Crear lista'}</p>
          <div className='mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]'>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Nombre de lista'
              className='h-11 rounded-lg border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4] outline-none focus:border-[#2F5B2B]'
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder='Descripción opcional'
              className='h-11 rounded-lg border border-[#2A3036] bg-[#151A1F] px-3 text-sm text-[#E6ECF4] outline-none focus:border-[#2F5B2B]'
            />
            <div className='flex items-center gap-2 rounded-lg border border-[#2A3036] bg-[#151A1F] px-2'>
              {colorOptions.map((value) => (
                <button
                  key={value}
                  type='button'
                  onClick={() => setColor(value)}
                  aria-label={`Color ${value}`}
                  className={`h-6 w-6 rounded-full border ${color === value ? 'border-[#E6ECF4]' : 'border-transparent'}`}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
          </div>
          <div className='mt-3 flex gap-2'>
            <button
              type='button'
              onClick={() => void (editingCollection ? updateList() : createList())}
              disabled={!name.trim()}
              className='h-10 rounded-lg border border-[#2F5B2B] bg-[#182516] px-4 text-sm font-semibold text-[#A3FF12] disabled:opacity-50'
            >
              {editingCollection ? 'Guardar cambios' : 'Guardar lista'}
            </button>
            <button
              type='button'
              onClick={cancelEditor}
              className='h-10 rounded-lg border border-[#3B4148] bg-[#1A1F24] px-4 text-sm text-[#D3DAE3]'
            >
              Cancelar
            </button>
          </div>
        </article>
      )}

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {(collections ?? []).map((collection) => {
          const covers = getCollectionCovers(collection);
          return (
            <article key={collection.localId} className='media-card media-card-hover text-left'>
              <CollectionCoverMosaic name={collection.name} covers={covers} />

              <div className='p-4'>
                <div className='flex items-center justify-between'>
                  <p className='text-lg font-semibold text-[#E6ECF4]'>{collection.name}</p>
                  <span className='h-3 w-3 rounded-full' style={{ background: collection.color }} />
                </div>
                <p className='mt-2 line-clamp-2 text-sm text-[#9AA4AF]'>{collection.description || 'Sin descripción'}</p>
                <p className='mt-4 text-xs uppercase tracking-[0.08em] text-[#A3FF12]'>items: {collection.itemIds.length}</p>
                <div className='mt-3 grid grid-cols-2 gap-2'>
                  <button
                    type='button'
                    onClick={() => playCollection(collection)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#2F5B2B] bg-[#182516] px-2 text-xs text-[#A3FF12]'
                  >
                    <PlayCircle size={12} />
                    Reproducir
                  </button>
                  <button
                    type='button'
                    onClick={() => navigate(`/collections/${collection.localId}`)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 text-xs text-[#D3DAE3]'
                  >
                    <FolderOpen size={12} />
                    Abrir
                  </button>
                  <button
                    type='button'
                    onClick={() => openEdit(collection)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 text-xs text-[#F7E733]'
                  >
                    <Pencil size={12} />
                    Editar
                  </button>
                  <button
                    type='button'
                    onClick={() => void deleteList(collection)}
                    className='inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 text-xs text-[#FFB7BD]'
                  >
                    <Trash2 size={12} />
                    Eliminar
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {collections && collections.length === 0 && (
        <article className='surface-card p-4 text-sm text-[#96A0AB]'>
          Aún no tienes listas. Crea una con “Nueva lista” para empezar a organizar tu biblioteca.
        </article>
      )}
    </section>
  );
}

function CollectionCoverMosaic({ name, covers }: { name: string; covers: string[] }) {
  if (covers.length === 0) {
    return (
      <div className='media-card-cover grid h-40 place-items-center text-xs text-[#6E7782]'>
        Sin portadas
      </div>
    );
  }

  const layoutClass =
    covers.length === 1
      ? 'grid-cols-1'
      : covers.length === 2
        ? 'grid-cols-2'
        : covers.length === 3
          ? 'grid-cols-3'
          : 'grid-cols-2 grid-rows-2';

  return (
    <div className={`media-card-cover grid h-40 ${layoutClass}`}>
      {covers.slice(0, 4).map((cover, index) => (
        <img
          key={`${name}-${index}`}
          src={cover}
          alt={name}
          className='h-full w-full object-cover'
          loading='lazy'
        />
      ))}
    </div>
  );
}
