<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\StoreCollectionRequest;
use App\Models\Collection;
use App\Models\CollectionItem;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class CollectionController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        $collections = Collection::query()
            ->withCount('items')
            ->where('user_id', $request->user()->id)
            ->orderBy('sort_order')
            ->get();

        return $this->success($collections);
    }

    public function store(StoreCollectionRequest $request)
    {
        $collection = Collection::query()->create([
            ...$request->validated(),
            'user_id' => $request->user()->id,
        ]);

        $this->syncItems($collection, $request->input('item_ids', []));

        return $this->success($collection->load('items'), 'Lista creada', 201);
    }

    public function show(Request $request, Collection $collection)
    {
        $this->authorizeCollection($request, $collection);

        return $this->success(
            $collection->load(['items.download.tags', 'items.download.subtitles'])
        );
    }

    public function update(StoreCollectionRequest $request, Collection $collection)
    {
        $this->authorizeCollection($request, $collection);

        $collection->update($request->validated());
        $this->syncItems($collection, $request->input('item_ids', []));

        return $this->success($collection->fresh()->load('items'), 'Lista actualizada');
    }

    public function destroy(Request $request, Collection $collection)
    {
        $this->authorizeCollection($request, $collection);
        $collection->delete();

        return $this->success(null, 'Lista eliminada');
    }

    private function syncItems(Collection $collection, array $itemIds): void
    {
        if ($itemIds === []) {
            return;
        }

        CollectionItem::query()->where('collection_id', $collection->id)->delete();

        foreach ($itemIds as $index => $downloadId) {
            CollectionItem::query()->create([
                'collection_id' => $collection->id,
                'download_id' => $downloadId,
                'position' => $index,
            ]);
        }
    }

    private function authorizeCollection(Request $request, Collection $collection): void
    {
        abort_unless($collection->user_id === $request->user()->id, 404);
    }
}
