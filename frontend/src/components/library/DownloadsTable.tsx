import { Download, Play } from 'lucide-react';
import type { DownloadItem } from '../../types/models';
import { formatBytes, formatDuration } from '../../lib/format';
import { StatusBadge } from '../common/StatusBadge';
import { buildDownloadUrl, isDownloadReady } from '../../lib/mediaAccess';

interface DownloadsTableProps {
  rows: DownloadItem[];
  onPlay: (item: DownloadItem) => void;
  onOpen: (item: DownloadItem) => void;
  onPlaylist?: (item: DownloadItem) => void;
  onRetry?: (item: DownloadItem) => void;
  onRename?: (item: DownloadItem) => void;
  onDelete?: (item: DownloadItem) => void;
}

export function DownloadsTable({ rows, onPlay, onOpen, onPlaylist, onRetry, onRename, onDelete }: DownloadsTableProps) {
  return (
    <div className='surface-card overflow-hidden'>
      <table className='min-w-full text-left text-sm'>
        <thead className='bg-[#151B20] text-xs uppercase tracking-[0.08em] text-[#8F98A3]'>
          <tr>
            <th className='px-4 py-3'>Titulo</th>
            <th className='px-4 py-3'>Tipo</th>
            <th className='px-4 py-3'>Duracion</th>
            <th className='px-4 py-3'>Tamano</th>
            <th className='px-4 py-3'>Estado</th>
            <th className='px-4 py-3'>Accion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const canPlay = isDownloadReady(item);
            const isDownloading = !canPlay && ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(item.status);
            const progress = Math.max(0, Math.min(100, Number(item.progressPercent ?? (isDownloading ? 8 : 0))));
            const rawError = typeof item.error === 'string' ? item.error.trim() : '';
            const antiBotBlocked = /anti-bot|not a bot/i.test(rawError);
            const errorSummary = antiBotBlocked
              ? 'YouTube bloqueó temporalmente esta descarga. Sube cookies.txt en Configuración del sistema y reintenta.'
              : rawError;
            return (
              <tr key={item.localId} className='border-t border-[#21272E] transition hover:bg-[#171D22]'>
              <td className='px-4 py-3'>
                <button type='button' onClick={() => onOpen(item)} className='text-left'>
                  <p className='font-medium text-[#E6EBF3]'>{item.customName ?? item.title}</p>
                  <p className='text-xs text-[#7B848F]'>{item.uploader ?? 'Desconocido'}</p>
                </button>
              </td>
              <td className='px-4 py-3 text-[#C7CFD8]'>{item.mediaKind}</td>
              <td className='px-4 py-3 text-[#C7CFD8]'>{formatDuration(item.durationSeconds)}</td>
              <td className='px-4 py-3 text-[#C7CFD8]'>{formatBytes(item.sizeBytes)}</td>
              <td className='px-4 py-3'>
                <StatusBadge status={item.status} item={item} />
                {isDownloading && (
                  <div className='mt-2 max-w-[260px] rounded border border-[#2A323A] bg-[#141A1F] p-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='line-clamp-1 text-[10px] text-[#9AA4AF]'>{item.progressLine || 'Procesando descarga...'}</span>
                      <span className='text-[10px] font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
                    </div>
                    <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
                      <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}
                {rawError && <p className='mt-1 max-w-[320px] line-clamp-2 text-[11px] text-[#FFB7BD]' title={rawError}>{errorSummary}</p>}
              </td>
              <td className='px-4 py-3'>
                <div className='flex flex-wrap gap-1'>
                  <button
                    type='button'
                    onClick={() => canPlay && onPlay(item)}
                    disabled={!canPlay}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                      canPlay
                        ? 'border-[#2F5B2B] bg-[#142016] text-[#A3FF12]'
                        : 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#8A93A0]'
                    }`}
                    title={canPlay ? 'Reproducir' : item.error ? 'Descarga con error' : 'Aún descargando'}
                  >
                    <Play size={12} />
                    Reproducir
                  </button>
                  {onRename && (
                    <button
                      type='button'
                      onClick={() => onRename(item)}
                      className='rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 py-1 text-xs text-[#F7E733]'
                    >
                      Renombrar
                    </button>
                  )}
                  {onPlaylist && (
                    <button
                      type='button'
                      onClick={() => onPlaylist(item)}
                      className='rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 py-1 text-xs text-[#D3DAE3]'
                    >
                      Lista
                    </button>
                  )}
                  {onRetry && rawError && (
                    <button
                      type='button'
                      onClick={() => onRetry(item)}
                      className='rounded-md border border-[#3D5A2B] bg-[#1B2A17] px-2 py-1 text-xs text-[#B9FF5A]'
                    >
                      Reintentar
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type='button'
                      onClick={() => onDelete(item)}
                      className='rounded-md border border-[#5A2028] bg-[#2A1316] px-2 py-1 text-xs text-[#FFB7BD]'
                    >
                      Eliminar
                    </button>
                  )}
                  {buildDownloadUrl(item) && (
                    <a
                      href={buildDownloadUrl(item) ?? '#'}
                      className='inline-flex items-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 py-1 text-xs text-[#A3FF12]'
                      download
                    >
                      <Download size={12} />
                      Descargar
                    </a>
                  )}
                </div>
              </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
