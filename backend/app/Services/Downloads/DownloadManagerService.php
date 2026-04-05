<?php

namespace App\Services\Downloads;

use App\Jobs\ProcessDownloadJob;
use App\Models\ActivityLog;
use App\Models\Download;

class DownloadManagerService
{
    public function queue(Download $download): void
    {
        ProcessDownloadJob::dispatch($download->id);

        ActivityLog::query()->create([
            'user_id' => $download->user_id,
            'download_id' => $download->id,
            'event' => 'download_queued',
            'description' => 'Download added to processing queue.',
            'context' => ['status' => $download->status],
            'occurred_at' => now(),
        ]);
    }

    public function buildOutputDir(int $userId): string
    {
        $base = storage_path('app/private/downloads/'.$userId);

        if (! is_dir($base)) {
            mkdir($base, 0755, true);
        }

        return $base;
    }
}
