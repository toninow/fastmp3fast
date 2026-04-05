<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Download;
use App\Models\Subtitle;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class SubtitleController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        $subtitles = Subtitle::query()
            ->whereHas('download', fn ($q) => $q->where('user_id', $request->user()->id))
            ->latest()
            ->get();

        return $this->success($subtitles);
    }

    public function store(Request $request, Download $download)
    {
        abort_unless($download->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'language' => ['required', 'string', 'max:12'],
            'format' => ['required', 'string', 'max:10'],
            'path' => ['required', 'string'],
            'is_default' => ['nullable', 'boolean'],
        ]);

        $subtitle = Subtitle::query()->create([
            ...$validated,
            'download_id' => $download->id,
        ]);

        return $this->success($subtitle, 'Subtítulo registrado', 201);
    }
}
