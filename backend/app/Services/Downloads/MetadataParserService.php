<?php

namespace App\Services\Downloads;

class MetadataParserService
{
    public function parse(array $payload): array
    {
        return [
            'title' => $payload['title'] ?? 'Untitled',
            'uploader' => $payload['uploader'] ?? null,
            'duration_seconds' => $payload['duration'] ?? null,
            'format' => $payload['ext'] ?? null,
            'size_bytes' => $payload['filesize'] ?? null,
            'thumbnail_url' => $payload['thumbnail'] ?? null,
            'raw' => $payload,
        ];
    }
}
