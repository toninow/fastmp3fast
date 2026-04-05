<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\StoreDownloadRequest;
use App\Http\Requests\Api\UpdateDownloadRequest;
use App\Models\ActivityLog;
use App\Models\Download;
use App\Models\Tag;
use App\Services\Downloads\DownloadManagerService;
use App\Services\Downloads\YtDlpService;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class DownloadController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        $downloads = Download::query()
            ->with(['tags', 'subtitles', 'files', 'collection'])
            ->where('user_id', $request->user()->id)
            ->when($request->string('status')->isNotEmpty(), fn ($query) => $query->where('status', $request->string('status')))
            ->when($request->string('q')->isNotEmpty(), function ($query) use ($request): void {
                $term = '%'.$request->string('q').'%';
                $query->where(function ($nested) use ($term): void {
                    $nested->where('title', 'like', $term)
                        ->orWhere('custom_name', 'like', $term)
                        ->orWhere('uploader', 'like', $term);
                });
            })
            ->latest()
            ->paginate($request->integer('per_page', 20));

        return $this->success($downloads);
    }

    public function store(StoreDownloadRequest $request, DownloadManagerService $manager)
    {
        $validated = $request->validated();

        $download = Download::query()->create([
            'user_id' => $request->user()->id,
            'local_uid' => $validated['local_uid'] ?? null,
            'title' => $validated['custom_name'] ?? 'New download',
            'custom_name' => $validated['custom_name'] ?? null,
            'type' => $validated['download_type'],
            'status' => ! empty($validated['is_offline_queued']) ? 'offline' : 'queued',
            'source_url' => $validated['url'],
            'collection_id' => $validated['collection_id'] ?? null,
            'notes' => $validated['note'] ?? null,
            'subtitle_languages' => ! empty($validated['subtitle_enabled']) ? [$validated['subtitle_language'] ?? 'es'] : null,
            'sync_status' => ! empty($validated['is_offline_queued']) ? 'local_only' : 'synced',
            'metadata' => [
                'video_quality' => $validated['video_quality'] ?? null,
                'audio_quality' => $validated['audio_quality'] ?? null,
                'save_thumbnail' => $validated['save_thumbnail'] ?? true,
                'save_metadata' => $validated['save_metadata'] ?? true,
            ],
        ]);

        if (! empty($validated['tags'])) {
            $tagIds = collect($validated['tags'])
                ->map(fn (string $tag): Tag => Tag::query()->firstOrCreate(
                    ['user_id' => $request->user()->id, 'name' => $tag],
                    ['color' => '#F7E733']
                ))
                ->map(fn (Tag $tag): int => $tag->id)
                ->values();

            $download->tags()->sync($tagIds);
        }

        ActivityLog::query()->create([
            'user_id' => $request->user()->id,
            'download_id' => $download->id,
            'event' => 'download_created',
            'description' => 'Download request created from URL.',
            'context' => ['url' => $validated['url']],
            'is_offline_event' => ! empty($validated['is_offline_queued']),
            'occurred_at' => now(),
        ]);

        if ($download->status === 'queued') {
            $manager->queue($download);
        }

        return $this->success($download->load('tags'), 'Solicitud creada', 201);
    }

    public function show(Request $request, Download $download)
    {
        $this->authorizeDownload($request, $download);

        return $this->success($download->load(['tags', 'subtitles', 'files', 'collection', 'playbackProgress']));
    }

    public function update(UpdateDownloadRequest $request, Download $download)
    {
        $this->authorizeDownload($request, $download);

        $validated = $request->validated();
        $download->fill($validated);
        $download->save();

        if (array_key_exists('tags', $validated)) {
            $tagIds = collect($validated['tags'])
                ->map(fn (string $tag): Tag => Tag::query()->firstOrCreate(
                    ['user_id' => $request->user()->id, 'name' => $tag],
                    ['color' => '#F7E733']
                ))
                ->map(fn (Tag $tag): int => $tag->id)
                ->values();

            $download->tags()->sync($tagIds);
        }

        return $this->success($download->load('tags'), 'Elemento actualizado');
    }

    public function destroy(Request $request, Download $download)
    {
        $this->authorizeDownload($request, $download);
        $download->delete();

        return $this->success(null, 'Elemento eliminado');
    }

    public function retry(Request $request, Download $download, DownloadManagerService $manager)
    {
        $this->authorizeDownload($request, $download);

        $download->update([
            'status' => 'queued',
            'error_message' => null,
        ]);

        $manager->queue($download);

        return $this->success($download, 'Reintento en cola');
    }

    public function formats(Request $request, YtDlpService $ytDlpService)
    {
        $request->validate([
            'url' => ['required', 'url'],
        ]);

        return $this->success($ytDlpService->probeFormats($request->string('url')->toString()));
    }

    private function authorizeDownload(Request $request, Download $download): void
    {
        abort_unless($download->user_id === $request->user()->id, 404);
    }
}
