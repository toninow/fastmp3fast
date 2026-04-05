<?php

namespace App\Services\Sync;

use App\Models\SyncOperation;
use App\Models\User;

class SyncService
{
    public function registerPending(User $user, array $operation): SyncOperation
    {
        return SyncOperation::query()->create([
            'user_id' => $user->id,
            'operation' => $operation['operation'] ?? 'unknown',
            'entity_type' => $operation['entity_type'] ?? 'unknown',
            'entity_local_id' => $operation['entity_local_id'] ?? null,
            'entity_remote_id' => $operation['entity_remote_id'] ?? null,
            'payload' => $operation['payload'] ?? null,
            'status' => 'pending',
            'attempts' => 0,
        ]);
    }

    public function markSynced(SyncOperation $op): void
    {
        $op->update([
            'status' => 'synced',
            'synced_at' => now(),
            'last_error' => null,
        ]);
    }

    public function markError(SyncOperation $op, string $message): void
    {
        $op->update([
            'status' => 'error',
            'attempts' => $op->attempts + 1,
            'last_error' => $message,
        ]);
    }
}
