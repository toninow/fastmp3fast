<?php

return [
    'yt_dlp_binary' => env('YT_DLP_BINARY', 'yt-dlp'),
    'ffmpeg_binary' => env('FFMPEG_BINARY', 'ffmpeg'),
    'downloads_disk' => env('FASTMP3FAST_DOWNLOADS_DISK', 'local'),
    'default_subtitle_language' => env('FASTMP3FAST_DEFAULT_SUBTITLE_LANGUAGE', 'es'),
    'max_sync_retries' => (int) env('FASTMP3FAST_MAX_SYNC_RETRIES', 5),
];
