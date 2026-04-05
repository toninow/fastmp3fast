import { Download, ListPlus, Pause, Play, Subtitles, Tag } from 'lucide-react';
import type { DownloadItem } from '../../types/models';
import { StatusBadge } from '../common/StatusBadge';
import { formatDuration } from '../../lib/format';
import { buildDownloadUrl, isDownloadReady } from '../../lib/mediaAccess';
import { resolveDownloadCover } from '../../lib/covers';

interface DownloadCardProps {
  item: DownloadItem;
  onPlay: (item: DownloadItem) => void;
  onOpen: (item: DownloadItem) => void;
  onPlaylist?: (item: DownloadItem) => void;
  onRetry?: (item: DownloadItem) => void;
  onRename?: (item: DownloadItem) => void;
  onDelete?: (item: DownloadItem) => void;
}

export function DownloadCard({ item, onPlay, onOpen, onPlaylist, onRetry, onRename, onDelete }: DownloadCardProps) {
  const downloadUrl = buildDownloadUrl(item);
  const cover = resolveDownloadCover(item);
  const canPlay = isDownloadReady(item);
  const isDownloading = !canPlay && ['pending', 'queued', 'processing', 'syncing', 'offline'].includes(item.status);
  const progress = Math.max(0, Math.min(100, Number(item.progressPercent ?? (isDownloading ? 8 : 0))));
  const rawError = typeof item.error === 'string' ? item.error.trim() : '';
  const antiBotBlocked = /anti-bot|not a bot/i.test(rawError);
  const errorSummary = antiBotBlocked
    ? 'YouTube bloqueó temporalmente esta descarga. Sube cookies.txt en Configuración del sistema y reintenta.'
    : rawError;

  return (
    <article className='group media-card media-card-hover p-3'>
      <div className='media-card-cover relative mb-3 h-40 rounded-lg border-b-0 bg-[#0C0F12]'>
        {cover ? (
          <img src={cover} alt={item.title} className='h-full w-full object-cover opacity-90' />
        ) : (
          <div className='grid h-full place-items-center text-sm text-[#6F7782]'>Sin portada</div>
        )}

        <button
          type='button'
          onClick={() => canPlay && onPlay(item)}
          disabled={!canPlay}
          className={`absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full border transition ${
            canPlay
              ? 'border-[#2F5B2B] bg-[#142016] text-[#A3FF12] shadow-[0_0_14px_rgba(163,255,18,.18)] hover:scale-105'
              : 'cursor-not-allowed border-[#3D434A] bg-[#1B1F24] text-[#7E8792]'
          }`}
          title={canPlay ? 'Reproducir' : item.error ? 'Descarga con error' : 'Aún descargando'}
        >
          {item.status === 'playing' ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>

      <div className='flex items-start justify-between gap-2'>
        <button type='button' onClick={() => onOpen(item)} className='text-left'>
          <p className='line-clamp-3 text-sm font-semibold text-[#EAF0F7]'>{item.customName ?? item.title}</p>
          <p className='mt-0.5 text-[11px] uppercase tracking-[0.08em] text-[#7C8590]'>
            {item.mediaKind} • {formatDuration(item.durationSeconds)}
          </p>
        </button>
        <StatusBadge status={item.status} item={item} />
      </div>

      {isDownloading && (
        <div className='mt-2 rounded-lg border border-[#2A323A] bg-[#141A1F] p-2'>
          <div className='flex items-center justify-between gap-2'>
            <p className='line-clamp-1 text-[11px] text-[#9AA4AF]'>{item.progressLine || 'Procesando descarga...'}</p>
            <span className='text-[11px] font-semibold text-[#A3FF12]'>{progress.toFixed(0)}%</span>
          </div>
          <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-[#222932]'>
            <div className='h-full rounded-full bg-[#A3FF12] transition-all' style={{ width: `${progress}%` }} />
          </div>
          <div className='mt-1 flex flex-wrap gap-2 text-[10px] text-[#8E98A3]'>
            {item.progressSpeed && <span>{item.progressSpeed}</span>}
            {item.progressEta && <span>ETA {item.progressEta}</span>}
          </div>
        </div>
      )}

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {item.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className='inline-flex items-center gap-1 rounded-md border border-[#313841] bg-[#1A2026] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#B8C0CB]'
          >
            <Tag size={10} />
            {tag}
          </span>
        ))}

        {item.subtitleLanguages.length > 0 && (
          <span className='inline-flex items-center gap-1 rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#F7E733]'>
            <Subtitles size={10} />
            {item.subtitleLanguages.join(', ')}
          </span>
        )}
        {rawError && (
          <span className='inline-flex items-center gap-1 rounded-md border border-[#5A2028] bg-[#2A1316] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#FFB7BD]'>
            {antiBotBlocked ? 'YouTube bloqueó' : 'Error'}
          </span>
        )}
        {onRetry && rawError && (
          <button
            type='button'
            onClick={() => onRetry(item)}
            className='rounded-md border border-[#3D5A2B] bg-[#1B2A17] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#B9FF5A]'
          >
            Reintentar
          </button>
        )}
        {onRename && (
          <button type='button' onClick={() => onRename(item)} className='rounded-md border border-[#6B6420] bg-[#2B2B16] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#F7E733]'>
            Renombrar
          </button>
        )}
        {onPlaylist && (
          <button
            type='button'
            onClick={() => onPlaylist(item)}
            className='inline-flex items-center gap-1 rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#D3DAE3]'
          >
            <ListPlus size={10} />
            Lista
          </button>
        )}
        {onDelete && (
          <button type='button' onClick={() => onDelete(item)} className='rounded-md border border-[#5A2028] bg-[#2A1316] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#FFB7BD]'>
            Eliminar
          </button>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            className='inline-flex items-center gap-1 rounded-md border border-[#2F5B2B] bg-[#162516] px-2 py-1 text-[10px] uppercase tracking-[0.07em] text-[#A3FF12]'
            download
          >
            <Download size={10} />
            Descargar
          </a>
        )}
      </div>
      {rawError && (
        <p className='mt-2 line-clamp-3 text-[11px] text-[#FFB7BD]' title={rawError}>
          {errorSummary}
        </p>
      )}
    </article>
  );
}
