<?php

namespace App\Jobs;

use App\Models\SyncOperation;
use App\Services\Sync\SyncService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RetrySyncJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public int $syncOperationId)
    {
    }

    public function handle(SyncService $syncService): void
    {
        $op = SyncOperation::query()->find($this->syncOperationId);

        if (! $op || $op->status === 'synced') {
            return;
        }

        try {
            $syncService->markSynced($op);
        } catch (\Throwable $throwable) {
            $syncService->markError($op, $throwable->getMessage());
            throw $throwable;
        }
    }
}
