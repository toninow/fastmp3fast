<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Download;
use App\Models\PlaybackProgress;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class PlaybackProgressController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        return $this->success(
            PlaybackProgress::query()->where('user_id', $request->user()->id)->latest()->limit(100)->get()
        );
    }

    public function upsert(Request $request, Download $download)
    {
        abort_unless($download->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'position_seconds' => ['required', 'integer', 'min:0'],
            'duration_seconds' => ['required', 'integer', 'min:0'],
            'percent' => ['required', 'numeric', 'min:0', 'max:100'],
            'volume' => ['nullable', 'numeric', 'min:0', 'max:1'],
            'speed' => ['nullable', 'numeric', 'min:0.25', 'max:4'],
            'is_completed' => ['nullable', 'boolean'],
            'updated_from' => ['nullable', 'string', 'max:20'],
        ]);

        $progress = PlaybackProgress::query()->updateOrCreate(
            [
                'user_id' => $request->user()->id,
                'download_id' => $download->id,
            ],
            $validated
        );

        $download->update([
            'last_playback_position_seconds' => $validated['position_seconds'],
            'last_played_at' => now(),
        ]);

        return $this->success($progress, 'Progreso guardado');
    }
}
