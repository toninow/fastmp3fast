import { db } from '../db/database';
import type { DownloadItem, SubtitleItem } from '../../types/models';
import { buildDownloadUrl, buildStreamUrl, buildSubtitleUrl } from '../mediaAccess';

function srtToVtt(input: string): string {
  const lines = ['WEBVTT', ''];
  for (const raw of input.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\d+$/.test(line.trim())) {
      continue;
    }
    if (line.includes('-->')) {
      lines.push(line.replace(/,/g, '.'));
      continue;
    }
    lines.push(line);
  }
  return `${lines.join('\n').trim()}\n`;
}

function resolveSubtitleFetchUrl(subtitle: SubtitleItem): string | null {
  if (/^https?:\/\//i.test(subtitle.path)) {
    return subtitle.path;
  }

  const idMatch = subtitle.localId.match(/^sub-(\d+)$/);
  if (idMatch) {
    return buildSubtitleUrl(idMatch[1]);
  }

  return null;
}

export async function cacheDownloadForOffline(download: DownloadItem, subtitles: SubtitleItem[]): Promise<void> {
  const mediaUrl = buildDownloadUrl(download) ?? buildStreamUrl(download);
  if (!mediaUrl) {
    throw new Error('No hay URL de archivo disponible para cache offline.');
  }

  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) {
    throw new Error(`No se pudo descargar media (${mediaResponse.status}).`);
  }

  const mediaBlob = await mediaResponse.blob();
  await db.offlineMedia.put({
    downloadLocalId: download.localId,
    mimeType: mediaBlob.type || 'application/octet-stream',
    sizeBytes: mediaBlob.size,
    blob: mediaBlob,
    updatedAt: new Date().toISOString(),
  });

  await db.offlineSubtitles.where('downloadLocalId').equals(download.localId).delete();

  for (const subtitle of subtitles) {
    const subtitleUrl = resolveSubtitleFetchUrl(subtitle);
    if (!subtitleUrl) {
      continue;
    }

    const response = await fetch(subtitleUrl);
    if (!response.ok) {
      continue;
    }

    let format = subtitle.format;
    let blob: Blob;
    if (subtitle.format === 'srt') {
      const raw = await response.text();
      blob = new Blob([srtToVtt(raw)], { type: 'text/vtt' });
      format = 'vtt';
    } else {
      blob = await response.blob();
    }

    await db.offlineSubtitles.add({
      cacheKey: `${download.localId}:${subtitle.localId}:${subtitle.language}`,
      downloadLocalId: download.localId,
      subtitleLocalId: subtitle.localId,
      language: subtitle.language,
      format,
      blob,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function removeOfflineCache(downloadLocalId: string): Promise<void> {
  await db.transaction('rw', [db.offlineMedia, db.offlineSubtitles], async () => {
    await db.offlineMedia.where('downloadLocalId').equals(downloadLocalId).delete();
    await db.offlineSubtitles.where('downloadLocalId').equals(downloadLocalId).delete();
  });
}
