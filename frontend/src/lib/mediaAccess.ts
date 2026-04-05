import { useAuthStore } from '../store/authStore';
import type { DownloadItem } from '../types/models';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/fastmp3fast/api/v1';

export function appendAccessToken(url: string): string {
  const token = useAuthStore.getState().token;
  if (!token) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}

function hasRemoteId(item: DownloadItem): boolean {
  return typeof item.remoteId === 'string' && item.remoteId.trim().length > 0;
}

function hasLocalId(item: DownloadItem): boolean {
  return typeof item.localId === 'string' && item.localId.trim().length > 0;
}

type DownloadLike = Pick<DownloadItem, 'fileAvailable' | 'downloadedAt' | 'mediaPath' | 'status'>;

export function isDownloadReady(item: DownloadLike): boolean {
  return Boolean(item.fileAvailable || item.downloadedAt || item.mediaPath || item.status === 'playing' || item.status === 'paused');
}

export function buildStreamUrl(item: DownloadItem): string | null {
  if (!isDownloadReady(item)) {
    return null;
  }

  if (hasRemoteId(item)) {
    return appendAccessToken(`${API_BASE}/downloads/${encodeURIComponent(String(item.remoteId))}/stream`);
  }

  if (hasLocalId(item)) {
    return appendAccessToken(`${API_BASE}/downloads/by-local/${encodeURIComponent(item.localId)}/stream`);
  }

  if (item.mediaPath && /^https?:\/\//i.test(item.mediaPath)) {
    return item.mediaPath;
  }

  return null;
}

export function buildDownloadUrl(item: DownloadItem): string | null {
  if (!isDownloadReady(item)) {
    return null;
  }

  if (hasRemoteId(item)) {
    return appendAccessToken(`${API_BASE}/downloads/${encodeURIComponent(String(item.remoteId))}/download`);
  }

  if (hasLocalId(item)) {
    return appendAccessToken(`${API_BASE}/downloads/by-local/${encodeURIComponent(item.localId)}/download`);
  }

  return null;
}

export function buildSubtitleUrl(subtitleId: number | string): string {
  return appendAccessToken(`${API_BASE}/subtitles/${encodeURIComponent(String(subtitleId))}/file`);
}
