<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\Download;
use App\Services\Downloads\DownloadManagerService;
use App\Services\Downloads\YtDlpService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Symfony\Component\Process\Process;

class ProcessDownloadJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $downloadId)
    {
    }

    public function handle(YtDlpService $ytDlpService, DownloadManagerService $manager): void
    {
        $download = Download::query()->find($this->downloadId);

        if (! $download) {
            return;
        }

        $download->update(['status' => 'processing']);

        $outDir = $manager->buildOutputDir($download->user_id);
        $command = $ytDlpService->buildCommand($download->source_url, [
            'download_type' => $download->type,
            'subtitle_enabled' => ! empty($download->subtitle_languages),
            'subtitle_language' => $download->subtitle_languages[0] ?? 'es',
            'save_thumbnail' => true,
            'save_metadata' => true,
        ]);

        $command[] = '-o';
        $command[] = $outDir.'/%(title)s.%(ext)s';

        $process = new Process($command);
        $process->setTimeout(0);
        $process->run();

        if ($process->isSuccessful()) {
            $download->update([
                'status' => 'completed',
                'sync_status' => 'synced',
                'downloaded_at' => now(),
                'file_exists' => true,
                'error_message' => null,
            ]);

            ActivityLog::query()->create([
                'user_id' => $download->user_id,
                'download_id' => $download->id,
                'event' => 'download_completed',
                'description' => 'Download finished successfully.',
                'context' => ['stdout' => trim($process->getOutput())],
                'occurred_at' => now(),
            ]);

            return;
        }

        $download->update([
            'status' => 'error',
            'error_message' => trim($process->getErrorOutput()) ?: 'Download failed',
        ]);

        ActivityLog::query()->create([
            'user_id' => $download->user_id,
            'download_id' => $download->id,
            'event' => 'download_failed',
            'description' => 'Download failed in processing job.',
            'context' => ['stderr' => trim($process->getErrorOutput())],
            'occurred_at' => now(),
        ]);
    }
}
