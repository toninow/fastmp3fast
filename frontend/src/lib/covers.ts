import type { DownloadItem } from '../types/models';

function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    if (host.includes('youtube.com')) {
      const fromQuery = parsed.searchParams.get('v');
      if (fromQuery) {
        return fromQuery;
      }

      const parts = parsed.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((part) => part === 'embed' || part === 'shorts' || part === 'live');
      if (marker >= 0 && parts[marker + 1]) {
        return parts[marker + 1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function getYoutubeCoverFromUrl(url?: string | null): string | null {
  if (!url) {
    return null;
  }

  const id = extractYoutubeVideoId(url);
  if (!id) {
    return null;
  }

  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function resolveDownloadCover(item: Pick<DownloadItem, 'thumbnailUrl' | 'sourceUrl'>): string | null {
  if (item.thumbnailUrl && item.thumbnailUrl.trim().length > 0) {
    return item.thumbnailUrl;
  }

  return getYoutubeCoverFromUrl(item.sourceUrl);
}
