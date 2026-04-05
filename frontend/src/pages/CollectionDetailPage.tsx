import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PlayCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { db } from '../lib/db/database';
import { usePlayerStore } from '../store/playerStore';
import { buildTrack } from '../lib/playerTrack';

export function CollectionDetailPage() {
  const { localId } = useParams();
  const collection = useLiveQuery(() => db.collections.where('localId').equals(localId ?? '').first(), [localId]);
  const downloads = useLiveQuery(() => db.downloads.toArray(), []);
  const subtitles = useLiveQuery(() => db.subtitles.toArray(), []);
  const setQueue = usePlayerStore((state) => state.setQueue);

  const items = useMemo(() => {
    if (!collection || !downloads) {
      return [];
    }

    return collection.itemIds
      .map((id) => downloads.find((item) => item.localId === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [collection, downloads]);

  if (!collection) {
    return <p className='text-sm text-[#95A0AC]'>Lista no encontrada.</p>;
  }

  return (
    <section className='space-y-4'>
      <div className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold text-[#EFF4FA]'>{collection.name}</h1>
            <p className='text-sm text-[#96A0AB]'>{collection.description}</p>
          </div>
          <button
            type='button'
            onClick={() =>
              setQueue(
                items.map((item) => buildTrack(item, (subtitles ?? []).filter((sub) => sub.downloadLocalId === item.localId)))
              )
            }
            className='inline-flex items-center gap-2 rounded-lg border border-[#2F5B2B] bg-[#182516] px-3 py-2 text-sm text-[#A3FF12]'
          >
            <PlayCircle size={15} /> Reproducir todo
          </button>
        </div>
      </div>

      <div className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Elementos ordenables</h2>
        <div className='mt-3 space-y-2'>
          {items.map((item, index) => (
            <div key={item.localId} className='flex items-center justify-between rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2'>
              <p className='text-sm text-[#D5DDE7]'>
                {index + 1}. {item.customName ?? item.title}
              </p>
              <p className='text-xs uppercase tracking-[0.08em] text-[#F7E733]'>{item.mediaKind}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
