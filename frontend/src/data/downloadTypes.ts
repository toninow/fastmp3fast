export const downloadTypeOptions = [
  { value: 'video_best', label: 'Video individual mejor calidad', mediaKind: 'video' },
  { value: 'video_mp4', label: 'Video individual MP4', mediaKind: 'video' },
  { value: 'audio_mp3', label: 'Audio individual MP3', mediaKind: 'audio' },
  { value: 'playlist_mp3', label: 'Playlist completa MP3', mediaKind: 'audio' },
  { value: 'playlist_mp4', label: 'Playlist completa MP4', mediaKind: 'video' },
  { value: 'channel_mp3', label: 'Canal completo MP3', mediaKind: 'audio' },
  { value: 'channel_mp4', label: 'Canal completo MP4', mediaKind: 'video' },
  { value: 'video_subtitles_es', label: 'Video + subtitulos en espanol', mediaKind: 'video' },
  { value: 'subtitles_only', label: 'Solo subtitulos', mediaKind: 'video' },
  { value: 'formats', label: 'Ver formatos disponibles', mediaKind: 'video' },
] as const;

export const qualityOptions = ['best', '4K', '1440p', '1080p', '720p', '480p'] as const;
export const audioQualityOptions = ['best', '320kbps', '256kbps', '192kbps', '128kbps'] as const;
