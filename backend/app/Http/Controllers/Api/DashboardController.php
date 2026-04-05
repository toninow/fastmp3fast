<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Download;
use App\Models\SyncOperation;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    use ApiResponse;

    public function __invoke(Request $request)
    {
        $userId = $request->user()->id;

        $stats = [
            'total_downloads' => Download::query()->where('user_id', $userId)->count(),
            'videos' => Download::query()->where('user_id', $userId)->where('type', 'like', '%video%')->count(),
            'audios' => Download::query()->where('user_id', $userId)->where('type', 'like', '%audio%')->count(),
            'playlists' => Download::query()->where('user_id', $userId)->where('type', 'like', '%playlist%')->count(),
            'errors' => Download::query()->where('user_id', $userId)->where('status', 'error')->count(),
            'pending' => Download::query()->where('user_id', $userId)->whereIn('status', ['pending', 'queued', 'processing'])->count(),
            'favorites' => Download::query()->where('user_id', $userId)->where('favorite', true)->count(),
            'with_subtitles' => Download::query()->where('user_id', $userId)->whereNotNull('subtitle_languages')->count(),
        ];

        return $this->success([
            'kpis' => $stats,
            'recent_downloads' => Download::query()->where('user_id', $userId)->latest()->limit(8)->get(),
            'recent_activity' => ActivityLog::query()->where('user_id', $userId)->latest()->limit(10)->get(),
            'sync_queue' => SyncOperation::query()->where('user_id', $userId)->whereIn('status', ['pending', 'error'])->latest()->limit(10)->get(),
            'connection_status' => [
                'backend' => 'online',
                'queue_pending' => SyncOperation::query()->where('user_id', $userId)->where('status', 'pending')->count(),
            ],
        ]);
    }
}
