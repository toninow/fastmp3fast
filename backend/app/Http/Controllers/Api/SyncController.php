<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\RetrySyncJob;
use App\Models\SyncOperation;
use App\Services\Sync\SyncService;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class SyncController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        $userId = $request->user()->id;

        $ops = SyncOperation::query()
            ->where('user_id', $userId)
            ->latest()
            ->paginate(20);

        return $this->success([
            'status' => 'online',
            'backend' => 'healthy',
            'pending' => SyncOperation::query()->where('user_id', $userId)->where('status', 'pending')->count(),
            'synced' => SyncOperation::query()->where('user_id', $userId)->where('status', 'synced')->count(),
            'conflicts' => SyncOperation::query()->where('user_id', $userId)->where('status', 'conflict')->count(),
            'errors' => SyncOperation::query()->where('user_id', $userId)->where('status', 'error')->count(),
            'operations' => $ops,
        ]);
    }

    public function store(Request $request, SyncService $syncService)
    {
        $validated = $request->validate([
            'operations' => ['required', 'array'],
            'operations.*.operation' => ['required', 'string', 'max:60'],
            'operations.*.entity_type' => ['required', 'string', 'max:60'],
            'operations.*.entity_local_id' => ['nullable', 'string', 'max:100'],
            'operations.*.entity_remote_id' => ['nullable', 'integer'],
            'operations.*.payload' => ['nullable', 'array'],
        ]);

        $created = collect($validated['operations'])
            ->map(fn (array $operation) => $syncService->registerPending($request->user(), $operation));

        return $this->success($created, 'Operaciones registradas', 201);
    }

    public function retry(Request $request, SyncOperation $syncOperation)
    {
        abort_unless($syncOperation->user_id === $request->user()->id, 404);

        $syncOperation->update(['status' => 'pending']);
        RetrySyncJob::dispatch($syncOperation->id);

        return $this->success($syncOperation->fresh(), 'Reintento programado');
    }
}
