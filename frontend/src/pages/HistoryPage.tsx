import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db/database';

export function HistoryPage() {
  const rows = useLiveQuery(() => db.recentActivity.orderBy('createdAt').reverse().toArray(), []);

  return (
    <section className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold text-[#EFF4FA]'>Historial / Actividad</h1>
        <p className='text-sm text-[#96A0AB]'>Timeline profesional de descargas, reproducción y sincronización.</p>
      </div>

      <div className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <div className='space-y-2'>
          {(rows ?? []).map((row) => (
            <div key={row.localId} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-3'>
              <p className='text-sm text-[#D9E0E8]'>{row.description}</p>
              <p className='mt-1 text-xs uppercase tracking-[0.07em] text-[#8B95A0]'>
                {row.event} • {new Date(row.createdAt).toLocaleString()} {row.isOfflineEvent ? '• OFFLINE' : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
