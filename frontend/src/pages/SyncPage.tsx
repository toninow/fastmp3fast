import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { db } from '../lib/db/database';
import { processPendingOperations } from '../lib/offline/syncQueue';
import { getOperationStatusText, getSyncStatusText } from '../lib/syncStatus';

export function SyncPage() {
  const syncState = useLiveQuery(() => db.syncState.get('global'));
  const pending = useLiveQuery(() => db.pendingOperations.orderBy('createdAt').reverse().toArray(), []);
  const currentStatus = String(syncState?.status ?? 'idle');
  const stateTone =
    currentStatus === 'sync_error'
      ? 'red'
      : currentStatus === 'offline'
        ? 'yellow'
        : 'green';

  return (
    <section className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-[#EFF4FA]'>Sincronización</h1>
          <p className='text-sm text-[#96A0AB]'>Centro de control técnico de cola local y backend.</p>
        </div>
        <button
          type='button'
          onClick={() => void processPendingOperations()}
          className='inline-flex items-center gap-2 rounded-lg border border-[#2F5B2B] bg-[#182516] px-3 py-2 text-sm text-[#A3FF12]'
        >
          <RefreshCw size={14} /> Sincronizar ahora
        </button>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <SyncStat label='Estado' value={getSyncStatusText(currentStatus)} tone={stateTone} />
        <SyncStat label='Pendientes' value={String((pending ?? []).filter((x) => x.status === 'pending').length)} tone='yellow' />
        <SyncStat label='Sincronizadas' value={String((pending ?? []).filter((x) => x.status === 'synced').length)} tone='green' />
        <SyncStat label='Errores' value={String((pending ?? []).filter((x) => x.status === 'error').length)} tone='red' />
      </div>

      <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Cola local + historial</h2>
        <div className='mt-3 space-y-2'>
          {(pending ?? []).map((op) => (
            <div key={op.localId} className='rounded-lg border border-[#242A30] bg-[#151B20] px-3 py-2'>
              <p className='text-sm text-[#D8DEE7]'>
                {op.operation} • {op.entityType}
              </p>
              <p className='text-xs text-[#8D97A2]'>
                {getOperationStatusText(op.status)} • intentos: {op.attempts}
              </p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function SyncStat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'yellow' | 'red' }) {
  const styles =
    tone === 'green'
      ? 'border-[#2F5B2B] bg-[#132016] text-[#A3FF12]'
      : tone === 'yellow'
      ? 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
      : 'border-[#5A2028] bg-[#2A1316] text-[#FFB7BD]';

  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <p className='text-xs uppercase tracking-[0.08em]'>{label}</p>
      <p className='mt-1 text-2xl font-bold'>{value}</p>
    </div>
  );
}
