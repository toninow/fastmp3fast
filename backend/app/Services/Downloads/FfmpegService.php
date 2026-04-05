<?php

namespace App\Services\Downloads;

use Symfony\Component\Process\Process;

class FfmpegService
{
    public function isAvailable(): bool
    {
        $process = new Process([config('fastmp3fast.ffmpeg_binary', 'ffmpeg'), '-version']);
        $process->run();

        return $process->isSuccessful();
    }

    public function convertSrtToVtt(string $srtPath, string $vttPath): bool
    {
        $process = new Process([
            config('fastmp3fast.ffmpeg_binary', 'ffmpeg'),
            '-i',
            $srtPath,
            $vttPath,
            '-y',
        ]);
        $process->setTimeout(120);
        $process->run();

        return $process->isSuccessful();
    }
}
