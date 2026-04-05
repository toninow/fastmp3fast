<?php

namespace App\Services\Downloads;

class FileScannerService
{
    public function detectMediaFile(string $directory, string $baseName): ?string
    {
        $glob = glob(rtrim($directory, '/').'/'.$baseName.'.*');

        return $glob[0] ?? null;
    }

    public function detectSubtitles(string $directory, string $baseName): array
    {
        return glob(rtrim($directory, '/').'/'.$baseName.'*.{srt,vtt}', GLOB_BRACE) ?: [];
    }
}
