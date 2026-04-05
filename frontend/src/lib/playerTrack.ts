import type { DownloadItem, PlayerTrack, SubtitleItem } from '../types/models';
import { buildStreamUrl } from './mediaAccess';
import { resolveDownloadCover } from './covers';

export function buildTrack(item: DownloadItem, subtitles: SubtitleItem[]): PlayerTrack {
  const streamUrl = buildStreamUrl(item);

  return {
    localId: item.localId,
    title: item.customName ?? item.title,
    mediaKind: item.mediaKind,
    src: streamUrl ?? '',
    poster: resolveDownloadCover(item),
    subtitles,
    durationSeconds: item.durationSeconds,
  };
}
