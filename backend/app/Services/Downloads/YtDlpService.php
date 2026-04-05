<?php

namespace App\Services\Downloads;

use Symfony\Component\Process\Process;

class YtDlpService
{
    public function buildCommand(string $url, array $options = []): array
    {
        $cmd = [config('fastmp3fast.yt_dlp_binary', 'yt-dlp')];

        if (($options['download_type'] ?? '') === 'audio_mp3') {
            $cmd = array_merge($cmd, ['-x', '--audio-format', 'mp3']);
        }

        if (! empty($options['subtitle_enabled'])) {
            $cmd[] = '--write-subs';
            $cmd[] = '--sub-langs';
            $cmd[] = $options['subtitle_language'] ?? 'es.*';
        }

        if (! empty($options['save_thumbnail'])) {
            $cmd[] = '--write-thumbnail';
        }

        if (! empty($options['save_metadata'])) {
            $cmd[] = '--write-info-json';
        }

        $cmd[] = '--no-progress';
        $cmd[] = '--newline';
        $cmd[] = $url;

        return $cmd;
    }

    public function probeFormats(string $url): array
    {
        $process = new Process([
            config('fastmp3fast.yt_dlp_binary', 'yt-dlp'),
            '-F',
            $url,
        ]);
        $process->setTimeout(90);
        $process->run();

        return [
            'success' => $process->isSuccessful(),
            'stdout' => $process->getOutput(),
            'stderr' => $process->getErrorOutput(),
        ];
    }
}
