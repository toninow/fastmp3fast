import clsx from 'clsx';
import type { DownloadStatus, DownloadItem } from '../../types/models';

const statusStyles: Record<DownloadStatus, string> = {
  pending: 'bg-[#2B2B16] text-[#F7E733] border-[#6B6420]',
  queued: 'bg-[#2B2B16] text-[#F7E733] border-[#6B6420]',
  processing: 'bg-[#1A2420] text-[#A3FF12] border-[#2F5B2B]',
  completed: 'bg-[#122216] text-[#A3FF12] border-[#2C6A2F]',
  error: 'bg-[#2A1316] text-[#FF7C84] border-[#5A2028]',
  offline: 'bg-[#1F1F1F] text-[#C9CDD2] border-[#3D434A]',
  syncing: 'bg-[#192227] text-[#67E8F9] border-[#224A5A]',
  playing: 'bg-[#122216] text-[#A3FF12] border-[#2C6A2F]',
  paused: 'bg-[#1F1F1F] text-[#A8AFB8] border-[#3D434A]',
};

function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case 'completed':
      return 'descargado';
    case 'processing':
      return 'descargando';
    case 'queued':
      return 'en cola';
    case 'offline':
      return 'cola local';
    case 'error':
      return 'error';
    case 'playing':
      return 'reproduciendo';
    case 'paused':
      return 'pausado';
    case 'syncing':
      return 'sync';
    case 'pending':
    default:
      return 'pendiente';
  }
}

function resolveStatus(
  status: DownloadStatus,
  item?: Pick<DownloadItem, 'fileAvailable' | 'downloadedAt' | 'mediaPath' | 'syncStatus' | 'error'>
): DownloadStatus {
  const hasFile = Boolean(item?.fileAvailable || item?.downloadedAt || item?.mediaPath);
  if (item?.error || status === 'error' || item?.syncStatus === 'sync_error') {
    return 'error';
  }
  if (hasFile) {
    return 'completed';
  }
  if (status === 'completed' && !hasFile) {
    return item?.syncStatus === 'syncing' ? 'processing' : 'error';
  }
  if (status === 'offline' || item?.syncStatus === 'local_only') {
    return 'offline';
  }
  if (status === 'processing' || status === 'queued' || status === 'pending' || status === 'syncing' || item?.syncStatus === 'syncing') {
    return 'processing';
  }
  return status;
}

export function StatusBadge({
  status,
  item,
}: {
  status: DownloadStatus;
  item?: Pick<DownloadItem, 'fileAvailable' | 'downloadedAt' | 'mediaPath' | 'syncStatus' | 'error'>;
}) {
  const finalStatus = resolveStatus(status, item);
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
        statusStyles[finalStatus]
      )}
    >
      {statusLabel(finalStatus)}
    </span>
  );
}
